// Reads and writes that only the admin site needs: the whole-table game log,
// player search, a wallet's ledger, and a manual coin adjustment.
//
// Separate from stats.ts because that file is the PUBLIC read surface -- it
// deliberately hides abandoned games from wins and shows one player at a
// time. An operator needs the opposite: every game including the abandoned
// ones, and whole tables rather than one seat's view of them.

import { db } from './index'
import { log } from '../logger'

export type AdminGamePlayer = { playerId: string; name: string; totalScore: number; rank: number }

export type AdminGame = {
  id: number
  roomCode: string
  gameType: string
  gameName: string
  roundNumber: number | null
  aborted: boolean
  endedAt: number
  players: AdminGamePlayer[]
}

const recentGamesQuery = db.prepare(`
  SELECT id, room_code AS roomCode, game_type AS gameType, game_name AS gameName,
         round_number AS roundNumber, aborted, ended_at AS endedAt
  FROM game_results
  ORDER BY ended_at DESC
  LIMIT @limit
`)

const gamePlayersQuery = db.prepare(`
  SELECT player_id AS playerId, player_name AS name, total_score AS totalScore, rank
  FROM game_result_players
  WHERE game_result_id = @gameResultId
  ORDER BY rank ASC
`)

/**
 * The game log. Abandoned games are INCLUDED and flagged rather than filtered
 * -- "a table broke up mid-game" is exactly the kind of thing an operator is
 * looking for, and it's the one thing the public leaderboard hides.
 */
export function getRecentGames(limit = 50): AdminGame[] {
  const rows = recentGamesQuery.all({ limit }) as (Omit<AdminGame, 'players' | 'aborted'> & {
    aborted: number
  })[]
  return rows.map((row) => ({
    ...row,
    aborted: row.aborted === 1,
    players: gamePlayersQuery.all({ gameResultId: row.id }) as AdminGamePlayer[],
  }))
}

export type AdminPlayerRow = {
  playerId: string
  name: string
  lastSeen: number
  coins: number
  gamesPlayed: number
  /** The signed-in email, when this id belongs to an account. */
  email: string | null
}

// The id universe is the UNION of three tables, not `players` alone: an id
// can exist because it finished a game (players), because it holds coins
// (coin_ledger -- someone who redeemed a code and never sat down), or because
// it signed in (accounts). Searching only `players` makes a wallet you are
// looking for invisible, which is exactly when you go looking.
//
// LEFT JOINs for the same reason: any of the three may be missing.
const playerSearchQuery = db.prepare(`
  WITH ids AS (
    SELECT id AS player_id FROM players
    UNION SELECT player_id FROM coin_ledger
    UNION SELECT player_id FROM accounts
  )
  SELECT
    ids.player_id AS playerId,
    COALESCE(p.name, a.name, '') AS name,
    COALESCE(p.last_seen, a.last_login, 0) AS lastSeen,
    COALESCE((SELECT SUM(delta) FROM coin_ledger cl WHERE cl.player_id = ids.player_id), 0) AS coins,
    (SELECT COUNT(*) FROM game_result_players grp WHERE grp.player_id = ids.player_id) AS gamesPlayed,
    a.email AS email
  FROM ids
  LEFT JOIN players p ON p.id = ids.player_id
  LEFT JOIN accounts a ON a.player_id = ids.player_id
  WHERE @query = ''
     OR COALESCE(p.name, a.name, '') LIKE @like
     OR ids.player_id LIKE @like
     OR COALESCE(a.email, '') LIKE @like
  ORDER BY lastSeen DESC, coins DESC
  LIMIT @limit
`)

export function searchPlayers(query: string, limit = 25): AdminPlayerRow[] {
  return playerSearchQuery.all({
    query,
    like: `%${query}%`,
    limit,
  }) as AdminPlayerRow[]
}

export type LedgerEntry = {
  id: number
  delta: number
  reason: string
  gameResultId: number | null
  createdAt: number
}

const ledgerQuery = db.prepare(`
  SELECT id, delta, reason, game_result_id AS gameResultId, created_at AS createdAt
  FROM coin_ledger
  WHERE player_id = @playerId
  ORDER BY created_at DESC, id DESC
  LIMIT @limit
`)

/**
 * The wallet's history. This is the whole reason coins are a ledger rather
 * than a balance column: every coin a player has is explainable, and a
 * double-award shows up as two visible rows.
 */
export function getLedger(playerId: string, limit = 50): LedgerEntry[] {
  return ledgerQuery.all({ playerId, limit }) as LedgerEntry[]
}

const insertLedger = db.prepare(`
  INSERT INTO coin_ledger (player_id, delta, reason, game_result_id, created_at)
  VALUES (@playerId, @delta, @reason, NULL, @now)
`)
const syncAccountCoins = db.prepare(`
  UPDATE accounts SET coins = (
    SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE player_id = accounts.player_id
  ) WHERE player_id = @playerId
`)
const balanceQuery = db.prepare(`
  SELECT COALESCE(SUM(delta), 0) AS balance FROM coin_ledger WHERE player_id = ?
`)

export type AdjustResult = { ok: true; balance: number } | { ok: false; error: string }

/**
 * A manual grant or deduction. Written as an ordinary ledger row with an
 * `admin:` reason rather than as a special case, so it shows up in the same
 * history as everything else -- an adjustment nobody can see afterwards is
 * how a wallet becomes unexplainable.
 *
 * A deduction may take a balance NEGATIVE and that's deliberate: refusing
 * would mean an operator correcting a bad award has to work out the exact
 * remainder first, and `buyItem` already refuses to spend what isn't there.
 */
export const adjustCoins = db.transaction(
  (playerId: string, delta: number, note: string): AdjustResult => {
    if (!Number.isInteger(delta) || delta === 0) {
      return { ok: false, error: 'Give a non-zero whole number of coins.' }
    }
    const now = Date.now()
    insertLedger.run({
      playerId,
      delta,
      reason: note ? `admin:${note}` : 'admin:adjustment',
      now,
    })
    syncAccountCoins.run({ playerId })
    log.info('admin.coins.adjusted', { playerId, delta })
    return { ok: true, balance: (balanceQuery.get(playerId) as { balance: number }).balance }
  },
)
