// Pick your profile logo. Two sources in one grid: the preset glyphs from
// shared/avatars.ts (free, plus a few bought in the shop) and your Google
// account picture if you're signed in.
//
// The choice is written BOTH to localStorage and, when signed in, to the
// server -- localStorage is what an anonymous player sends on join, and the
// server copy is what makes the logo follow a signed-in player to another
// device. A signed-in player's localStorage value is ignored by the server on
// join, exactly like their playerId.

import { useState } from 'react'
import { AVATARS, availableAvatars, GOOGLE_AVATAR } from '@shared/avatars'
import { useAuth } from '../auth'
import { rememberAvatar, storedAvatar } from '../socket'
import { Avatar } from './Avatar'

export function AvatarPicker({ name }: { name: string }) {
  const { account } = useAuth()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string>(() => storedAvatar() ?? '')

  // The server is authoritative once it has spoken, so a signed-in player
  // sees what their account actually carries rather than this browser's copy.
  const current = account?.equipped.avatar ?? chosen
  const owned = account?.owned ?? []
  const options = availableAvatars(owned)
  const hasLocked = AVATARS.some((preset) => preset.premium && !owned.includes(preset.id))

  const pick = (id: string) => {
    rememberAvatar(id)
    setChosen(id)
    setOpen(false)
    void fetch('/api/shop/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'avatar', itemId: id || null }),
    }).catch(() => {
      // Signed out or offline: the local pick still applies and still rides
      // the next join, so there is nothing useful to tell the player here.
    })
  }

  const previewUrl = current === GOOGLE_AVATAR ? (account?.picture ?? undefined) : undefined
  const previewPreset = current && current !== GOOGLE_AVATAR ? current : undefined

  return (
    <div className="avatar-picker">
      <button
        type="button"
        className="avatar-picker__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Avatar
          playerId={account?.playerId ?? 'anon'}
          name={name}
          avatar={previewPreset}
          avatarUrl={previewUrl}
          size="lg"
        />
        <span className="avatar-picker__hint">{open ? 'close' : 'change'}</span>
      </button>

      {open && (
        <div className="note avatar-picker__pop" role="group" aria-label="Choose a profile logo">
          {account?.picture && (
            <button
              type="button"
              className={`avatar-picker__option${current === GOOGLE_AVATAR ? ' is-active' : ''}`}
              onClick={() => pick(GOOGLE_AVATAR)}
              title="Your Google picture"
            >
              <img src={account.picture} alt="" className="avatar avatar--md avatar--photo" referrerPolicy="no-referrer" />
            </button>
          )}

          {options.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`avatar-picker__option${current === preset.id ? ' is-active' : ''}`}
              onClick={() => pick(preset.id)}
              title={preset.label}
              aria-label={preset.label}
            >
              <span className="avatar avatar--md">{preset.glyph}</span>
            </button>
          ))}

          <button
            type="button"
            className={`avatar-picker__option${!current ? ' is-active' : ''}`}
            onClick={() => pick('')}
            title="Just my initial"
            aria-label="Just my initial"
          >
            <Avatar playerId={account?.playerId ?? 'anon'} name={name} size="md" />
          </button>
        </div>
      )}

      {/* Only shown when a premium avatar is actually still locked, so a
          player who owns them all isn't nagged. */}
      {hasLocked && (
        <a className="avatar-picker__more" href="/shop">
          More in the shop →
        </a>
      )}
    </div>
  )
}
