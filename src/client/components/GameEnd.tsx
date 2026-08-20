// Final standings after the last round, as a dark index card. In chaos mode
// this is where every player's secret role is finally revealed.

import type { Standing } from '@shared/protocol'

export function GameEnd({
  standings,
  lowestWins = false,
  tournament = false,
}: {
  standings: Standing[]
  /** Hearts is a golf score: the standings arrive lowest-first and win that way. */
  lowestWins?: boolean
  /** The final combined leg of a tournament, not one game's own score. */
  tournament?: boolean
}) {
  const compact = standings.length > 7

  return (
    <div className="backdrop">
      <div
        className={`note modal modal--end${compact ? ' is-compact' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={tournament ? 'Final tournament standings' : 'Final standings'}
      >
        <h2 className="modal__end-title">{tournament ? '🏆 Tournament Champion' : 'Final Standings'}</h2>
        {tournament && <p className="modal__round">combined points across every game</p>}
        {lowestWins && !tournament && <p className="modal__round">fewest penalty points wins</p>}

        <ol className="standings">
          {standings.map((standing, i) => (
            <li
              key={standing.id}
              className={i === 0 ? 'is-winner' : ''}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="standings__rank">{i === 0 ? '🏆' : `${i + 1}.`}</span>
              <span className="standings__name">
                {standing.name}
                {standing.roleName && (
                  <span className="standings__role">
                    {' '}
                    {standing.roleEmoji} {standing.roleName}
                  </span>
                )}
                {standing.roleHistory && standing.roleHistory.length > 1 && (
                  <span
                    className="standings__history"
                    title={`Recent roles at this table: ${standing.roleHistory
                      .map((r) => r.roleName)
                      .join(' → ')}`}
                  >
                    {' '}
                    {standing.roleHistory
                      .slice(1)
                      .map((r) => r.roleEmoji)
                      .join(' ')}
                  </span>
                )}
              </span>
              <span className="standings__score">{standing.totalScore}</span>
            </li>
          ))}
        </ol>

        <p className="modal__footer">Returning to the lobby…</p>
      </div>
    </div>
  )
}
