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

  // A new ability (new round, or one a block handed back) closes the popover
  // and drops the half-made choice inside it.
  useEffect(() => {
    setOpen(false)
    setScope(null)
  }, [roleState.abilityId, roleState.used])

  if (!roleState.active) return null

  // Spent (or nothing dealt): nothing to fire, so the button disappears. The
  // separate ROLE button (always rendered alongside this one) is where your
  // role and what the ability did are still readable mid-round.
  if (!def || roleState.used) return null

  // What this ability needs before it can fire.
  const needsGallery = def.extra === 'role' || def.extra === 'card' || def.target === 'two'
  const oneTap = def.target === 'none' && !def.extra
  const wantsTarget = def.target === 'other' || def.target === 'any' || scope === 'one'
  const pickable = def.target === 'any' ? players : players.filter((p) => p.id !== meId)

  const fire = (payload: UseAbilityPayload) => {
    setOpen(false)
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
      fire({})
      return
    }
    setOpen((current) => !current)
  }

  return (
    <>
      {open && (
        <div className="note quick__pop" role="dialog" aria-label={`Use ${def.name}`}>
          <p className="quick__name">{def.name}</p>

          {def.extra === 'scope' && scope == null && (
            <>
              <p className="quick__label">who sees it</p>
              <div className="quick__row">
                <button className="role__target" onClick={() => setScope('one')}>
                  ONE PLAYER
                </button>
                <button className="role__target" onClick={() => fire({ scope: 'all' })}>
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
                    className="role__target"
                    onClick={() => fire({ suit: option.suit })}
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
                <button className="role__target" onClick={() => fire({ peek: 'high' })}>
                  HIGHEST
                </button>
                <button className="role__target" onClick={() => fire({ peek: 'low' })}>
                  LOWEST
                </button>
              </div>
            </>
          )}

          {def.extra === 'direction' && (
            <>
              <p className="quick__label">which way</p>
              <div className="quick__row">
                <button className="role__target" onClick={() => fire({ direction: 1 })}>
                  +1
                </button>
                <button className="role__target" onClick={() => fire({ direction: -1 })}>
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
                    className="role__target"
                    onClick={() =>
                      fire({ targetId: target.id, scope: scope ?? undefined })
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

      <button className="dock__button dock__button--quick" onClick={press}>
        ⚡ {def.name.toUpperCase()}
      </button>
    </>
  )
}
