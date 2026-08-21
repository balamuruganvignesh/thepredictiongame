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
const { buyItem, equipItem, getBalance, getEquipped, getOwned } = await import('../src/server/db/shop')
const { PLACEMENT_COINS } = await import('../src/shared/shop')
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

fs.rmSync(dir, { recursive: true, force: true })

console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures} check${failures === 1 ? '' : 's'})`)
process.exit(failures === 0 ? 0 : 1)
