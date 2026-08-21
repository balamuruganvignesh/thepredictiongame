// The dock's powerup tray. Only rendered when the host has powerups on AND
// you're actually holding a charge, so a table that never opted in shows
// nothing at all and a player with an empty tray isn't taunted by a dead
// button.
//
// It lives in the dock rather than behind SETTINGS because it follows the
// rule the dock already keeps: moment-to-moment ACTIONS live in the dock.
// Spending a Peek is a decision about the hand in front of you, and two
// clicks into a menu it would never get used.
//
// No backdrop, same as QuickAbility and EmoteBar: you're spending this
// BECAUSE of what's on the table, so the table has to stay visible.

import { useState } from 'react'
import { POWERUPS, powerupById } from '@shared/powerups'

export function PowerupBar({
  charges,
  players,
  meId,
  onUse,
}: {
  charges: Record<string, number>
  players: { id: string; name: string }[]
  meId: string | null
  onUse: (powerupId: string, targetId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [aiming, setAiming] = useState<string | null>(null)

  const held = POWERUPS.filter((p) => (charges[p.id] ?? 0) > 0)
  if (held.length === 0) return null

  const close = () => {
    setOpen(false)
    setAiming(null)
  }

  const aimingDef = aiming ? powerupById(aiming) : null

  return (
    <div className="powerups">
      {open && (
        <div className="note powerups__pop" role="group" aria-label="Powerups">
          {aimingDef ? (
            <>
              <p className="powerups__aim-title">{aimingDef.name} — pick a player</p>
              {players
                .filter((player) => player.id !== meId)
                .map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className="powerups__pick"
                    onClick={() => {
                      onUse(aimingDef.id, player.id)
                      close()
                    }}
                  >
                    {player.name}
                  </button>
                ))}
              <button type="button" className="powerups__cancel" onClick={() => setAiming(null)}>
                back
              </button>
            </>
          ) : (
            held.map((powerup) => (
              <button
                key={powerup.id}
                type="button"
                className="powerups__pick"
                onClick={() => {
                  // A targeted powerup opens the picker instead of firing, so
                  // a charge is never spent before the player has chosen who
                  // it lands on.
                  if (powerup.target === 'other') setAiming(powerup.id)
                  else {
                    onUse(powerup.id)
                    close()
                  }
                }}
              >
                <span className="powerups__glyph" aria-hidden="true">
                  {powerup.glyph}
                </span>
                <span className="powerups__body">
                  <span className="powerups__name">
                    {powerup.name} ×{charges[powerup.id]}
                  </span>
                  <span className="powerups__desc">{powerup.desc}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <button
        className="dock__button dock__button--powerup"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-label="Powerups"
      >
        ⚡
      </button>
    </div>
  )
}
