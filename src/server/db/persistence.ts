// Writes one row per finished (or abandoned) game to the local SQLite store.
// Fire-and-forget in spirit, same as discord.ts's webhook: any failure here
// is logged and swallowed, never thrown, so a DB hiccup can't take down a
// live round the way a throw from inside runGameLoop would.

import type { Standing } from '@shared/protocol'
import { MIN_PLAYERS_FOR_COINS, PLACEMENT_COINS } from '@shared/shop'
import { log } from '../logger'
import { db } from './index'
import { creditCoins } from './shop'

const upsertPlayer = db.prepare(`
  INSERT INTO players (id, name, first_seen, last_seen)
  VALUES (@id, @name, @now, @now)
  ON CONFLICT(id) DO UPDATE SET name = @name, last_seen = @now
`)

const insertResult = db.prepare(`
  INSERT INTO game_results (room_code, game_type, game_name, round_number, aborted, ended_at)
  VALUES (@roomCode, @gameType, @gameName, @roundNumber, @aborted, @endedAt)
`)

const insertResultPlayer = db.prepare(`
  INSERT INTO game_result_players (game_result_id, player_id, player_name, total_score, rank)
  VALUES (@gameResultId, @playerId, @playerName, @totalScore, @rank)
`)

type RecordGameOpts = {
  roomCode: string
  gameType: string
  gameName: string
  roundNumber: number | null
  aborted: boolean
  standings: Standing[]
}

// Standings arrive pre-sorted the way each game reads its own leaderboard
// (Room.currentStandings), so index 0 is always the leader regardless of
// whether this game sorts ascending or descending -- rank is just that
// position, the same assumption discord.ts's medal emojis already make.
// Top-3 placement pays out, inside the same transaction as the game row so
// the award and the result it came from commit together or not at all.
//
// Two guards on the faucet: an abandoned game pays nothing (a restart vote
// has no real winner -- the same reason the leaderboard refuses to count one
// as a win), and a table below MIN_PLAYERS_FOR_COINS pays nothing, since with
// two players somebody always places 1st and 2nd.
//
// Placement is computed from totalScore rather than from the `rank` column
// written above. That column is deliberately raw array position and gives
// tied players distinct ranks, which is fine for a history row but would hand
// one of two tied winners 50 coins and the other 30. Ties here share the
// BETTER placement, so two players tied for 1st are both paid first place.
function awardPlacementCoins(opts: RecordGameOpts, gameResultId: number) {
  if (opts.aborted) return
  if (opts.standings.length < MIN_PLAYERS_FOR_COINS) return

  for (const s of opts.standings) {
    const placement = opts.standings.findIndex((other) => other.totalScore === s.totalScore)
    const coins = PLACEMENT_COINS[placement]
    if (!coins) continue
    creditCoins({ playerId: s.id, delta: coins, reason: 'placement', gameResultId })
  }
}

const recordGame = db.transaction((opts: RecordGameOpts) => {
  const now = Date.now()
  for (const s of opts.standings) upsertPlayer.run({ id: s.id, name: s.name, now })

  const { lastInsertRowid } = insertResult.run({
    roomCode: opts.roomCode,
    gameType: opts.gameType,
    gameName: opts.gameName,
    roundNumber: opts.roundNumber,
    aborted: opts.aborted ? 1 : 0,
    endedAt: now,
  })

  opts.standings.forEach((s, i) => {
    insertResultPlayer.run({
      gameResultId: lastInsertRowid,
      playerId: s.id,
      playerName: s.name,
      totalScore: s.totalScore,
      rank: i + 1,
    })
  })

  awardPlacementCoins(opts, Number(lastInsertRowid))
})

export function recordGameEnded(opts: {
  roomCode: string
  gameType: string
  gameName: string
  standings: Standing[]
}) {
  try {
    recordGame({ ...opts, roundNumber: null, aborted: false })
  } catch (error) {
    log.error('persistence.recordGameEnded.failed', { error: String(error), roomCode: opts.roomCode })
  }
}

export function recordGameAbandoned(opts: {
  roomCode: string
  gameType: string
  gameName: string
  roundNumber: number
  standings: Standing[]
}) {
  try {
    recordGame({ ...opts, aborted: true })
  } catch (error) {
    log.error('persistence.recordGameAbandoned.failed', { error: String(error), roomCode: opts.roomCode })
  }
}
