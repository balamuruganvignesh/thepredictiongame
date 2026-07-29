// Round-start reveal: "here's your role", then a slot-machine spin through the
// role's ability pool before it lands on this round's pick. Covers everything
// (cards, bidding modal) so each round opens with the reveal.

import { useEffect, useRef, useState } from 'react'
import * as RoleDefs from '@shared/roleDefs'

type Props = {
  roleId: string
  abilityId: string
  excludeHandSwap: boolean
  onDismiss: () => void
}

export function RoleBanner({ roleId, abilityId, excludeHandSwap, onDismiss }: Props) {
  const role = RoleDefs.getRole(roleId)
  const def = RoleDefs.getAbility(abilityId)

  const [slot, setSlot] = useState('…')
  const [landed, setLanded] = useState(false)

  // The parent re-renders on every bid and trick, and its onDismiss closure is
  // new each time. Held in a ref so the spin below depends only on the ability
  // itself -- otherwise the effect restarted mid-roll and never landed.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!role || !def) return
    const timers: ReturnType<typeof setTimeout>[] = []
    setSlot('…')
    setLanded(false)

    // Names to spin through: the role's whole pool (minus a spent Big Swap, so
    // the Joker isn't teased with an ability they can't roll).
    const names = role.abilities
      .filter((id) => !(excludeHandSwap && id === 'hand_swap'))
      .map((id) => RoleDefs.getAbility(id)?.name)
      .filter((name): name is string => Boolean(name))

    const land = () => {
      setSlot(def.name)
      setLanded(true)
      // Auto-close eventually; the ROLE button re-shows everything.
      timers.push(setTimeout(() => dismissRef.current(), 8000))
    }

    if (names.length <= 1) {
      timers.push(setTimeout(land, 400))
    } else {
      // Fast cycling that decelerates, then lands on the real ability.
      let index = Math.floor(Math.random() * names.length)
      let interval = 70
      const step = () => {
        if (interval >= 420) {
          land()
          return
        }
        index = (index + 1) % names.length
        setSlot(names[index])
        interval *= 1.16
        timers.push(setTimeout(step, interval))
      }
      timers.push(setTimeout(step, interval))
    }

    // role and def are module-level definitions, so these are stable across
    // renders -- the roll restarts only when the ability itself changes.
    return () => timers.forEach(clearTimeout)
  }, [role, def, excludeHandSwap])

  if (!role || !def) return null

  return (
    <div
      className="backdrop backdrop--banner"
      onClick={() => landed && onDismiss()}
      role="presentation"
    >
      <div className="note modal modal--banner" role="dialog" aria-modal="true">
        <p className="banner__kicker">YOUR SECRET ROLE</p>
        <h2 className="banner__role" style={{ color: role.color }}>
          {role.emoji} {role.name.toUpperCase()}
        </h2>
        <p className="banner__tagline">“{role.tagline}”</p>

        <p className="banner__slot-kicker">
          {role.abilities.length > 1
            ? '✨ ROLLING THIS ROUND’S ABILITY ✨'
            : '✨ YOUR PERMANENT ABILITY ✨'}
        </p>
        <div className={`banner__slot${landed ? ' is-landed' : ''}`}>{slot}</div>

        {landed && (
          <>
            <p className="banner__desc">
              {def.desc}
              {def.note && (
                <>
                  <br />
                  <span className="banner__note">⚙️ {def.note}</span>
                </>
              )}
            </p>
            <p className="banner__hint">tap anywhere to continue</p>
          </>
        )}
      </div>
    </div>
  )
}
