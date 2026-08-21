// Every wallet and cosmetics rule that can be checked without a server: the
// placement payout table (including its two faucet guards and its tie
// handling), and the buy/equip transaction rules.
//
// Unlike the other *-test.ts scripts these touch SQLite, so this one points
// DATABASE_PATH at a throwaway file BEFORE importing anything -- db/index.ts
// resolves the path at module load, which is why every import below is
// dynamic. Delete-and-recreate rather than reuse: an assertion on an absolute
// balance is only meaningful against a known-empty store.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-shop-test-'))
process.env.DATABASE_PATH = path.join(dir, 'test.db')

const { recordGameEnded, recordGameAbandoned } = await import('../src/server/db/persistence')
const {
  buyItem,
  coverageCost,
  equipItem,
  getBalance,
  getCharges,
  getEquipped,
  getOwned,
  redeemCode,
  spendPowerupCharge,
} = await import('../src/server/db/shop')
const { PLACEMENT_COINS, SHOP_ITEMS } = await import('../src/shared/shop')
const { REDEEM_CODES } = await import('../src/server/codes')
const { GOOGLE_AVATAR } = await import('../src/shared/avatars')
type Standing = import('../src/shared/protocol').Standing

let failures = 0
function check(label: string, ok: boolean) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures++
}

const s = (id: string, totalScore: number): Standing => ({ id, name: id, totalScore })
const [FIRST, SECOND, THIRD] = PLACEMENT_COINS

console.log('placement payouts')

recordGameEnded({
  roomCode: 'AAAA',
  gameType: 'spades',
  gameName: 'Spades',
  standings: [s('a', 500), s('b', 400), s('c', 300), s('d', 200)],
})
check('1st place is paid', getBalance('a') === FIRST)
check('2nd place is paid', getBalance('b') === SECOND)
check('3rd place is paid', getBalance('c') === THIRD)
check('4th place is paid nothing', getBalance('d') === 0)

// An abandoned game has no real winner -- the same reason the leaderboard
// refuses to count one as a win.
recordGameAbandoned({
  roomCode: 'BBBB',
  gameType: 'spades',
  gameName: 'Spades',
  roundNumber: 3,
  standings: [s('a', 500), s('b', 400), s('c', 300)],
})
check('an abandoned game pays nobody', getBalance('a') === FIRST && getBalance('b') === SECOND)

// With two players somebody always places 1st and 2nd, so a pair could farm
// the whole shop in an afternoon.
recordGameEnded({
  roomCode: 'CCCC',
  gameType: 'blackjack',
  gameName: 'Blackjack',
  standings: [s('x', 9), s('y', 3)],
})
check('a 2-player table pays nobody', getBalance('x') === 0 && getBalance('y') === 0)

// Standard competition ranking: tied players share the BETTER placement, and
// the placement below them is skipped accordingly. This is why the payout is
// computed from totalScore and not from the `rank` column game_result_players
// stores, which is raw array position and gives tied players distinct ranks.
recordGameEnded({
  roomCode: 'DDDD',
  gameType: 'golf',
  gameName: 'Golf',
  standings: [s('p', 10), s('q', 10), s('r', 5), s('t', 1)],
})
check('both tied leaders are paid first place', getBalance('p') === FIRST && getBalance('q') === FIRST)
check('the seat below a tied pair gets THIRD, not second', getBalance('r') === THIRD)
check('fourth is still paid nothing', getBalance('t') === 0)

recordGameEnded({
  roomCode: 'EEEE',
  gameType: 'hearts',
  gameName: 'Hearts',
  standings: [s('a', 1), s('b', 2), s('c', 3)],
})
check('coins accumulate across games', getBalance('a') === FIRST * 2)

console.log('\nbuying')

const P = 'shopper'
check('a new player is broke', getBalance(P) === 0)
check('buying with no coins is refused', !buyItem(P, 'theme-neon').ok)
check('a refused purchase writes no ledger row', getBalance(P) === 0)
check('a refused purchase grants nothing', getOwned(P).length === 0)

recordGameEnded({
  roomCode: 'FFFF',
  gameType: 'spades',
  gameName: 'Spades',
  standings: [s(P, 500), s('n1', 400), s('n2', 300)],
})
check('placing first funds the wallet', getBalance(P) === FIRST)

// Priced at 150 in shared/shop.ts, so one first place isn't enough yet.
check('a purchase over budget is refused', !buyItem(P, 'theme-felt').ok)

