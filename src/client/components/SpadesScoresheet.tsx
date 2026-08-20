// The Spades score sheet, docked left like every other game's. A row per
// hand played (a Spades game runs until a team crosses the target, so it
// grows like Hearts' sheet does) -- partners share a column value since a
// team's score is duplicated onto both of them (see Room.currentStandings).

type Props = {
  players: { id: string; name: string; team: 0 | 1 }[]
  history: Record<number, Record<string, number>>
  totals: Record<string, number>
  currentRound: number
  targetScore: number
  onClose: () => void
}

export function SpadesScoresheet({
  players,
  history,
  totals,
  currentRound,
  targetScore,
  onClose,
}: Props) {
  const rounds = Math.max(currentRound, ...Object.keys(history).map(Number), 1)

  return (
    <>
      <div className="scoreboard__backdrop" onClick={onClose} role="presentation" />
      <aside className="note scoresheet" aria-label="Score sheet">
        <table>
          <thead>
            <tr>
              <th className="scoresheet__trump-col" aria-label="Hand" />
              {players.map((player) => (
                <th key={player.id} title={`${player.name} (team ${player.team === 0 ? 'A' : 'B'})`}>
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
                    ♠
                    <span className="scoresheet__cards">{round}</span>
                  </td>
                  {players.map((player) => {
                    const score = scores?.[player.id]
                    return (
                      <td
                        key={player.id}
                        className={score == null ? '' : score >= 0 ? 'is-good' : 'is-bad'}
                      >
                        {score != null && (
                          <span key={score} className="score-pop">
                            {score >= 0 ? `+${score}` : score}
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
                  <td key={player.id} className={total >= targetScore ? 'is-good' : ''}>
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
