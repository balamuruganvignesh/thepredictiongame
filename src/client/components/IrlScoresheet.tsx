// A standalone digital replacement for the paper/spreadsheet score sheet used
// when playing The Prediction Game in person, with no table, no sockets, no
// server round loop -- just bid/tricks-won/double entry and the same scoring
// math the online game uses (calculateScore), so a live game's numbers always
// match what the app itself would have produced.
//
// Lives at the fixed route /scoresheet (see App.tsx) and persists to
// localStorage so a refresh or a backgrounded phone doesn't lose the game.

import { useEffect, useState } from 'react'
import { Config, TOTAL_ROUNDS } from '@shared/config'
import { calculateScore } from '@shared/scoring'
import { trumpGlyph } from '../useGame'

type RoundEntry = {
  bid: number | null
  tricksWon: number | null
  doubled: boolean
}

type Player = { id: string; name: string }

type SheetState = {
  players: Player[]
  // rounds[roundIndex][playerId]
  rounds: Record<string, RoundEntry>[]
  // trumps[roundIndex] -- IRL Judgement draws a random trump each round
  // instead of following the app's fixed Spades/Diamonds/Clubs/Hearts/NoTrump
  // rotation.
  trumps: string[]
}

const STORAGE_KEY = 'irl-scoresheet-v1'

function emptyRound(): Record<string, RoundEntry> {
  return {}
}

function makeId() {
  return Math.random().toString(36).slice(2, 9)
}

function randomTrumps(): string[] {
  return Array.from(
    { length: TOTAL_ROUNDS },
    () => Config.trumpRotation[Math.floor(Math.random() * Config.trumpRotation.length)],
  )
}

function defaultState(): SheetState {
  return {
    players: [
      { id: makeId(), name: 'Player 1' },
      { id: makeId(), name: 'Player 2' },
    ],
    rounds: Array.from({ length: TOTAL_ROUNDS }, emptyRound),
    trumps: randomTrumps(),
  }
}

function loadState(): SheetState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw) as SheetState
    if (
      !parsed.players?.length ||
      parsed.rounds?.length !== TOTAL_ROUNDS ||
      parsed.trumps?.length !== TOTAL_ROUNDS
    ) {
      return defaultState()
    }
    return parsed
  } catch {
    return defaultState()
  }
}

const suitClass = (suit: string) =>
  suit === 'Hearts' || suit === 'Diamonds' ? 'is-red' : suit === 'NoTrump' ? 'is-faint' : ''

