// The cosmetics catalogue, imported by BOTH sides -- the same shape and the
// same reasoning as emotes.ts and roleDefs.ts. The server is the authority on
// what a player owns and may equip (a hand-driven socket must not be able to
// put an unowned cosmetic on other people's screens), and sharing the list is
// what lets it validate an id without a second copy of the catalogue.
//
// Earned coins only. There is deliberately no price in real money anywhere in
// this app: coins come from placing in the top 3 of a finished game and from
// nowhere else, so there is no payment processor, no refund path and no
// purchase that can fail halfway.

/**
 * Coins awarded for 1st / 2nd / 3rd place in a finished game. The single
 * place to tune the economy -- read by db/persistence.ts when it writes the
 * game result, and by the client to show what a placement was worth.
 */
export const PLACEMENT_COINS = [50, 30, 15] as const

/**
 * A table this small is a coin faucet: with two players somebody always
 * places 1st and 2nd, so a pair could farm the shop in an afternoon.
 */
export const MIN_PLAYERS_FOR_COINS = 3

export type ShopKind = 'theme' | 'cardback' | 'emote'

export type ShopItem = {
  id: string
  kind: ShopKind
  name: string
  blurb: string
  price: number
  /** Shown on the shop card. For a theme, the accent it repaints the table in. */
  swatch?: string
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  // ---- Themes -------------------------------------------------------------
  // Each id has a matching :root[data-theme='<id>'] block in
  // client/styles/tokens.css that overrides the palette tokens. Nothing else
  // in the app knows a theme exists.
  {
    id: 'theme-felt',
    kind: 'theme',
    name: 'Card Room',
    blurb: 'Green baize and brass. The table your grandad lost money at.',
    price: 150,
    swatch: '#1e6b4a',
  },
  {
    id: 'theme-parchment',
    kind: 'theme',
    name: 'Parchment',
    blurb: 'Warm paper and faded ink, for playing in daylight.',
    price: 150,
    swatch: '#c8a870',
  },
  {
    id: 'theme-neon',
    kind: 'theme',
    name: 'Neon',
    blurb: 'Hot magenta on black. Loud, and unapologetic about it.',
    price: 250,
    swatch: '#ff3fa4',
  },
  {
    id: 'theme-ember',
    kind: 'theme',
    name: 'Ember',
    blurb: 'Banked coals and low orange light.',
    price: 250,
    swatch: '#e8642c',
  },

  // ---- Card backs ---------------------------------------------------------
  // Recolours of the active deck's own back sprite, applied as a CSS filter
  // keyed off data-cardback (see client/styles/cards.css). Deliberately not
  // new sprite art: a filter recolours whichever deck you're using, so a
  // player who bought a red back keeps it after switching pixel <-> classic,
  // and there is no second set of files to keep in sync with a third deck.
  {
    id: 'cardback-crimson',
    kind: 'cardback',
    name: 'Crimson Back',
    blurb: 'Deep red, for people who like being looked at.',
    price: 100,
    swatch: '#a52033',
  },
  {
    id: 'cardback-forest',
    kind: 'cardback',
    name: 'Forest Back',
    blurb: 'Quiet green. Nothing to see here.',
    price: 100,
    swatch: '#1f6b3f',
  },
  {
    id: 'cardback-violet',
    kind: 'cardback',
    name: 'Violet Back',
    blurb: 'Purple, and slightly smug about it.',
    price: 100,
    swatch: '#6c3fb0',
  },
  {
    id: 'cardback-ash',
    kind: 'cardback',
    name: 'Ash Back',
    blurb: 'Colourless and severe.',
    price: 180,
    swatch: '#6a6a72',
  },

  // ---- Emotes -------------------------------------------------------------
  // These extend the fixed set in emotes.ts. The base eight stay free forever
  // -- reacting to a trick is core to the table, not a premium feature.
  {
    id: 'emote-crown',
    kind: 'emote',
    name: 'Crown',
    blurb: 'For when the prediction lands exactly.',
    price: 80,
  },
  {
    id: 'emote-snooze',
    kind: 'emote',
    name: 'Snooze',
    blurb: 'A gentle word about how long that turn is taking.',
    price: 80,
  },
  {
    id: 'emote-skull',
    kind: 'emote',
    name: 'Skull',
    blurb: 'That hand did not survive.',
    price: 80,
  },
  {
    id: 'emote-heart',
    kind: 'emote',
    name: 'Heart',
    blurb: 'Good game, genuinely.',
    price: 120,
  },
] as const

const BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]))

/** Mirrors emoteById: unknown ids resolve to undefined, never throw. */
export function shopItemById(id: string): ShopItem | undefined {
  return BY_ID.get(id)
}

export function shopItemsOfKind(kind: ShopKind): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.kind === kind)
}

/** What a signed-in player's wallet and wardrobe look like over the wire. */
export type Equipped = {
  theme: string | null
  cardback: string | null
}

export type MeAccount = {
  playerId: string
  name: string | null
  picture: string | null
  coins: number
  owned: string[]
  equipped: Equipped
}
