// Writes one row per finished (or abandoned) game to the local SQLite store.
// Fire-and-forget in spirit, same as discord.ts's webhook: any failure here
// is logged and swallowed, never thrown, so a DB hiccup can't take down a
// live round the way a throw from inside runGameLoop would.

import type { Standing } from '@shared/protocol'
import { log } from '../logger'
import { db } from './index'

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
