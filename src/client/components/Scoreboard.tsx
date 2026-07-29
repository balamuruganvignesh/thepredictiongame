// Round-by-round score grid, modeled on classic Judgement score sheets: one row
// per round (with that round's trump suit icon), one column per player, and a
// totals bar at the bottom. Cells fill in as rounds complete; the current
// round's row is highlighted.
//
// Docked LEFT on every device -- open by default on desktop, opened on demand
// from the SCORES button on touch, where a dim backdrop closes it again.

import { Config, TOTAL_ROUNDS, trumpForRound } from '@shared/config'
import { trumpGlyph } from '../useGame'

type Props = {
  players: { id: string; name: string }[]
  history: Record<number, Record<string, number>>
  totals: Record<string, number>
  currentRound: number
  onClose: () => void
}

export function Scoreboard({ players, history, totals, currentRound, onClose }: Props) {
  const suitClass = (suit: string) =>
    suit === 'Hearts' || suit === 'Diamonds'
      ? 'is-red'
      : suit === 'NoTrump'
        ? 'is-faint'
        : 'is-black'

  return (
    <>
      <div className="scoreboard__backdrop" onClick={onClose} role="presentation" />
      <aside className="note scoresheet" aria-label="Score sheet">
        <table>
          <thead>
            <tr>
              <th className="scoresheet__trump-col" aria-label="Trump" />
              {players.map((player) => (
                <th key={player.id} title={player.name}>
                  {player.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: TOTAL_ROUNDS }, (_, i) => {
              const round = i + 1
              const suit = trumpForRound(round)
              const scores = history[round]
              return (
                <tr key={round} className={round === currentRound ? 'is-current' : ''}>
                  <td className={`scoresheet__trump ${suitClass(suit)}`}>
                    {trumpGlyph(suit)}
                    <span className="scoresheet__cards">{Config.cardSequence[i]}</span>
                  </td>
                  {players.map((player) => {
                    const score = scores?.[player.id]
                    return (
                      <td
                        key={player.id}
                        className={
                          score == null ? '' : score > 0 ? 'is-good' : score < 0 ? 'is-bad' : ''
                        }
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
              {players.map((player) => (
                <td key={player.id}>{totals[player.id] ?? 0}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </aside>
    </>
  )
}
