// The wallet and the wardrobe. Everything here is keyed by `player_id`, never
// by account id, for one deliberate reason: an anonymous player earns coins
// too, and if they later sign in and that id is adopted as canonical (see
// accounts.ts's merge step) the whole wallet comes with them. Signing in is a
// reward, not a prerequisite.
//
// Spending does NOT require an account either. An anonymous browser spends
// against the playerId it already keeps in localStorage -- the same id that
// earned the coins, holds the seat and carries the chaos role history -- and
// signing in later adopts that id, wallet and wardrobe intact. The risk that
// buys is: an anonymous wallet lives and dies with one browser's storage.
// That's the player's to accept, and it keeps signing in a reward rather than
// a toll gate on coins they already earned.

import { GOOGLE_AVATAR, isSelectableAvatar } from '@shared/avatars'
import { shopItemById, type Equipped } from '@shared/shop'
import { pricedItem, sellableItems } from './catalogue'
import { bumpCodeUses, getCode } from './codes'
import { db } from './index'
import { log } from '../logger'

const selectBalance = db.prepare(`
  SELECT COALESCE(SUM(delta), 0) AS balance FROM coin_ledger WHERE player_id = ?
`)

const insertLedger = db.prepare(`
  INSERT INTO coin_ledger (player_id, delta, reason, game_result_id, created_at)
  VALUES (@playerId, @delta, @reason, @gameResultId, @now)
`)

const syncAccountCoins = db.prepare(`
  UPDATE accounts SET coins = (
    SELECT COALESCE(SUM(delta), 0) FROM coin_ledger WHERE player_id = accounts.player_id
  ) WHERE player_id = @playerId
`)

const selectOwned = db.prepare(`SELECT item_id, quantity FROM owned_items WHERE player_id = ?`)
const insertOwned = db.prepare(`
  INSERT INTO owned_items (player_id, item_id, bought_at, quantity)
  VALUES (@playerId, @itemId, @now, 1)
  ON CONFLICT(player_id, item_id) DO UPDATE SET quantity = quantity + 1
`)
const spendCharge = db.prepare(`
  UPDATE owned_items SET quantity = quantity - 1
  WHERE player_id = @playerId AND item_id = @itemId AND quantity > 0
`)

const selectEquipped = db.prepare(`
  SELECT theme, cardback, avatar, deck FROM equipped_items WHERE player_id = ?
`)
const upsertEquipped = db.prepare(`
  INSERT INTO equipped_items (player_id, theme, cardback, avatar, deck)
  VALUES (@playerId, @theme, @cardback, @avatar, @deck)
  ON CONFLICT(player_id) DO UPDATE SET
    theme = @theme, cardback = @cardback, avatar = @avatar, deck = @deck
`)

/**
 * The authoritative balance is always the SUM of the ledger, never
 * accounts.coins -- that column is a denormalized cache for cheap reads, and
 * reading it here instead is how a drift bug turns into free money.
 */
export function getBalance(playerId: string): number {
  return (selectBalance.get(playerId) as { balance: number }).balance
}

type OwnedRow = { item_id: string; quantity: number }

/**
 * Item ids the player owns at least one of. A consumable with zero charges
 * left is NOT owned -- it keeps its row so the next purchase increments
 * rather than inserting, but it must not unlock anything.
 */
export function getOwned(playerId: string): string[] {
  return (selectOwned.all(playerId) as OwnedRow[])
    .filter((row) => row.quantity > 0)
    .map((row) => row.item_id)
}

/** Charges per consumable item id, for the powerup tray. */
export function getCharges(playerId: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of selectOwned.all(playerId) as OwnedRow[]) {
    if (row.quantity > 0) out[row.item_id] = row.quantity
  }
  return out
}

/**
 * Spends one charge. Returns false if there wasn't one -- the caller must
 * treat that as "the powerup did not happen", since this is the only thing
 * standing between a hand-driven socket and infinite powerups.
 */
