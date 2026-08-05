// Choreographed visuals for chaos abilities, layered on top of the plain-text
// feed line. Reads live seat positions off TopBar's chips (data-player-id) at
// fire time rather than tracking refs, since the row can wrap at 7+ players.
//
// 'trade' flies two icons between two named seats (safe only when both
// identities are already public in the same announcement). 'impact' lands a
// no-source pulse on the target only, for abilities whose actor must stay
// anonymous -- see AbilityEffect in shared/protocol.ts for why the split
// exists.

import { useEffect, useRef } from 'react'
import type { AbilityEffect } from '@shared/protocol'

const FLY_MS = 600
const IMPACT_MS = 450

type Props = {
  effects: (AbilityEffect & { key: number })[]
  onDismiss: (key: number) => void
}

export function EffectLayer({ effects, onDismiss }: Props) {
  if (effects.length === 0) return null
  return (
    <div className="effect-layer">
      {effects.map((effect) => (
        <Effect key={effect.key} effect={effect} onDone={() => onDismiss(effect.key)} />
      ))}
    </div>
  )
}

function seatCenter(id: string): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(`[data-player-id="${id}"]`)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function Effect({ effect, onDone }: { effect: AbilityEffect; onDone: () => void }) {
  // The parent re-renders often; hold the latest callback in a ref so the
  // dismiss timer below is set up once per instance, not restarted on every
  // unrelated store update.
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const duration = effect.kind === 'trade' ? FLY_MS : IMPACT_MS
    const timer = setTimeout(() => doneRef.current(), duration)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const target = seatCenter(effect.targetId)
  // Defensive only: TopBar is always mounted during the 'game' view, so a
  // missing chip should be rare. Dismiss still fires from the timer above.
  if (!target) return null

  if (effect.kind === 'impact') {
    return (
      <span className="effect-impact" style={{ left: target.x, top: target.y }}>
        {effect.icon}
      </span>
    )
  }

  const source = effect.sourceId ? seatCenter(effect.sourceId) : null
  if (!source) return null

  return (
    <>
      <span
        className="effect-badge"
        style={
          {
            left: source.x,
            top: source.y,
            '--to-x': `${target.x - source.x}px`,
            '--to-y': `${target.y - source.y}px`,
          } as React.CSSProperties
        }
      >
        {effect.icon}
      </span>
      <span
        className="effect-badge"
        style={
          {
            left: target.x,
            top: target.y,
            '--to-x': `${source.x - target.x}px`,
            '--to-y': `${source.y - target.y}px`,
          } as React.CSSProperties
        }
      >
        {effect.icon}
      </span>
    </>
  )
}
