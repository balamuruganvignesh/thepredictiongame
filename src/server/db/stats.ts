// Read-only queries over the history db.ts writes. Room never calls any of
// this -- it's purely for the leaderboard/stats REST endpoints in index.ts.
// "Wins" and lifetime score only ever count games that actually finished
// (aborted = 0): a restart-vote abandonment has no real winner, just
// standings as they stood, so counting it as a win/loss would be wrong.

import { db } from './index'

export type LeaderboardRow = {
  playerId: string
  name: string
  gamesPlayed: number
  wins: number
  lifetimeScore: number
}

const leaderboardQuery = db.prepare(`
  SELECT
    p.id AS playerId,
    p.name AS name,
    COUNT(*) AS gamesPlayed,
    SUM(CASE WHEN grp.rank = 1 THEN 1 ELSE 0 END) AS wins,
    SUM(grp.total_score) AS lifetimeScore
  FROM game_result_players grp
  JOIN game_results gr ON gr.id = grp.game_result_id
  JOIN players p ON p.id = grp.player_id
  WHERE gr.aborted = 0
  GROUP BY grp.player_id
  ORDER BY wins DESC, gamesPlayed DESC
  LIMIT @limit
`)

export function getLeaderboard(limit = 20): LeaderboardRow[] {
  return leaderboardQuery.all({ limit }) as LeaderboardRow[]
}

const playerNameQuery = db.prepare(`SELECT name FROM players WHERE id = @playerId`)

const playerTotalsQuery = db.prepare(`
  SELECT
    COUNT(*) AS gamesPlayed,
    SUM(CASE WHEN grp.rank = 1 THEN 1 ELSE 0 END) AS wins,
    SUM(grp.total_score) AS lifetimeScore
  FROM game_result_players grp
  JOIN game_results gr ON gr.id = grp.game_result_id
  WHERE grp.player_id = @playerId AND gr.aborted = 0
`)

const favoriteGameTypeQuery = db.prepare(`
  SELECT gr.game_type AS gameType, COUNT(*) AS plays
  FROM game_result_players grp
  JOIN game_results gr ON gr.id = grp.game_result_id
  WHERE grp.player_id = @playerId AND gr.aborted = 0
  GROUP BY gr.game_type
  ORDER BY plays DESC
  LIMIT 1
`)

export type RecentGame = {
  gameResultId: number
  roomCode: string
  gameType: string
  gameName: string
  aborted: boolean
  endedAt: number
  rank: number
  totalScore: number
  /** Comma-separated display names of everyone else in that game, or null if you played alone. */
  otherPlayers: string | null
}

const recentGamesQuery = db.prepare(`
  SELECT
    gr.id AS gameResultId,
    gr.room_code AS roomCode,
    gr.game_type AS gameType,
    gr.game_name AS gameName,
    gr.aborted AS aborted,
    gr.ended_at AS endedAt,
    me.rank AS rank,
    me.total_score AS totalScore,
    (
      SELECT GROUP_CONCAT(other.player_name, ', ')
      FROM game_result_players other
      WHERE other.game_result_id = gr.id AND other.player_id != me.player_id
    ) AS otherPlayers
  FROM game_result_players me
  JOIN game_results gr ON gr.id = me.game_result_id
  WHERE me.player_id = @playerId
  ORDER BY gr.ended_at DESC
  LIMIT @limit
`)

export type PlayerStats = {
  playerId: string
  name: string | null
  gamesPlayed: number
  wins: number
  lifetimeScore: number
  favoriteGameType: string | null
  recentGames: RecentGame[]
}

export function getPlayerStats(playerId: string, recentLimit = 10): PlayerStats {
  const name = (playerNameQuery.get({ playerId }) as { name: string } | undefined)?.name ?? null
  const totals = playerTotalsQuery.get({ playerId }) as {
    gamesPlayed: number
    wins: number | null
    lifetimeScore: number | null
  }
  const favorite = favoriteGameTypeQuery.get({ playerId }) as { gameType: string } | undefined
  const recentGamesRaw = recentGamesQuery.all({ playerId, limit: recentLimit }) as (Omit<
    RecentGame,
    'aborted'
  > & { aborted: number })[]

  return {
    playerId,
    name,
    gamesPlayed: totals.gamesPlayed,
    wins: totals.wins ?? 0,
    lifetimeScore: totals.lifetimeScore ?? 0,
    favoriteGameType: favorite?.gameType ?? null,
    recentGames: recentGamesRaw.map((g) => ({ ...g, aborted: g.aborted === 1 })),
  }
}
