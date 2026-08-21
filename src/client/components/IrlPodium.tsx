// The end-of-game podium for the IRL score sheet (/scoresheet).
//
// Nothing like this exists in the online game -- GameEnd.tsx is a flat sorted
// list -- so this is not a port. It shows only once a sheet is fully filled
// in, and can be reopened from the button in the player actions row.
//
// The rise is Web Animations, not CSS keyframes, for the reason animation.ts
// spells out: the `prefers-reduced-motion` block in tokens.css cannot reach a
// WAAPI animation, so anything animating outside CSS has to ask
// prefersReducedMotion() itself. Here that gate skips the rise entirely and
// leaves every block sitting at its final height.

import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../a11ySettings'

export type PodiumPlace = {
  /** Competition rank: tied players share a rank, and the next one is skipped. */
  rank: number
  total: number
  names: string[]
}

const MEDALS = ['🥇', '🥈', '🥉']
// Visual order across the podium: runner-up, winner, third -- the shape a real
// podium has. Index into it is NOT the rank.
const LAYOUT = [1, 0, 2]
const HEIGHTS = ['58%', '100%', '38%']
// The winner lands last, so the eye is walked up to it.
const DELAYS = [340, 620, 60]

export function IrlPodium({
  places,
  rest,
  onClose,
}: {
  places: PodiumPlace[]
  rest: { name: string; total: number; rank: number }[]
  onClose: () => void
}) {
  const blockRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (prefersReducedMotion()) return
    const animations: Animation[] = []
    for (const [slot, placeIndex] of LAYOUT.entries()) {
      const el = blockRefs.current[placeIndex]
      if (!el || typeof el.animate !== 'function') continue
      animations.push(
        el.animate(
          [
            { transform: 'translateY(100%) scaleY(0.6)', opacity: 0 },
            { transform: 'translateY(0) scaleY(1)', opacity: 1 },
          ],
          {
            duration: 520,
            delay: DELAYS[slot],
            easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
            fill: 'both',
          },
        ),
      )
    }
    return () => animations.forEach((animation) => animation.cancel())
  }, [places])

  return (
    <div className="backdrop backdrop--banner" onClick={onClose}>
      <div
        className="note irl-podium"
        role="dialog"
        aria-modal="true"
        aria-label="Final standings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="irl-podium__title">Final standings</h2>

        <div className="irl-podium__stage">
          {LAYOUT.map((placeIndex, slot) => {
            const place = places[placeIndex]
            if (!place) return <div className="irl-podium__slot" key={slot} />
            return (
              <div className="irl-podium__slot" key={slot}>
                <div className="irl-podium__names">
                  {place.names.map((name) => (
                    <span key={name}>{name}</span>
                  ))}
                </div>
                <div className="irl-podium__total">{place.total}</div>
                <div
                  className={`irl-podium__block is-rank-${place.rank}`}
                  style={{ height: HEIGHTS[slot] }}
                  ref={(el) => {
                    blockRefs.current[placeIndex] = el
                  }}
                >
                  <span className="irl-podium__medal">{MEDALS[placeIndex]}</span>
                </div>
              </div>
            )
          })}
        </div>

        {rest.length > 0 && (
          <ol className="irl-podium__rest">
            {rest.map((player) => (
              <li key={player.name}>
                <span className="irl-podium__rest-rank">{player.rank}.</span>
                <span className="irl-podium__rest-name">{player.name}</span>
                <span className="irl-podium__rest-total">{player.total}</span>
              </li>
            ))}
          </ol>
        )}

        <button className="button button--primary irl-podium__close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
