// Chaos mode: fire this round's ability WITHOUT the full-screen role modal.
//
// The modal covers the table, so using an ability mid-trick meant opening it,
// firing, and closing it again to see what everyone played. This is the same
// action as a small button above the dock, with its pickers in a popover that
// leaves the trick visible.
//
// It handles the abilities that need little or no input. The two-target ones and
// the two that need a gallery (Alternate Universe's roles, Time Branches' hand)
// still hand off to RolePanel -- they need the room.
//
// Renders nothing once the ability is spent (or nothing was dealt) -- the
// separate, always-on ROLE button in Table.tsx is where you go to read your
// role and this round's ability after that.

import { useEffect, useState } from 'react'
import * as RoleDefs from '@shared/roleDefs'
import type { Suit } from '@shared/cards'
import type { RoleState, UseAbilityPayload } from '@shared/protocol'

const SUITS: { suit: Suit; glyph: string }[] = [
  { suit: 'Spades', glyph: '♠' },
  { suit: 'Diamonds', glyph: '♦' },
  { suit: 'Clubs', glyph: '♣' },
  { suit: 'Hearts', glyph: '♥' },
]

type Props = {
  roleState: RoleState
  players: { id: string; name: string }[]
  meId: string | null
  onUse: (payload: UseAbilityPayload) => void
  /** Escape hatch for the abilities that genuinely need the big panel. */
  onOpenPanel: () => void
}

export function QuickAbility({ roleState, players, meId, onUse, onOpenPanel }: Props) {
  const def = RoleDefs.getAbility(roleState.abilityId)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'one' | 'all' | null>(null)

  // Which option (if any) was just tapped, held for a beat so the popover and
  // dock button can show a "cast" flourish before they react to the ability
  // actually being spent -- roleState.used flips on the server's ack, which
  // can land before a single animation frame does, and firing this from
  // inside a component that's about to render itself into nothing (used) or
  // close its own popover (open: false) means the flourish needs to outlive
  // both of those, not depend on them.
  const [firingKey, setFiringKey] = useState<string | null>(null)

  // A new ability (new round, or one a block handed back) closes the popover
  // and drops the half-made choice inside it.
  useEffect(() => {
    setOpen(false)
    setScope(null)
    setFiringKey(null)
  }, [roleState.abilityId])

  useEffect(() => {
    if (firingKey == null) return
    const timer = setTimeout(() => setFiringKey(null), 320)
    return () => clearTimeout(timer)
  }, [firingKey])

  if (!roleState.active) return null

  // Spent (or nothing dealt): nothing to fire, so the button disappears. The
  // separate ROLE button (always rendered alongside this one) is where your
  // role and what the ability did are still readable mid-round. A flourish in
  // flight gets one more render to finish before this takes effect.
  if ((!def || roleState.used) && firingKey == null) return null
  if (!def) return null

  // What this ability needs before it can fire.
  const needsGallery = def.extra === 'role' || def.extra === 'card' || def.target === 'two'
  const oneTap = def.target === 'none' && !def.extra
  const wantsTarget = def.target === 'other' || def.target === 'any' || scope === 'one'
  const pickable = def.target === 'any' ? players : players.filter((p) => p.id !== meId)

  const fire = (key: string, payload: UseAbilityPayload) => {
    setFiringKey(key)
    setScope(null)
    onUse(payload)
  }

  const press = () => {
    if (needsGallery) {
      onOpenPanel()
      return
    }
    // No target, no options: one press IS the whole action.
    if (oneTap) {
      fire('one-tap', {})
      return
    }
    setOpen((current) => !current)
  }

  // Every option in a row gets this: untouched normally, a quick pulse for
  // the one just tapped, a step back for the rest of the row -- same
  // language as the bidding chips, so picking an ability's target reads the
  // same as picking a bid.
  const optionClass = (key: string) => {
    if (firingKey == null) return 'role__target'
    return firingKey === key ? 'role__target role__target--picked' : 'role__target role__target--dimmed'
  }
  const locked = firingKey != null

  return (
    <>
      {open && (
        <div className="note quick__pop" role="dialog" aria-label={`Use ${def.name}`}>
          <p className="quick__name">{def.name}</p>

          {def.extra === 'scope' && scope == null && (
            <>
              <p className="quick__label">who sees it</p>
              <div className="quick__row">
                <button className={optionClass('scope-one')} onClick={() => setScope('one')}>
                  ONE PLAYER
                </button>
                <button
                  className={optionClass('scope-all')}
                  onClick={() => !locked && fire('scope-all', { scope: 'all' })}
                >
                  EVERYONE
                </button>
              </div>
            </>
          )}

          {def.extra === 'suit' && (
            <>
              <p className="quick__label">name a suit</p>
              <div className="quick__row">
                {SUITS.map((option) => (
                  <button
                    key={option.suit}
                    className={optionClass(`suit-${option.suit}`)}
                    onClick={() => !locked && fire(`suit-${option.suit}`, { suit: option.suit })}
                  >
                    {option.glyph}
                  </button>
                ))}
              </div>
            </>
          )}

          {def.extra === 'peek' && (
            <>
              <p className="quick__label">call it</p>
              <div className="quick__row">
                <button
                  className={optionClass('peek-high')}
                  onClick={() => !locked && fire('peek-high', { peek: 'high' })}
                >
                  HIGHEST
                </button>
                <button
                  className={optionClass('peek-low')}
                  onClick={() => !locked && fire('peek-low', { peek: 'low' })}
                >
                  LOWEST
                </button>
              </div>
            </>
          )}

          {def.extra === 'direction' && (
            <>
              <p className="quick__label">which way</p>
              <div className="quick__row">
                <button
                  className={optionClass('direction-1')}
                  onClick={() => !locked && fire('direction-1', { direction: 1 })}
                >
                  +1
                </button>
                <button
                  className={optionClass('direction--1')}
                  onClick={() => !locked && fire('direction--1', { direction: -1 })}
                >
                  -1
                </button>
              </div>
            </>
          )}

          {/* A scoped ability only opens the target list once ONE PLAYER is
              chosen -- EVERYONE is the whole answer on its own. */}
          {wantsTarget && (def.extra !== 'scope' || scope === 'one') && (
            <>
              <p className="quick__label">pick a target</p>
              <div className="quick__row">
                {pickable.map((target) => (
                  <button
                    key={target.id}
                    className={optionClass(`target-${target.id}`)}
                    onClick={() =>
                      !locked &&
                      fire(`target-${target.id}`, { targetId: target.id, scope: scope ?? undefined })
                    }
                  >
                    {target.id === meId ? `${target.name} (you)` : target.name}
                  </button>
                ))}
              </div>
            </>
          )}

          <button className="quick__more" onClick={onOpenPanel}>
            full panel ›
          </button>
        </div>
      )}

      <button
        className={`dock__button dock__button--quick${locked ? ' is-firing' : ''}`}
        onClick={press}
        disabled={locked}
      >
        ⚡ {def.name.toUpperCase()}
      </button>
    </>
  )
}
