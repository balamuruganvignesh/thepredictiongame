// Final standings after the last round, as a dark index card. In chaos mode
// this is where every player's secret role is finally revealed.

import type { Standing } from '@shared/protocol'

export function GameEnd({ standings }: { standings: Standing[] }) {
  const compact = standings.length > 7

  return (
    <div className="backdrop">
      <div
        className={`note modal modal--end${compact ? ' is-compact' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Final standings"
      >
        <h2 className="modal__end-title">Final Standings</h2>

        <ol className="standings">
          {standings.map((standing, i) => (
            <li key={standing.id} className={i === 0 ? 'is-winner' : ''}>
              <span className="standings__rank">{i === 0 ? '🏆' : `${i + 1}.`}</span>
              <span className="standings__name">
                {standing.name}
                {standing.roleName && (
                  <span className="standings__role">
                    {' '}
                    {standing.roleEmoji} {standing.roleName}
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
