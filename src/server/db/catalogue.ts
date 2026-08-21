// The shop catalogue as the SERVER sees it: shared/shop.ts's items with any
// price or visibility change from `item_overrides` applied on top.
//
// **Every server-side price read goes through here, never through
// `shopItemById(...).price` directly.** There are only three of them
// (`buyItem`, `coverageCost`, and the /api/shop response), and they have to
// agree: a purchase charged at the catalogue price while the shop advertises
// an overridden one is a shop that lies about its prices.
//
// Only CHANGED items get a row. That keeps shared/shop.ts the readable source
// of what the shop is, and this table the short list of what has been tuned
// since -- which is also what makes "revert" a delete rather than a second
// copy of the original number.

import { SHOP_ITEMS, shopItemById, type ShopItem } from '@shared/shop'
import { db } from './index'
import { log } from '../logger'

export type OverrideRow = { item_id: string; price: number | null; hidden: number; updated_at: number }

/** A catalogue item with its live price, plus whether it is off sale. */
export type PricedItem = ShopItem & {
  hidden: boolean
  /** The catalogue price, when an override is in force. Null when it isn't. */
  basePrice: number | null
}

const selectOverrides = db.prepare(`SELECT * FROM item_overrides`)
const selectOverride = db.prepare(`SELECT * FROM item_overrides WHERE item_id = ?`)
const upsertOverride = db.prepare(`
  INSERT INTO item_overrides (item_id, price, hidden, updated_at)
  VALUES (@itemId, @price, @hidden, @now)
  ON CONFLICT(item_id) DO UPDATE SET price = @price, hidden = @hidden, updated_at = @now
`)
const deleteOverride = db.prepare(`DELETE FROM item_overrides WHERE item_id = ?`)

function apply(item: ShopItem, row: OverrideRow | undefined): PricedItem {
  const overridden = row?.price != null && row.price !== item.price
  return {
    ...item,
    price: row?.price ?? item.price,
    hidden: row?.hidden === 1,
    basePrice: overridden ? item.price : null,
  }
}

/**
 * The whole catalogue at live prices, hidden items included -- callers that
 * are SELLING must filter on `hidden` themselves (`sellableItems` below).
 * The admin list wants them, so this doesn't drop them.
 */
export function pricedItems(): PricedItem[] {
  const rows = new Map((selectOverrides.all() as OverrideRow[]).map((row) => [row.item_id, row]))
  return SHOP_ITEMS.map((item) => apply(item, rows.get(item.id)))
}

/** What the shop offers: live prices, hidden items dropped. */
export function sellableItems(): PricedItem[] {
  return pricedItems().filter((item) => !item.hidden)
}

/**
 * One item at its live price. Returns undefined for an unknown id, exactly
 * like `shopItemById` -- callers already treat that as "no such item".
 */
export function pricedItem(itemId: string): PricedItem | undefined {
  const item = shopItemById(itemId)
  if (!item) return undefined
  return apply(item, selectOverride.get(itemId) as OverrideRow | undefined)
}

export type OverrideResult = { ok: true; item: PricedItem } | { ok: false; error: string }

/**
 * Sets an item's price and/or visibility. A price equal to the catalogue's is
 * still stored, because "deliberately pinned to 150" and "never touched" are
 * different states to whoever is tuning the economy -- `revertItem` is how you
 * get back to untouched.
 */
export function setItemOverride(
  itemId: string,
  changes: { price?: number | null; hidden?: boolean },
): OverrideResult {
  const item = shopItemById(itemId)
  if (!item) return { ok: false, error: 'No such item.' }

  if (changes.price != null && !(Number.isInteger(changes.price) && changes.price >= 0)) {
    return { ok: false, error: 'A price must be a whole number of coins, 0 or more.' }
  }

  const current = selectOverride.get(itemId) as OverrideRow | undefined
  const price = changes.price !== undefined ? changes.price : (current?.price ?? null)
  const hidden = changes.hidden !== undefined ? changes.hidden : current?.hidden === 1

  upsertOverride.run({ itemId, price, hidden: hidden ? 1 : 0, now: Date.now() })
  log.info('shop.override', { itemId, price, hidden })
  return { ok: true, item: pricedItem(itemId)! }
}

/** Drops the override, putting the item back to exactly what the catalogue says. */
export function revertItem(itemId: string): boolean {
  return deleteOverride.run(itemId).changes > 0
}
