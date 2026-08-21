// Redeem codes: a coin grant handed out by hand (a friend, a launch post, a
// bug apology) rather than earned at a table.
//
// **Server-only, and it must stay that way.** Every other catalogue in this
// app -- emotes, roles, shop items, decks -- lives in `src/shared/` precisely
// so both halves can read it. A code is the one piece of shop data whose whole
// value is that the client does NOT have it: anything reachable from
// `src/client/` ships in the JS bundle, where view-source is all the
// redemption anyone needs.
//
// This file is only the FORMAT and the two built-in codes. The live codes are
// rows in `redeem_codes` (see db/codes.ts) so minting one is a command rather
// than an edit and a redeploy.

/**
 * A grant is one of two shapes, never both:
 *
 *  - `coverage`: a fraction of the shop, priced against the live catalogue at
 *    redemption time, so the code stays worth what it says after a price
 *    change. The wallet is topped UP to it.
 *  - `coins`: a flat number added to the wallet. What you want for a small
 *    thank-you that shouldn't scale with the catalogue.
 */
export type CodeGrant = { coverage: number; coins?: never } | { coins: number; coverage?: never }

export type CodeDefinition = CodeGrant & {
  code: string
  /** Shown back to the player on a successful redeem. */
  label: string
  /** Total redemptions across all players; null is unlimited. */
  maxUses?: number | null
  /** Epoch ms after which the code stops working; null never expires. */
  expiresAt?: number | null
}

/**
 * The codes that exist on a fresh database. Seeded once (see
 * `seedBuiltinCodes`) and then owned by the store like any other -- editing
 * this list does NOT change a code that has already been seeded, which is the
 * point: the store is the authority, so a code you minted by hand can't be
 * clobbered by a deploy.
 */
export const BUILTIN_CODES: readonly CodeDefinition[] = [
  { code: 'ALLIN52', coverage: 1, label: 'the whole shop' },
  { code: 'HALFDECK', coverage: 0.5, label: 'half the shop' },
] as const

/**
 * Codes are typed by hand off a screen or a chat message, so they're matched
 * loosely: case, spaces and the dashes people insert to make them readable
 * are all discarded before the lookup. Stored normalized, printed with a dash.
 */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// No I/O/1/0, the same set room codes use -- these get read aloud and
// retyped, and that's the pair that gets retyped wrong.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A fresh 8-character code, printed as two dash-separated groups of four. */
export function generateCode(): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/** `ABCD-EFGH` -- how a generated code is shown, since nobody reads 8 characters. */
export function formatCode(code: string): string {
  const normalized = normalizeCode(code)
  return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized
}

/** The one-line description of what a grant is worth, for a CLI or admin list. */
export function describeGrant(grant: { coverage: number | null; coins: number | null }): string {
  if (grant.coverage != null) {
    return grant.coverage >= 1
      ? 'covers the whole shop'
      : `covers ${Math.round(grant.coverage * 100)}% of the shop`
  }
  return `${grant.coins} coins`
}