for (const code of ['GGGG', 'HHHH', 'IIII']) {
  recordGameEnded({
    roomCode: code,
    gameType: 'spades',
    gameName: 'Spades',
    standings: [s(P, 500), s('n1', 400), s('n2', 300)],
  })
}
const before = getBalance(P)
const bought = buyItem(P, 'theme-felt')
check('an affordable purchase succeeds', bought.ok)
check('the price is debited', getBalance(P) === before - 150)
check('the item is owned afterwards', getOwned(P).includes('theme-felt'))
check('buying the same item twice is refused', !buyItem(P, 'theme-felt').ok)
check('the double-buy debits nothing', getBalance(P) === before - 150)
check('an unknown item id is refused', !buyItem(P, 'no-such-item').ok)

console.log('\nequipping')

check('an owned theme equips', equipItem(P, 'theme', 'theme-felt').ok)
check('the equipped theme reads back', getEquipped(P).theme === 'theme-felt')
check('an UNOWNED theme is refused', !equipItem(P, 'theme', 'theme-neon').ok)
check('the refusal left the old theme in place', getEquipped(P).theme === 'theme-felt')
// The kind check is what stops an emote being equipped into a visual slot.
check('an item of the wrong kind is refused', !equipItem(P, 'cardback', 'theme-felt').ok)
check('an unknown item id is refused', !equipItem(P, 'theme', 'nope').ok)
check('null un-equips back to the default look', equipItem(P, 'theme', null).ok && getEquipped(P).theme === null)
check('the other slot is untouched by a theme change', getEquipped(P).cardback === null)

// The avatar slot: free presets need no purchase, premium ones do, and the
// GOOGLE_AVATAR sentinel is accepted for anyone to ASK for (resolving it to an
// actual picture is the server's job at join, since only it knows who is
// signed in).
check('a free preset avatar equips', equipItem(P, 'avatar', 'fox').ok)
check('the avatar reads back', getEquipped(P).avatar === 'fox')
check('equipping an avatar left the theme slot alone', getEquipped(P).theme === null)
check('an UNOWNED premium avatar is refused', !equipItem(P, 'avatar', 'avatar-dragon').ok)
check('the google sentinel is accepted', equipItem(P, 'avatar', GOOGLE_AVATAR).ok)
check('an unknown avatar id is refused', !equipItem(P, 'avatar', 'not-an-avatar').ok)
check('a theme cannot be equipped as an avatar', !equipItem(P, 'avatar', 'theme-felt').ok)
check('null un-equips the avatar', equipItem(P, 'avatar', null).ok && getEquipped(P).avatar === null)

// The deck slot. The free classic deck is deliberately NOT a shop item, so
// "back to classic" is an un-equip (null) rather than an id -- the same shape
// the theme slot's default look uses. Everything else is bought.
check('an UNOWNED deck is refused', !equipItem(P, 'deck', 'deck-negative').ok)
check('a cardback cannot be equipped as a deck', !equipItem(P, 'deck', 'cardback-crimson').ok)
check("'classic' is not an item, so it cannot be equipped by id", !equipItem(P, 'deck', 'classic').ok)
// Top the wallet back up: the theme purchase above spent most of it.
for (const code of ['JJJJ', 'KKKK', 'LLLL'] as const) {
  recordGameEnded({
    roomCode: code,
    gameType: 'spades',
    gameName: 'Spades',
    standings: [s(P, 500), s('n1', 400), s('n2', 300)],
  })
}
check('a bought deck equips', buyItem(P, 'deck-pixel').ok && equipItem(P, 'deck', 'deck-pixel').ok)
check('the deck reads back', getEquipped(P).deck === 'deck-pixel')
check('equipping a deck left the avatar slot alone', getEquipped(P).avatar === null)
check('null un-equips back to the free classic deck', equipItem(P, 'deck', null).ok && getEquipped(P).deck === null)

console.log('\npowerup charges')

// Consumables are the one item you can buy repeatedly: they're spent in play,
// so owning one is no reason to refuse another.
const C = 'charger'
// Funded generously on purpose: an "insufficient funds" refusal further down
// would make the re-buy checks pass for the wrong reason.
for (const code of ['JJJ1', 'JJJ2', 'JJJ3', 'JJJ4', 'JJJ5', 'JJJ6', 'JJJ7', 'JJJ8', 'JJJ9', 'JJ10']) {
  recordGameEnded({
    roomCode: code,
    gameType: 'prediction',
    gameName: 'The Prediction Game',
    standings: [s(C, 500), s('n1', 400), s('n2', 300)],
  })
}
check('placing funds the charger', getBalance(C) === FIRST * 10)

check('a powerup can be bought', buyItem(C, 'powerup-peek').ok)
check('one charge is held', getCharges(C)['powerup-peek'] === 1)
check('the SAME powerup can be bought again', buyItem(C, 'powerup-peek').ok)
check('charges stack', getCharges(C)['powerup-peek'] === 2)

