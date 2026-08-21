// The reaction set, shared so the client can only offer what the server will
// accept -- the same reason every rules module in here is shared. The server
// validates the id against this list and ignores anything else, so a crafted
// socket message can't put arbitrary text on the table.
//
// A FIXED set, not free text, and that's the point: reactions are the
// non-chat channel. Chat already exists for anything you actually want to
// say, and an open-ended emote field would just be a second chat with worse
// moderation and no history.

export type Emote = {
  id: string
  glyph: string
  label: string
  /**
   * Set on emotes that must be bought (the id doubles as the shop item id,
   * see shared/shop.ts). Unset means free forever -- the original eight stay
   * free deliberately, because reacting to the trick that just landed is core
   * to the table, not a premium feature.
   *
   * The server re-checks ownership in Room.emote; this flag is what lets the
   * CLIENT know not to offer a button it would only get dropped for.
   */
  premium?: true
}

export const EMOTES: readonly Emote[] = [
  { id: 'clap', glyph: '👏', label: 'nice one' },
  { id: 'oof', glyph: '😬', label: 'oof' },
  { id: 'laugh', glyph: '😂', label: 'ha!' },
  { id: 'think', glyph: '🤔', label: 'hmm…' },
  { id: 'fire', glyph: '🔥', label: 'on fire' },
  { id: 'salt', glyph: '🧂', label: 'salty' },
  { id: 'shock', glyph: '😱', label: 'no way' },
  { id: 'gg', glyph: '🤝', label: 'gg' },

  // Bought in the shop. Ids match shared/shop.ts entries of kind 'emote'.
  { id: 'emote-crown', glyph: '👑', label: 'called it', premium: true },
  { id: 'emote-snooze', glyph: '😴', label: 'any day now', premium: true },
  { id: 'emote-skull', glyph: '💀', label: 'that hand is gone', premium: true },
  { id: 'emote-heart', glyph: '💖', label: 'good game', premium: true },
] as const

const BY_ID = new Map(EMOTES.map((emote) => [emote.id, emote]))

export function emoteById(id: string): Emote | undefined {
  return BY_ID.get(id)
}

/** The reactions a player may actually send, given what they own. */
export function availableEmotes(owned: readonly string[]): Emote[] {
  return EMOTES.filter((emote) => !emote.premium || owned.includes(emote.id))
}

/**
 * Minimum gap between one seat's reactions. Enforced on the SERVER -- a
 * client-side cooldown is a courtesy, not a limit, and this one has to hold
 * against a socket someone is driving by hand. Deliberately generous enough
 * that normal use never hits it: it exists to stop a firehose, not to ration
 * reacting.
 */
export const EMOTE_COOLDOWN_MS = 1200
