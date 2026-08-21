// Which card art renders. Shared for the same reason emotes.ts, avatars.ts
// and shop.ts are: the server is the authority on what a player owns and may
// equip, and one catalogue is what lets it validate an id without a second
// copy of the list.
//
// The free default is the CLASSIC deck -- a player who has never earned a
// coin still gets the real, photographed cards. Everything else is bought,
// which makes the deck a genuine cosmetic slot alongside themes and card
// backs rather than a free toggle.
//
// Only TWO sprite folders exist (`art`), and that is deliberate: the premium
// skins beyond the pixel deck are CSS filters over the classic sprites, the
// same reasoning card backs already use for their tint. One rule restyles all
// 55 cards, nothing new has to be drawn, and a future third sprite folder
// inherits the mechanism for free.

/** The two sprite folders under client/public: cards/ and cards-classic/. */
export type DeckArt = 'pixel' | 'classic'

export type DeckSkin = {
  id: string
  label: string
  art: DeckArt
  blurb: string
  /** Set on skins that must be bought (the id doubles as the shop item id). */
  premium?: true
}

/** The free look, and what an unowned or unequipped slot falls back to. */
export const DEFAULT_DECK = 'classic'

export const DECKS: readonly DeckSkin[] = [
  {
    id: 'classic',
    label: 'Classic',
    art: 'classic',
    blurb: 'The photographed deck. Free, and what every table starts on.',
  },
  {
    id: 'deck-pixel',
    label: 'Pixel',
    art: 'pixel',
    blurb: "Kenney's pixel-art deck, upscaled crisp.",
    premium: true,
  },
  {
    id: 'deck-negative',
    label: 'Negative',
    art: 'classic',
    blurb: 'The classic deck inverted — white ink on black. Red suits stay red.',
    premium: true,
  },
  {
    id: 'deck-vintage',
    label: 'Vintage',
    art: 'classic',
    blurb: 'The classic deck, aged. Tea-stained and slightly tired.',
    premium: true,
  },
] as const

const BY_ID = new Map(DECKS.map((deck) => [deck.id, deck]))

/** Mirrors avatarById / emoteById: unknown ids resolve to undefined. */
export function deckById(id: string): DeckSkin | undefined {
  return BY_ID.get(id)
}

/** The skins a player may actually pick, given what they own. */
export function availableDecks(owned: readonly string[]): DeckSkin[] {
  return DECKS.filter((deck) => !deck.premium || owned.includes(deck.id))
}

/** Which sprite folder an id renders from, defaulting safely. */
export function deckArt(id: string): DeckArt {
  return deckById(id)?.art ?? 'classic'
}
