// A player's profile logo, shown next to their name everywhere they appear.
//
// Three tiers, in priority order: a Google account picture, a preset glyph,
// or an initial on a colour derived from the player's id. The fallback is
// deliberately never blank -- every player has a visual identity at the table
// whether or not they signed in, picked anything, or spent a coin.

import { avatarById, fallbackAvatarColor, initialFor } from '@shared/avatars'

export function Avatar({
  playerId,
  name,
  avatar,
  avatarUrl,
  size = 'md',
}: {
  playerId: string
  name: string
  avatar?: string
  avatarUrl?: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const preset = avatar ? avatarById(avatar) : undefined

  // aria-hidden throughout: the player's NAME is always rendered right next
  // to this, so a screen reader announcing "Cat, Ada" would just be noise.
  if (avatarUrl) {
    return (
      <img
        className={`avatar avatar--${size} avatar--photo`}
        src={avatarUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        referrerPolicy="no-referrer"
      />
    )
  }

  if (preset) {
    return (
      <span className={`avatar avatar--${size}`} aria-hidden="true">
        {preset.glyph}
      </span>
    )
  }

  return (
    <span
      className={`avatar avatar--${size} avatar--initial`}
      style={{ background: fallbackAvatarColor(playerId) }}
      aria-hidden="true"
    >
      {initialFor(name)}
    </span>
  )
}