export function spendPowerupCharge(playerId: string, itemId: string): boolean {
  return spendCharge.run({ playerId, itemId }).changes > 0
}

export function getEquipped(playerId: string): Equipped {
  const row = selectEquipped.get(playerId) as
    | { theme: string | null; cardback: string | null; avatar: string | null; deck: string | null }
    | undefined
  return {
    theme: row?.theme ?? null,
    cardback: row?.cardback ?? null,
    avatar: row?.avatar ?? null,
    deck: row?.deck ?? null,
  }
}

/**
 * Credits coins inside an EXISTING transaction (persistence.ts's recordGame),
 * so the award and the game row it came from commit together or not at all.
 * Not exported as a standalone write on purpose.
 */
export function creditCoins(opts: {
  playerId: string
  delta: number
  reason: string
  gameResultId: number | null
}): void {
  insertLedger.run({ ...opts, gameResultId: opts.gameResultId, now: Date.now() })
  syncAccountCoins.run({ playerId: opts.playerId })
}

export type BuyResult = { ok: true; balance: number } | { ok: false; error: string }

/**
 * One transaction that re-reads the balance at write time. Checking the
 * balance in the route and spending it here would be a classic double-spend
 * window; SQLite's transaction is what closes it.
 */
export const buyItem = db.transaction((playerId: string, itemId: string): BuyResult => {
  // The LIVE price, never the catalogue's -- charging one number while the
  // shop advertises another is a shop that lies about its prices.
  const item = pricedItem(itemId)
  if (!item) return { ok: false, error: 'No such item.' }
  if (item.hidden) return { ok: false, error: 'That item is not for sale.' }

  // A consumable is bought in charges, so owning one is no reason to refuse
  // another -- that's the whole point of it being spent in play.
  if (!item.consumable && getOwned(playerId).includes(itemId)) {
    return { ok: false, error: 'You already own that.' }
  }

  const balance = getBalance(playerId)
  if (balance < item.price) {
    return { ok: false, error: `Not enough coins -- that costs ${item.price}, you have ${balance}.` }
  }

  const now = Date.now()
  insertOwned.run({ playerId, itemId, now })
  insertLedger.run({
    playerId,
    delta: -item.price,
    reason: 'purchase',
    gameResultId: null,
    now,
  })
  syncAccountCoins.run({ playerId })

  return { ok: true, balance: balance - item.price }
})

export type EquipResult = { ok: true; equipped: Equipped } | { ok: false; error: string }

/**
 * Ownership is re-checked here, not just in the UI: the shop page hiding a
 * button is a courtesy, and a hand-rolled POST is not.
 *
 * `itemId` of null un-equips, which is how a player gets back to the default
 * look without owning anything.
 */
export function equipItem(
  playerId: string,
  kind: 'theme' | 'cardback' | 'avatar' | 'deck',
  itemId: string | null,
): EquipResult {
  if (itemId !== null) {
    if (kind === 'avatar') {
      // Avatars are the one slot whose free options aren't shop items at all
      // (the presets in shared/avatars.ts), plus the GOOGLE_AVATAR sentinel,
      // so ownership is checked against that list rather than the catalogue.
      if (!isSelectableAvatar(itemId, getOwned(playerId))) {
        return { ok: false, error: itemId === GOOGLE_AVATAR ? 'Sign in first.' : "You don't own that." }
      }
    } else {
      const item = shopItemById(itemId)
      if (!item || item.kind !== kind) return { ok: false, error: 'No such item.' }
      if (!getOwned(playerId).includes(itemId)) return { ok: false, error: "You don't own that." }
    }
  }

  const current = getEquipped(playerId)
  const next: Equipped = { ...current, [kind]: itemId }
  try {
    upsertEquipped.run({
      playerId,
      theme: next.theme,
      cardback: next.cardback,
      avatar: next.avatar,
      deck: next.deck,
    })
  } catch (error) {
    log.error('shop.equip.failed', { error: String(error) })
    return { ok: false, error: 'Could not save that.' }
  }
  return { ok: true, equipped: next }
}