check('spending returns true while charges remain', spendPowerupCharge(C, 'powerup-peek'))
check('the charge count drops', getCharges(C)['powerup-peek'] === 1)
check('spending again works', spendPowerupCharge(C, 'powerup-peek'))
check('an exhausted powerup reports no charges', !getCharges(C)['powerup-peek'])
// The row survives at quantity 0 so the next purchase increments rather than
// inserting -- but a zero-charge item must not count as owned, or it would
// keep unlocking things.
check('spending past zero is refused', !spendPowerupCharge(C, 'powerup-peek'))
check('a zero-charge item is not owned', !getOwned(C).includes('powerup-peek'))
check('never-bought powerups cannot be spent', !spendPowerupCharge(C, 'powerup-safety-net'))
check('re-buying after exhaustion works', buyItem(C, 'powerup-peek').ok)
check('and restores a charge', getCharges(C)['powerup-peek'] === 1)

// A non-consumable keeps its old behaviour.
const firstThemeBuy = buyItem(C, 'theme-felt')
check('a non-consumable buys once', firstThemeBuy.ok)
check('a theme still refuses a second purchase', !buyItem(C, 'theme-felt').ok)

console.log('\nredeem codes')

// A code is sized in catalogue COVERAGE, so these assertions are written
// against the live catalogue rather than a hardcoded number of coins -- the
// promise a code makes has to survive a price change.
const FULL = REDEEM_CODES.find((entry) => entry.coverage === 1)!.code
const HALF = REDEEM_CODES.find((entry) => entry.coverage === 0.5)!.code

const R = 'redeemer'
const wholeShop = SHOP_ITEMS.reduce((sum, item) => sum + item.price, 0)
check('coverage of the whole shop is the whole catalogue price', coverageCost(R, 1) === wholeShop)
// Half the ITEMS, cheapest first -- not half the money, which is a bigger number.
const cheapestHalf = SHOP_ITEMS.map((i) => i.price)
  .sort((a, b) => a - b)
  .slice(0, Math.ceil(SHOP_ITEMS.length / 2))
  .reduce((sum, price) => sum + price, 0)
check('half-coverage is the cheapest half of the items', coverageCost(R, 0.5) === cheapestHalf)

check('an unknown code is refused', !redeemCode(R, 'NOT-A-CODE').ok)
check('a refused code grants nothing', getBalance(R) === 0)

const redeemed = redeemCode(R, FULL)
check('the full code redeems', redeemed.ok)
check('it funds the whole catalogue', getBalance(R) === wholeShop)
check('and every item is now affordable', SHOP_ITEMS.every((item) => buyItem(R, item.id).ok))
check('which spends the wallet exactly to zero', getBalance(R) === 0)
check('the same code cannot be redeemed twice', !redeemCode(R, FULL).ok)
check('the second attempt granted nothing', getBalance(R) === 0)

// Codes are typed off a screen, so case and the dashes people add for
// legibility are both discarded before the lookup.
const H = 'half-redeemer'
check('a code matches case-insensitively and ignores dashes', redeemCode(H, ` ${HALF.toLowerCase()} `.replace(/(.{4})/, '$1-')).ok)
check('half-coverage funds half the items', getBalance(H) === cheapestHalf)

// Topping UP rather than adding: coins already earned count toward what the
// code covers, so a code can never be stacked on a full wallet.
const T = 'topped-up'
recordGameEnded({
  roomCode: 'TOPU',
  gameType: 'spades',
  gameName: 'Spades',
  standings: [s(T, 500), s('u2', 400), s('u3', 300)],
})
check('the top-up player starts with a placement award', getBalance(T) === FIRST)
const topped = redeemCode(T, FULL)
check('the code redeems', topped.ok)
check('it granted only the shortfall', topped.ok && topped.granted === wholeShop - FIRST)
check('leaving exactly the coverage, not more', getBalance(T) === wholeShop)

// Burning a code for nothing would be the worst outcome for a player who
// happened to be rich, so it stays unredeemed.
const RICH = 'rich'
check('the full code redeems for a fresh wallet', redeemCode(RICH, FULL).ok)
check('a wallet that already covers the half code is refused it', !redeemCode(RICH, HALF).ok)
check('and the refusal granted nothing', getBalance(RICH) === wholeShop)
// The refusal must leave the code UNREDEEMED, or a player who happened to be
// rich when they typed it loses it for nothing.
check('spending down and trying again works', SHOP_ITEMS.every((item) => buyItem(RICH, item.id).ok))
check('the once-rich wallet is broke now', getBalance(RICH) === 0)
// Every item is owned now, so there is nothing left to cover -- which is its
// own refusal, and still not a burn.
check('a fully-stocked wallet has nothing left to cover', coverageCost(RICH, 0.5) === 0)
check('so the half code is still refused, not spent', !redeemCode(RICH, HALF).ok)

fs.rmSync(dir, { recursive: true, force: true })

console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} check${failures === 1 ? '' : 's'})`)
process.exit(failures === 0 ? 0 : 1)
