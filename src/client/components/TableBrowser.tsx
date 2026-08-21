// The public table browser: find a game without an invite code.
//
// Reads GET /api/tables, which is plain REST for the same reason the
// leaderboard's endpoints are -- this is a stranger asking what's out there,
// not a live table talking to the people already at it, so it doesn't belong
// on the Socket.IO event map that protocol.ts is the source of truth for.
//
// Only tables whose HOST opted in appear here, and only while they're still
// in the lobby with a free chair. A private game with friends never shows up
// because nobody thought to opt out -- see Room.publicListing().

import { useCallback, useEffect, useState } from 'react'

type PublicTable = {
  code: string
  gameType: string
  gameName: string
  mode: 'classic' | 'chaos'
  players: number
  minPlayers: number
  maxPlayers: number
  hostName: string
  isTournament: boolean
  lastActivity: number
}

export function TableBrowser({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (code: string) => void
}) {
  const [tables, setTables] = useState<PublicTable[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setFailed(false)
    fetch('/api/tables')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('bad status'))))
      .then((rows: PublicTable[]) => setTables(rows))
      .catch(() => {
        setTables([])
        setFailed(true)
      })
  }, [])

  useEffect(load, [load])

  // Tables fill up and start without warning, so a list that's a minute old
  // is mostly wrong. Cheap enough to just re-ask: the endpoint reads an
  // in-memory map and returns at most a handful of rows.
  useEffect(() => {
    const timer = setInterval(load, 10000)
    return () => clearInterval(timer)
  }, [load])

  const pickRandom = () => {
    if (!tables || tables.length === 0) return
    onPick(tables[Math.floor(Math.random() * tables.length)].code)
  }

  return (
    <div className="browser">
      <div className="browser__head">
        <span className="field__label">open tables</span>
        <button type="button" className="browser__refresh" onClick={load}>
          ↻ refresh
        </button>
      </div>

      {tables == null ? (
        <p className="browser__empty">looking for open tables…</p>
      ) : failed ? (
        <p className="browser__empty">couldn’t reach the table list. try again?</p>
      ) : tables.length === 0 ? (
        <p className="browser__empty">
          no public tables right now. open one yourself and flip it to <b>PUBLIC</b> in the lobby.
        </p>
      ) : (
        <>
          <ul className="browser__list">
            {tables.map((table) => (
              <li key={table.code}>
                <button
                  type="button"
                  className="browser__row"
                  onClick={() => onPick(table.code)}
                  disabled={disabled}
                >
                  <span className="browser__game">
                    {table.isTournament ? '🏆 Tournament' : table.gameName}
                    {table.mode === 'chaos' && <span className="browser__badge">CHAOS</span>}
                  </span>
                  <span className="browser__meta">
                    {table.hostName || 'someone'}’s table · {table.players}/{table.maxPlayers}
                  </span>
                  <span className="browser__code">{table.code}</span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            className="button browser__random"
            onClick={pickRandom}
            disabled={disabled}
          >
            🎲 join a random table
          </button>
        </>
      )}
    </div>
  )
}
