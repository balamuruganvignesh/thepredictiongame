// The wallet and the wardrobe. Everything here is keyed by `player_id`, never
// by account id, for one deliberate reason: an anonymous player earns coins
// too, and if they later sign in and that id is adopted as canonical (see
// accounts.ts's merge step) the whole wallet comes with them. Signing in is a
// reward, not a prerequisite.
//
// Buying is the one thing that DOES require an account, because there is
// nowhere durable to put a purchase made by a browser that might clear its
// storage tomorrow -- that check lives in the route, not here.

import { shopItemById, type Equipped } from '@shared/shop'
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

const selectOwned = db.prepare(`SELECT item_id FROM owned_items WHERE player_id = ?`)
const insertOwned = db.prepare(`
  INSERT INTO owned_items (player_id, item_id, bought_at) VALUES (@playerId, @itemId, @now)
`)

const selectEquipped = db.prepare(`SELECT theme, cardback FROM equipped_items WHERE player_id = ?`)
const upsertEquipped = db.prepare(`
  INSERT INTO equipped_items (player_id, theme, cardback)
  VALUES (@playerId, @theme, @cardback)
  ON CONFLICT(player_id) DO UPDATE SET theme = @theme, cardback = @cardback
`)

/**
 * The authoritative balance is always the SUM of the ledger, never
 * accounts.coins -- that column is a denormalized cache for cheap reads, and
 * reading it here instead is how a drift bug turns into free money.
 */
export function getBalance(playerId: string): number {
  return (selectBalance.get(playerId) as { balance: number }).balance
}

export function getOwned(playerId: string): string[] {
  return (selectOwned.all(playerId) as { item_id: string }[]).map((row) => row.item_id)
}

export function getEquipped(playerId: string): Equipped {
  const row = selectEquipped.get(playerId) as { theme: string | null; cardback: string | null } | undefined
  return { theme: row?.theme ?? null, cardback: row?.cardback ?? null }
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
  const item = shopItemById(itemId)
  if (!item) return { ok: false, error: 'No such item.' }

  if (getOwned(playerId).includes(itemId)) {
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
export function equipItem(playerId: string, kind: 'theme' | 'cardback', itemId: string | null): EquipResult {
  if (itemId !== null) {
    const item = shopItemById(itemId)
    if (!item || item.kind !== kind) return { ok: false, error: 'No such item.' }
    if (!getOwned(playerId).includes(itemId)) return { ok: false, error: "You don't own that." }
  }

  const current = getEquipped(playerId)
  const next: Equipped = { ...current, [kind]: itemId }
  try {
    upsertEquipped.run({ playerId, theme: next.theme, cardback: next.cardback })
  } catch (error) {
    log.error('shop.equip.failed', { error: String(error) })
    return { ok: false, error: 'Could not save that.' }
  }
  return { ok: true, equipped: next }
}
