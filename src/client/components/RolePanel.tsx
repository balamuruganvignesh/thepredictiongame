// Chaos mode's role modal: your secret role and this round's rolled ability,
// with target / direction pickers and a USE button. Opened from the docked ROLE
// button; invisible in classic mode, so the base UI is untouched.

import { useEffect, useState } from 'react'
import * as RoleDefs from '@shared/roleDefs'
import type { RoleState, UseAbilityPayload } from '@shared/protocol'

type Props = {
  roleState: RoleState
  /** Everyone but you, in the same fixed order as the top bar / score sheet. */
  targets: { id: string; name: string }[]
  lastResult: string | null
  onUse: (payload: UseAbilityPayload) => void
  onClose: () => void
}

export function RolePanel({ roleState, targets, lastResult, onUse, onClose }: Props) {
  const role = RoleDefs.getRole(roleState.roleId)
  const def = RoleDefs.getAbility(roleState.abilityId)

  const [selected, setSelected] = useState<string[]>([])
  const [direction, setDirection] = useState<1 | -1>(1)
  const [nag, setNag] = useState(false)

  // A new ability (new round, or a retry that kept it live) clears the picker.
  useEffect(() => {
    setSelected([])
    setNag(false)
  }, [roleState.abilityId, roleState.used, lastResult])

  if (!role) return null

  const needed = def?.target === 'two' ? 2 : def?.target === 'other' ? 1 : 0

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      const next = [...current, id]
      // Keep only the most recent `needed` picks.
      return next.slice(Math.max(0, next.length - needed))
    })
  }

  const use = () => {
    if (roleState.used) return
    if (selected.length < needed) {
      setNag(true)
      return
    }
    setNag(false)
    onUse({ targetId: selected[0], targetId2: selected[1], direction })
  }

  return (
    <div className="backdrop" onClick={onClose} role="presentation">
      <div
        className="note modal modal--role"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Your role"
      >
        <header className="note__header modal__title" style={{ color: role.color }}>
          {role.emoji} {role.name.toUpperCase()}
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="role__tagline">{role.tagline} — your role is secret. use it well.</p>

        <p className="role__kicker">
          {role.abilities.length > 1 ? "THIS ROUND'S ABILITY" : 'YOUR PERMANENT ABILITY'}
        </p>
        <h3 className="role__ability">{def?.name ?? '—'}</h3>
        <p className="role__desc">{def?.desc}</p>
        {def?.note && <p className="role__note">⚙️ {def.note}</p>}

        {needed > 0 && !roleState.used && (
          <>
            <p className={`role__picker-label${nag ? ' is-nagging' : ''}`}>
              {nag
                ? needed === 2
                  ? 'pick TWO players first!'
                  : 'pick a target first!'
                : needed === 2
                  ? 'pick two players'
                  : 'pick a target'}
            </p>
            <div className={`role__targets${targets.length > 6 ? ' is-big' : ''}`}>
              {targets.map((target) => (
                <button
                  key={target.id}
                  className={`role__target${selected.includes(target.id) ? ' is-selected' : ''}`}
                  onClick={() => toggle(target.id)}
                >
                  {target.name}
                </button>
              ))}
            </div>
          </>
        )}

        {def?.extra === 'direction' && !roleState.used && (
          <div className="role__direction">
            {([1, -1] as const).map((dir) => (
              <button
                key={dir}
                className={`role__target${direction === dir ? ' is-selected' : ''}`}
                onClick={() => setDirection(dir)}
              >
                {dir === 1 ? '+1' : '-1'}
              </button>
            ))}
          </div>
        )}

        {lastResult && <p className="role__result">{lastResult}</p>}

        <button
          className={`button ${roleState.used ? 'button--spent' : 'button--primary'} role__use`}
          onClick={use}
          disabled={roleState.used || !def}
        >
          {roleState.used ? 'USED THIS ROUND ✓' : 'USE ABILITY'}
        </button>
      </div>
    </div>
  )
}