// ---- Redeem codes ------------------------------------------------------------
//
// A code is a coin GRANT, never an item grant, and that is deliberate: coins
// go through the same ledger and the same buyItem transaction every other
// purchase does, so a redeemed player owns things by buying them and there is
// exactly one code path that can put an item in a wardrobe.

const selectRedeemed = db.prepare(`SELECT code FROM redeemed_codes WHERE player_id = ? AND code = ?`)
const insertRedeemed = db.prepare(`
  INSERT INTO redeemed_codes (player_id, code, coins, redeemed_at)
  VALUES (@playerId, @code, @coins, @now)
`)

/**
 * What it costs to buy the given FRACTION of the items this player doesn't
 * already own -- the cheapest ones first, so "half the shop" means half the
 * items rather than half the money (they are not the same number, and the
 * item count is the promise a code makes).
 *
 * Sized against what's UNOWNED so a code is worth the same to a new player
 * and to one who has already bought a theme, and computed off the live
 * catalogue so it stays honest when prices move or items are added.
 */
export function coverageCost(playerId: string, fraction: number): number {
  const owned = new Set(getOwned(playerId))
  // Live prices and only what's actually on sale: a code promising "the whole
  // shop" has to mean the shop as it stands today, not as shared/shop.ts
  // priced it.
  const prices = sellableItems()
    .filter((item) => !owned.has(item.id))
    .map((item) => item.price)
    .sort((a, b) => a - b)
  const count = Math.ceil(prices.length * fraction)
  return prices.slice(0, count).reduce((sum, price) => sum + price, 0)
}

export type RedeemResult =
  | { ok: true; granted: number; balance: number }
  | { ok: false; error: string }

/**
 * Tops the wallet UP to what the code covers rather than adding a flat sum.
 * Two reasons: a code promises "enough to buy X", which is a target and not
 * an amount; and coins already earned then count toward it, so nobody can
 * stack a code on top of a full wallet and walk away with double the shop.
 */
export const redeemCode = db.transaction((playerId: string, rawCode: string): RedeemResult => {
  const entry = getCode(rawCode)
  if (!entry) return { ok: false, error: 'That code is not valid.' }
  if (entry.expires_at != null && entry.expires_at < Date.now()) {
    return { ok: false, error: 'That code has expired.' }
  }
  if (entry.max_uses != null && entry.uses >= entry.max_uses) {
    return { ok: false, error: 'That code has been fully claimed.' }
  }
  if (selectRedeemed.get(playerId, entry.code)) {
    return { ok: false, error: "You've already redeemed that code." }
  }

  const balance = getBalance(playerId)
  // A coverage code is a TARGET and tops the wallet up to it; a flat-coin
  // code is an AMOUNT and simply adds. Both are grants, but only the first
  // can be satisfied by coins you already have -- which is why only the
  // first can come out at zero.
  const granted =
    entry.coverage != null
      ? Math.max(0, coverageCost(playerId, entry.coverage) - balance)
      : (entry.coins ?? 0)
  if (granted === 0) {
    // Burning the code for nothing would be the worst possible outcome for
    // a player who happened to be rich when they typed it, so it stays
    // unredeemed and usable later.
    return { ok: false, error: `You already have enough coins for ${entry.label}.` }
  }

  const now = Date.now()
  insertLedger.run({
    playerId,
    delta: granted,
    reason: `code:${entry.code}`,
    gameResultId: null,
    now,
  })
  syncAccountCoins.run({ playerId })
  insertRedeemed.run({ playerId, code: entry.code, coins: granted, now })
  // Inside the same transaction as the grant it counts, so the two can never
  // disagree about how many times a code was actually claimed.
  bumpCodeUses.run(entry.code)

  return { ok: true, granted, balance: balance + granted }
})
