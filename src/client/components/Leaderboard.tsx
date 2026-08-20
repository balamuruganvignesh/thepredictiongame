// Standalone page at /leaderboard: cross-game history and a leaderboard,
// read from the SQLite store the server writes to on every finished or
// abandoned game (src/server/db/). Plain REST, not the Socket.IO protocol --
// this isn't table-scoped, so it doesn't belong in protocol.ts.
//
// "Recent games" is this app's answer to a durable rematch list: room codes
// are ephemeral (a table gets reaped or the process restarts), so there's
// nothing left to reconnect to -- what's actually useful and persists is
// knowing who you played with and how it went, so you know who to invite
// into a fresh table.

import { useEffect, useState } from 'react'
import { storedPlayerId } from '../socket'

type LeaderboardRow = {
  playerId: string
  name: string
  gamesPlayed: number
  wins: number
  lifetimeScore: number
}

type RecentGame = {
  gameResultId: number
  roomCode: string
  gameType: string
  gameName: string
  aborted: boolean
  endedAt: number
  rank: number
  totalScore: number
  otherPlayers: string | null
}

type PlayerStats = {
  playerId: string
  name: string | null
  gamesPlayed: number
  wins: number
  lifetimeScore: number
  favoriteGameType: string | null
  recentGames: RecentGame[]
}

const GAME_LABELS: Record<string, string> = {
  prediction: 'The Prediction Game',
  hearts: 'Hearts',
  golf: 'Golf',
  blackjack: 'Blackjack',
}

function gameLabel(type: string): string {
  return GAME_LABELS[type] ?? type
}

export function Leaderboard() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[] | null>(null)
  const [myStats, setMyStats] = useState<PlayerStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then(setLeaderboard)
      .catch(() => setError('Could not load the leaderboard.'))

    const myId = storedPlayerId()
    if (myId) {
      fetch(`/api/players/${encodeURIComponent(myId)}/stats`)
        .then((r) => r.json())
        .then(setMyStats)
        .catch(() => {})
    }
  }, [])

  const winRate = (row: { gamesPlayed: number; wins: number }) =>
    row.gamesPlayed > 0 ? Math.round((row.wins / row.gamesPlayed) * 100) : 0

  return (
    <div className="irl-page">
      <header className="irl-header">
        <h1>Leaderboard</h1>
        <a className="button button--ghost" href="/">
          Back to the tables
        </a>
      </header>

      {error && <p className="join__status join__status--error">{error}</p>}

      {myStats && (
        <div className="note leaderboard__panel">
          <h2>Your stats</h2>
          {myStats.gamesPlayed > 0 ? (
            <>
              <div className="leaderboard__stat-row">
                <span>
                  <strong>{myStats.gamesPlayed}</strong> games played
                </span>
                <span>
                  <strong>{myStats.wins}</strong> wins ({winRate(myStats)}%)
                </span>
                <span>
                  <strong>{myStats.lifetimeScore}</strong> lifetime score
                </span>
                {myStats.favoriteGameType && (
                  <span>
                    favorite: <strong>{gameLabel(myStats.favoriteGameType)}</strong>
                  </span>
                )}
              </div>

              {myStats.recentGames.length > 0 && (
                <>
                  <h3>Recent games</h3>
                  <ul className="leaderboard__recent">
                    {myStats.recentGames.map((g) => (
                      <li key={g.gameResultId}>
                        <span className="leaderboard__recent-game">{gameLabel(g.gameType)}</span>
                        <span className="leaderboard__recent-detail">
                          {g.aborted
                            ? 'left early'
                            : `${g.rank === 1 ? '🏆 won' : `#${g.rank}`} · ${g.totalScore} pts`}
                          {g.otherPlayers && ` · with ${g.otherPlayers}`}
                        </span>
                        <span className="leaderboard__recent-date">
                          {new Date(g.endedAt).toLocaleDateString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          ) : (
            <p className="leaderboard__empty">
              No finished games yet — play a table to show up here.
            </p>
          )}
        </div>
      )}

      <div className="note leaderboard__panel">
        <h2>Top players</h2>
        {leaderboard == null ? (
          <p className="leaderboard__empty">Loading…</p>
        ) : leaderboard.length === 0 ? (
          <p className="leaderboard__empty">Nobody's finished a game yet.</p>
        ) : (
          <table className="leaderboard__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Games</th>
                <th>Wins</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((row, i) => (
                <tr key={row.playerId} className={row.playerId === myStats?.playerId ? 'is-me' : ''}>
                  <td>{i + 1}</td>
                  <td>{row.name}</td>
                  <td>{row.gamesPlayed}</td>
                  <td>
                    {row.wins} ({winRate(row)}%)
                  </td>
                  <td>{row.lifetimeScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
