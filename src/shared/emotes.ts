// The reaction set, shared so the client can only offer what the server will
// accept -- the same reason every rules module in here is shared. The server
// validates the id against this list and ignores anything else, so a crafted
// socket message can't put arbitrary text on the table.
//
// A FIXED set, not free text, and that's the point: reactions are the
// non-chat channel. Chat already exists for anything you actually want to
// say, and an open-ended emote field would just be a second chat with worse
// moderation and no history.

export type Emote = { id: string; glyph: string; label: string }

export const EMOTES: readonly Emote[] = [
  { id: 'clap', glyph: '👏', label: 'nice one' },
  { id: 'oof', glyph: '😬', label: 'oof' },
  { id: 'laugh', glyph: '😂', label: 'ha!' },
  { id: 'think', glyph: '🤔', label: 'hmm…' },
  { id: 'fire', glyph: '🔥', label: 'on fire' },
  { id: 'salt', glyph: '🧂', label: 'salty' },
  { id: 'shock', glyph: '😱', label: 'no way' },
  { id: 'gg', glyph: '🤝', label: 'gg' },
] as const

const BY_ID = new Map(EMOTES.map((emote) => [emote.id, emote]))

export function emoteById(id: string): Emote | undefined {
  return BY_ID.get(id)
}

/**
 * Minimum gap between one seat's reactions. Enforced on the SERVER -- a
 * client-side cooldown is a courtesy, not a limit, and this one has to hold
 * against a socket someone is driving by hand. Deliberately generous enough
 * that normal use never hits it: it exists to stop a firehose, not to ration
 * reacting.
 */
export const EMOTE_COOLDOWN_MS = 1200
