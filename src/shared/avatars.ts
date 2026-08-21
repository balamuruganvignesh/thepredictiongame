// Player profile logos. A fixed preset set, plus the option to use your
// Google account picture -- shared so the server can validate what the client
// offers, exactly like emotes.ts.
//
// Presets are glyphs rather than uploaded images on purpose: no file storage
// on the Fly volume, no size/type validation, and no moderation story for
// pictures shown to strangers in a public table. The Google picture is the
// one real photo, and it is only ever the player's own, supplied by Google.

export type AvatarPreset = {
  id: string
  glyph: string
  label: string
  /** Set on presets that must be bought (the id doubles as the shop item id). */
  premium?: true
}

/**
 * The sentinel meaning "use my Google account picture". Not a preset -- it
 * resolves to a URL at join time, and falls back to the default mark for a
 * player who isn't signed in or whose account has no picture.
 */
export const GOOGLE_AVATAR = 'google'

export const AVATARS: readonly AvatarPreset[] = [
  { id: 'cat', glyph: '🐱', label: 'Cat' },
  { id: 'fox', glyph: '🦊', label: 'Fox' },
  { id: 'owl', glyph: '🦉', label: 'Owl' },
  { id: 'frog', glyph: '🐸', label: 'Frog' },
  { id: 'bear', glyph: '🐻', label: 'Bear' },
  { id: 'panda', glyph: '🐼', label: 'Panda' },
  { id: 'robot', glyph: '🤖', label: 'Robot' },
  { id: 'alien', glyph: '👽', label: 'Alien' },
  { id: 'ghost', glyph: '👻', label: 'Ghost' },
  { id: 'star', glyph: '⭐', label: 'Star' },
  { id: 'clover', glyph: '🍀', label: 'Clover' },
  { id: 'moon', glyph: '🌙', label: 'Moon' },

  // Bought in the shop. Ids match shared/shop.ts entries of kind 'avatar'.
  { id: 'avatar-dragon', glyph: '🐲', label: 'Dragon', premium: true },
  { id: 'avatar-crown', glyph: '👑', label: 'Monarch', premium: true },
  { id: 'avatar-jester', glyph: '🃏', label: 'Jester', premium: true },
  { id: 'avatar-phoenix', glyph: '🔥', label: 'Phoenix', premium: true },
] as const

const BY_ID = new Map(AVATARS.map((avatar) => [avatar.id, avatar]))

export function avatarById(id: string): AvatarPreset | undefined {
  return BY_ID.get(id)
}

/** The presets a player may actually pick, given what they own. */
export function availableAvatars(owned: readonly string[]): AvatarPreset[] {
  return AVATARS.filter((avatar) => !avatar.premium || owned.includes(avatar.id))
}

/**
 * Whether this id is one the server will accept. GOOGLE_AVATAR is valid for
 * anyone to ASK for -- resolving it to an actual picture (or to nothing) is
 * the server's job, since only it knows whether the asker is signed in.
 */
export function isSelectableAvatar(id: string, owned: readonly string[]): boolean {
  if (id === GOOGLE_AVATAR) return true
  const avatar = avatarById(id)
  return avatar != null && (!avatar.premium || owned.includes(avatar.id))
}

/**
 * A stable colour for a player with no avatar picked, derived from their id
 * so the same player is always the same colour at a table. Deterministic on
 * BOTH sides -- the server never sends a colour, and two clients rendering
 * the same player must agree.
 */
const FALLBACK_COLORS = [
  '#c2603f', '#3f7fc2', '#4aa06a', '#9a5fc0',
  '#c0993f', '#3fa8a0', '#b04a7a', '#6a6fc0',
] as const

export function fallbackAvatarColor(playerId: string): string {
  let hash = 0
  for (let i = 0; i < playerId.length; i++) hash = (hash * 31 + playerId.charCodeAt(i)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}

/** The letter shown when a player has no avatar picked. */
export function initialFor(name: string): string {
  const trimmed = name.trim()
  return trimmed ? trimmed[0].toUpperCase() : '?'
}
