// Redeem codes: a coin grant handed out by hand (a friend, a launch post, a
// bug apology) rather than earned at a table.
//
// **This catalogue is SERVER-ONLY and must stay that way.** Every other
// catalogue in this app -- emotes, roles, shop items, decks -- lives in
// `src/shared/` precisely so both halves can read it. A code is the one piece
// of shop data whose whole value is that the client does NOT have it: put
// this file in `src/shared/` and every code ships in the JS bundle, where
// view-source is all the redemption anyone needs.
//
// Grants are sized in CATALOGUE COVERAGE rather than a flat number of coins,
// so a code is still worth what it says it is after prices move or new items
// land. See `coverageCost` in db/shop.ts for what "cover this fraction of the
// shop" actually costs.

export type RedeemCode = {
  /** Matched case-insensitively; see `normalizeCode`. */
  code: string
  /**
   * How much of the shop this code is meant to buy, as a fraction of the
   * items the player does not already own: 1 is the whole remaining
   * catalogue, 0.5 is half of it. The wallet is topped UP to that amount, so
   * coins already earned count toward it and a code can never be used as a
   * multiplier on itself.
   */
  coverage: number
  /** Shown back to the player on a successful redeem. */
  label: string
}

export const REDEEM_CODES: readonly RedeemCode[] = [
  {
    code: 'ALLIN52',
    coverage: 1,
    label: 'the whole shop',
  },
  {
    code: 'HALFDECK',
    coverage: 0.5,
    label: 'half the shop',
  },
] as const

/**
 * Codes are typed by hand off a screen or a chat message, so they're matched
 * loosely: case, spaces and the dashes people insert to make them readable
 * are all discarded before the lookup.
 */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const BY_CODE = new Map(REDEEM_CODES.map((entry) => [normalizeCode(entry.code), entry]))

/** Mirrors shopItemById: an unknown code resolves to undefined, never throws. */
export function redeemCodeByName(raw: string): RedeemCode | undefined {
  return BY_CODE.get(normalizeCode(raw))
}