// Chrome/Firefox bump a focused number input's value on mouse-wheel scroll
// instead of scrolling the page underneath it -- with a whole grid of these
// inputs, that turns an ordinary scroll into randomly changed bids. Blurring
// on wheel hands the scroll back to the page.
const blurOnWheel = (e: React.WheelEvent<HTMLInputElement>) => e.currentTarget.blur()

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function IrlScoresheet() {
  const [state, setState] = useState<SheetState>(loadState)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }, [state])

  const totals = new Map<string, number>()
  for (const player of state.players) totals.set(player.id, 0)
  for (const round of state.rounds) {
    for (const [playerId, entry] of Object.entries(round)) {
      if (entry.bid == null || entry.tricksWon == null) continue
      const score = calculateScore(entry.bid, entry.tricksWon, entry.doubled)
      totals.set(playerId, (totals.get(playerId) ?? 0) + score)
    }
  }

  function updateEntry(roundIndex: number, playerId: string, patch: Partial<RoundEntry>) {
    setState((prev) => {
      const rounds = prev.rounds.slice()
      const round = { ...rounds[roundIndex] }
      const current: RoundEntry = round[playerId] ?? { bid: null, tricksWon: null, doubled: false }
      round[playerId] = { ...current, ...patch }
      rounds[roundIndex] = round
      return { ...prev, rounds }
    })
  }

  function addPlayer() {
    if (state.players.length >= Config.maxPlayers) return
    setState((prev) => ({
      ...prev,
      players: [...prev.players, { id: makeId(), name: `Player ${prev.players.length + 1}` }],
    }))
  }

  function removePlayer(id: string) {
    if (state.players.length <= Config.minPlayers) return
    setState((prev) => ({
      ...prev,
      players: prev.players.filter((p) => p.id !== id),
      rounds: prev.rounds.map((round) => {
        const { [id]: _dropped, ...rest } = round
        return rest
      }),
    }))
  }

  function renamePlayer(id: string, name: string) {
    setState((prev) => ({
      ...prev,
      players: prev.players.map((p) => (p.id === id ? { ...p, name } : p)),
    }))
  }

  function resetGame() {
    if (!confirm('Clear all bids, tricks and scores and start a new game?')) return
    setState((prev) => ({
      ...prev,
      rounds: Array.from({ length: TOTAL_ROUNDS }, emptyRound),
      trumps: randomTrumps(),
    }))
  }

  function rerollTrump(roundIndex: number) {
    setState((prev) => {
      const trumps = prev.trumps.slice()
      trumps[roundIndex] = Config.trumpRotation[Math.floor(Math.random() * Config.trumpRotation.length)]
      return { ...prev, trumps }
    })
  }

  function exportScores() {
    const rounds = Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
      const entries = state.rounds[i]
      const scores: Record<string, { bid: number | null; tricksWon: number | null; doubled: boolean; score: number | null }> = {}
      for (const player of state.players) {
        const entry = entries[player.id] ?? { bid: null, tricksWon: null, doubled: false }
        scores[player.name] = {
          bid: entry.bid,
          tricksWon: entry.tricksWon,
          doubled: entry.doubled,
          score:
            entry.bid != null && entry.tricksWon != null
              ? calculateScore(entry.bid, entry.tricksWon, entry.doubled)
              : null,
        }
      }
      return { round: i + 1, cards: Config.cardSequence[i], trump: state.trumps[i], scores }
    })

    downloadJson(`judgement-scores-${new Date().toISOString().slice(0, 10)}.json`, {
      exportedAt: new Date().toISOString(),
      players: state.players.map((p) => p.name),
      rounds,
      totals: Object.fromEntries(state.players.map((p) => [p.name, totals.get(p.id) ?? 0])),
    })
  }

  return (
    <div className="irl-page">
      <header className="irl-header">
        <h1>IRL Score Sheet</h1>
        <a className="button button--ghost" href="/">
          Back to online game
        </a>
      </header>

      <div className="irl-players note">
        <h2>Players</h2>
        <div className="irl-player-list">
          {state.players.map((player) => (
            <div className="irl-player-row" key={player.id}>
              <input
                className="irl-name-input"
                value={player.name}
                onChange={(e) => renamePlayer(player.id, e.target.value)}
                maxLength={20}
              />
              <button
                className="button button--ghost irl-remove"
                onClick={() => removePlayer(player.id)}
                disabled={state.players.length <= Config.minPlayers}
                aria-label={`Remove ${player.name}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div className="irl-player-actions">
          <button
            className="button button--primary"
            onClick={addPlayer}
            disabled={state.players.length >= Config.maxPlayers}
          >
            + Add player
          </button>
          <button className="button button--ghost" onClick={resetGame}>
            New game
          </button>
          <button className="button button--ghost" onClick={exportScores}>
            Export JSON
          </button>
        </div>
      </div>

      <div className="irl-table-wrap">
        <table className="irl-table">
          <thead>
            <tr>
              <th className="irl-round-col">Round</th>
              {state.players.map((player) => (
                <th key={player.id}>{player.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
              const round = i + 1
              const cards = Config.cardSequence[i]
              const suit = state.trumps[i]
              const entries = state.rounds[i]

              let bidSum = 0
              let bidsIn = 0
              let tricksSum = 0
              let tricksIn = 0
              for (const player of state.players) {
                const entry = entries[player.id]
                if (entry?.bid != null) {
                  bidSum += entry.bid
                  bidsIn++
                }
                if (entry?.tricksWon != null) {
                  tricksSum += entry.tricksWon
                  tricksIn++
                }
              }
              const allBidsIn = bidsIn === state.players.length
              const bidsIllegal = allBidsIn && bidSum === cards
              const allTricksIn = tricksIn === state.players.length
              const tricksOff = allTricksIn && tricksSum !== cards

              return (
                <tr key={round}>
                  <td className="irl-round-col">
                    <button
                      type="button"
                      className={`irl-trump ${suitClass(suit)}`}
                      onClick={() => rerollTrump(i)}
                      title="Reroll trump"
                    >
                      {trumpGlyph(suit)}
                    </button>
                    <span className="scoresheet__cards">{cards} cards</span>
                    {allBidsIn && (
                      <span className={`irl-check ${bidsIllegal ? 'is-bad' : 'is-good'}`}>
                        bids Σ{bidSum}
                        {bidsIllegal ? ' ⚠' : ''}
                      </span>
                    )}
                    {allTricksIn && (
                      <span className={`irl-check ${tricksOff ? 'is-bad' : 'is-good'}`}>
                        won Σ{tricksSum}/{cards}
                      </span>
                    )}
                  </td>
                  {state.players.map((player) => {
                    const entry = entries[player.id] ?? { bid: null, tricksWon: null, doubled: false }
                    const hasScore = entry.bid != null && entry.tricksWon != null
                    const score = hasScore
                      ? calculateScore(entry.bid!, entry.tricksWon!, entry.doubled)
                      : null

                    return (
                      <td key={player.id} className="irl-cell">
                        <div className="irl-cell-inputs">
                          <label className="irl-field">
                            <span>Bid</span>
                            <input
                              type="number"
                              min={0}
                              max={cards}
                              value={entry.bid ?? ''}
                              onChange={(e) =>
                                updateEntry(i, player.id, {
                                  bid: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                              onWheel={blurOnWheel}
                            />
                          </label>
                          <label className="irl-field">
                            <span>Won</span>
                            <input
                              type="number"
                              min={0}
                              max={cards}
                              value={entry.tricksWon ?? ''}
                              onChange={(e) =>
                                updateEntry(i, player.id, {
                                  tricksWon: e.target.value === '' ? null : Number(e.target.value),
                                })
                              }
                              onWheel={blurOnWheel}
                            />
                          </label>
                          <label className="irl-double">
                            <input
                              type="checkbox"
                              checked={entry.doubled}
                              onChange={(e) => updateEntry(i, player.id, { doubled: e.target.checked })}
                            />
                            2x
                          </label>
                        </div>
                        {score != null && (
                          <div className={`irl-score ${score > 0 ? 'is-good' : score < 0 ? 'is-bad' : ''}`}>
                            {score > 0 ? '+' : ''}
                            {score}
                          </div>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="irl-round-col">Total</td>
              {state.players.map((player) => (
                <td key={player.id}>{totals.get(player.id) ?? 0}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
