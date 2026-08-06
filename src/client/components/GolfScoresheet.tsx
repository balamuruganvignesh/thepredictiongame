// Golf's score sheet, modeled on Scoreboard.tsx: Golf has a fixed nine-hole
// count just like the Prediction Game has a fixed ten rounds, so this reuses
// that shape rather than the dynamic row count Hearts needs.

import { GolfConfig } from '@shared/config'

type Props = {
  players: { id: string; name: string }[]
  history: Record<number, Record<string, number>>
  totals: Record<string, number>
  currentHole: number
  onClose: () => void
}

export function GolfScoresheet({ players, history, totals, currentHole, onClose }: Props) {
  const leader = players.reduce<number | null>((lowest, player) => {
    const total = totals[player.id] ?? 0
    return lowest == null || total < lowest ? total : lowest
  }, null)

  return (
    <>
      <div className="scoreboard__backdrop" onClick={onClose} role="presentation" />
      <aside className="note scoresheet" aria-label="Score sheet">
        <table>
          <thead>
            <tr>
              <th className="scoresheet__trump-col" aria-label="Hole" />
              {players.map((player) => (
                <th key={player.id} title={player.name}>
                  {player.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: GolfConfig.totalHoles }, (_, i) => {
              const hole = i + 1
              const scores = history[hole]
              return (
                <tr key={hole} className={hole === currentHole ? 'is-current' : ''}>
                  <td className="scoresheet__trump is-faint">
                    ⛳<span className="scoresheet__cards">{hole}</span>
                  </td>
                  {players.map((player) => {
                    const score = scores?.[player.id]
                    return (
                      <td key={player.id} className={score == null ? '' : score <= 0 ? 'is-good' : ''}>
                        {score != null && (
                          <span key={score} className="score-pop">
                            {score}
                          </span>
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
              <td className="scoresheet__trump">Σ</td>
              {players.map((player) => {
                const total = totals[player.id] ?? 0
                return (
                  <td key={player.id} className={total === leader ? 'is-good' : ''}>
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
