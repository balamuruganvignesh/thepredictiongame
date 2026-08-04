// The Hearts score sheet, docked left like the Prediction Game's. Same paper
// table and the same CSS, but the rows aren't a fixed ten: a Hearts game runs
// until somebody crosses the target, so it grows a row per round played and the
// leftmost column carries that round's pass direction instead of a trump suit.

import { passDirection } from '@shared/heartsRules'

type Props = {
  players: { id: string; name: string }[]
  history: Record<number, Record<string, number>>
  totals: Record<string, number>
  currentRound: number
  targetScore: number
  onClose: () => void
}

const ARROW: Record<string, string> = { left: '←', right: '→', across: '↕', none: '·' }

export function HeartsScoresheet({
  players,
  history,
  totals,
  currentRound,
  targetScore,
  onClose,
}: Props) {
  // Rounds played, plus the one in progress.
  const rounds = Math.max(currentRound, ...Object.keys(history).map(Number), 1)

  return (
    <>
      <div className="scoreboard__backdrop" onClick={onClose} role="presentation" />
      <aside className="note scoresheet" aria-label="Score sheet">
        <table>
          <thead>
            <tr>
              <th className="scoresheet__trump-col" aria-label="Pass direction" />
              {players.map((player) => (
                <th key={player.id} title={player.name}>
                  {player.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, i) => {
              const round = i + 1
              const scores = history[round]
              return (
                <tr key={round} className={round === currentRound ? 'is-current' : ''}>
                  <td className="scoresheet__trump is-faint">
                    {ARROW[passDirection(round, players.length)] ?? '·'}
                    <span className="scoresheet__cards">{round}</span>
                  </td>
                  {players.map((player) => {
                    const score = scores?.[player.id]
                    return (
                      // Points are penalties: zero is the good outcome, and 26
                      // means somebody shot the moon at your expense.
                      <td
                        key={player.id}
                        className={score == null ? '' : score === 0 ? 'is-good' : 'is-bad'}
                      >
                        {score ?? ''}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="scoresheet__trump">Σ</td>
              {players.map((player) => {
                const total = totals[player.id] ?? 0
                return (
                  <td key={player.id} className={total >= targetScore ? 'is-bad' : ''}>
                    {total}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </aside>
    </>
  )
}
