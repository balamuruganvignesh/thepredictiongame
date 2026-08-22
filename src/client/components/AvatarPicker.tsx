// Pick your profile logo. Two sources in one grid: the preset glyphs from
// shared/avatars.ts and your Google account picture if you're signed in.
//
// The choice is written to localStorage -- what an anonymous OR signed-in
// player sends on join. A signed-in player's playerId is still resolved from
// their session server-side, exactly like before; only the avatar preference
// itself is local now.

import { useState } from 'react'
import { availableAvatars, GOOGLE_AVATAR } from '@shared/avatars'
import { useAuth } from '../auth'
import { rememberAvatar, storedAvatar } from '../socket'
import { Avatar } from './Avatar'

export function AvatarPicker({ name }: { name: string }) {
  const { account } = useAuth()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string>(() => storedAvatar() ?? '')

  const current = chosen
  const options = availableAvatars()

  const pick = (id: string) => {
    rememberAvatar(id)
    setChosen(id)
    setOpen(false)
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
    </div>
  )
}
