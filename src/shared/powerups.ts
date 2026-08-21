// Purchasable powerups. Unlike every other shop item these AFFECT PLAY, which
// is why they are gated twice: the host has to switch them on for the table
// (lobby-only, like chaos mode), and each use spends a charge that had to be
// bought. Neither gate is cosmetic -- a table that hasn't opted in behaves
// byte-for-byte as it did before powerups existed.
//
// CHARGES, not permanent unlocks, deliberately. A one-off purchase that works
// in every game forever would make the shop a straight power ladder; a charge
// is spent, so coins keep flowing back out and a rich player still has to
// decide WHICH round is worth it.
//
// The Prediction Game only, for v1. The two info powerups need a private hand
// to read and the scoring one needs a bid to miss, and neither concept exists
// in Golf or Blackjack. Hearts and Spades could take the info ones later --
// their engines would each need their own hook, which is exactly the kind of
// per-game work this app has never tried to share.

export type PowerupDef = {
  id: string
  name: string
  glyph: string
  /** What the player sees before spending a charge. */
  desc: string
  price: number
  /** Whether using it needs an opponent picked first. */
  target: 'none' | 'other'
  /** Which phase it can be used in. */
  phase: 'bidding' | 'playing' | 'any'
}

export const POWERUPS: readonly PowerupDef[] = [
  {
    id: 'powerup-peek',
    name: 'Peek',
    glyph: '👁',
    desc: "See three random cards from another player's hand. Only you are told.",
    price: 60,
    target: 'other',
    phase: 'any',
  },
  {
    id: 'powerup-trump-sense',
    name: 'Trump Sense',
    glyph: '🧭',
    desc: 'Learn how many trump cards every other player is holding. Only you are told.',
    price: 90,
    target: 'none',
    phase: 'any',
  },
  {
    id: 'powerup-safety-net',
    name: 'Safety Net',
    glyph: '🛡',
    desc: 'Miss your bid this round and you score 0 instead of going negative.',
    price: 140,
    target: 'none',
    phase: 'bidding',
  },
] as const

const BY_ID = new Map(POWERUPS.map((p) => [p.id, p]))

export function powerupById(id: string): PowerupDef | undefined {
  return BY_ID.get(id)
}

export const isPowerupId = (id: string): boolean => BY_ID.has(id)
