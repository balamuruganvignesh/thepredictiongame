// Blackjack's score sheet, modeled on GolfScoresheet.tsx: a fixed row count
// per game (`totalRounds`, host-chosen) rather than Hearts' dynamic count.
// Unlike Golf/Hearts, MORE points is better here -- same read as the
// Prediction Game's sheet -- so the leader highlight picks the highest total.

type Props = {
  players: { id: string; name: string }[]
  history: Record<number, Record<string, number>>
  totals: Record<string, number>
  currentRound: number
  totalRounds: number
  onClose: () => void
}

export function BlackjackScoresheet({
  players,
  history,
  totals,
  currentRound,
  totalRounds,
  onClose,
}: Props) {
  const leader = players.reduce<number | null>((highest, player) => {
    const total = totals[player.id] ?? 0
    return highest == null || total > highest ? total : highest
  }, null)

  return (
    <>
      <div className="scoreboard__backdrop" onClick={onClose} role="presentation" />
      <aside className="note scoresheet" aria-label="Score sheet">
        <table>
          <thead>
            <tr>
              <th className="scoresheet__trump-col" aria-label="Round" />
              {players.map((player) => (
                <th key={player.id} title={player.name}>
                  {player.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: totalRounds }, (_, i) => {
              const round = i + 1
              const scores = history[round]
              return (
                <tr key={round} className={round === currentRound ? 'is-current' : ''}>
                  <td className="scoresheet__trump is-faint">
                    🂡<span className="scoresheet__cards">{round}</span>
                  </td>
                  {players.map((player) => {
                    const score = scores?.[player.id]
                    return (
                      <td key={player.id} className={score == null ? '' : score >= 0 ? 'is-good' : ''}>
                        {score != null && (
                          <span key={score} className="score-pop">
                            {score > 0 ? `+${score}` : score}
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
