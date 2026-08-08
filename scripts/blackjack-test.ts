// Fast regression test for the Blackjack rules. No server, no sockets, well
// under a second:
//
//   npx tsx scripts/blackjack-test.ts
//
// Hand values and the point table are what both the client's display and the
// server's scoring depend on, so every branch is pinned here.

import type { Card } from '../src/shared/cards'
import {
  dealerShouldHit,
  handValue,
  isBlackjack,
  isBust,
  settlePlayerTable,
  settleVsDealer,
} from '../src/shared/blackjackRules'

let failures = 0
const fail = (message: string) => {
  console.error(`  ✗ ${message}`)
  failures++
}
const ok = (message: string) => console.log(`  ✓ ${message}`)
const check = (condition: boolean, message: string) => {
  if (condition) ok(message)
  else fail(message)
}

const card = (suit: Card['suit'], rank: number): Card => ({ suit, rank })
const ACE = 14

// ---- Hand values ----------------------------------------------------------------

console.log('\nhand values')
{
  const blackjack = handValue([card('Spades', 10), card('Hearts', ACE)])
  check(blackjack.total === 21 && blackjack.soft, '10 + A is 21 with the ace still counted as 11')

  const soft17 = handValue([card('Spades', ACE), card('Hearts', 6)])
  check(soft17.total === 17 && soft17.soft, 'A + 6 is a soft 17')

  const multiAce = handValue([card('Spades', ACE), card('Hearts', ACE), card('Clubs', 9)])
  check(
    multiAce.total === 21 && multiAce.soft,
    `A + A + 9 demotes one ace to 21 soft (got ${multiAce.total}, soft=${multiAce.soft})`,
  )

  const hardBust = handValue([card('Spades', ACE), card('Hearts', 9), card('Clubs', 5)])
  check(hardBust.total === 15 && !hardBust.soft, 'A + 9 + 5 demotes to a hard 15')

  const faceCards = handValue([card('Spades', 13), card('Hearts', 12)])
  check(faceCards.total === 20 && !faceCards.soft, 'K + Q is a hard 20')

  const bust = handValue([card('Spades', 13), card('Hearts', 12), card('Clubs', 5)])
  check(bust.total === 25 && !bust.soft, 'K + Q + 5 busts at 25')
}

// ---- Bust / blackjack ------------------------------------------------------------

console.log('\nbust / natural blackjack')
{
  check(isBust(handValue([card('Spades', 13), card('Hearts', 12), card('Clubs', 5)])), '25 busts')
  check(!isBust(handValue([card('Spades', 13), card('Hearts', 12)])), '20 does not bust')

  check(isBlackjack([card('Spades', ACE), card('Hearts', 13)]), 'A + K on the first two cards is a natural')
  check(
    !isBlackjack([card('Spades', 7), card('Hearts', 7), card('Clubs', 7)]),
    '7+7+7=21 is NOT a natural -- three cards',
  )
  check(!isBlackjack([card('Spades', 10), card('Hearts', 9)]), '19 is not a natural')
}

// ---- Dealer's fixed rule ----------------------------------------------------------

console.log("\ndealer's fixed rule")
{
  check(dealerShouldHit(handValue([card('Spades', 10), card('Hearts', 6)])), 'hits on 16')
  check(!dealerShouldHit(handValue([card('Spades', 10), card('Hearts', 7)])), 'stands on a hard 17')
  check(
    !dealerShouldHit(handValue([card('Spades', ACE), card('Hearts', 6)])),
    'stands on a soft 17 too -- this house never hits soft 17',
  )
  check(!dealerShouldHit(handValue([card('Spades', 10), card('Hearts', 8)])), 'stands on 18')
}

// ---- vs-Dealer point table --------------------------------------------------------

console.log('\nvs-Dealer point table')
{
  const hand = (total: number, opts: Partial<{ busted: boolean; blackjack: boolean; doubled: boolean }> = {}) => ({
    total,
    busted: false,
    blackjack: false,
    doubled: false,
    ...opts,
  })

  check(settleVsDealer(hand(19), hand(19)) === 0, 'equal totals push')
  check(
    settleVsDealer(hand(21, { blackjack: true }), hand(21, { blackjack: true })) === 0,
    'two naturals push',
  )
  check(
    settleVsDealer(hand(21, { blackjack: true }), hand(19)) === 2,
    'a natural beating a non-natural dealer pays +2',
  )
  check(
    settleVsDealer(hand(23, { busted: true }), hand(18)) === -1,
    'busting loses -1 regardless of the dealer',
  )
  check(
    settleVsDealer(hand(23, { busted: true, doubled: true }), hand(18)) === -2,
    'a doubled bust loses -2',
  )
  check(settleVsDealer(hand(19), hand(21, { blackjack: true })) === -1, 'dealer natural beats a non-natural -1')
  check(
    settleVsDealer(hand(19, { doubled: true }), hand(21, { blackjack: true })) === -2,
    'a doubled loss to a dealer natural is -2',
  )
  check(settleVsDealer(hand(19), hand(23, { busted: true })) === 1, 'dealer busts, player wins +1')
  check(
    settleVsDealer(hand(19, { doubled: true }), hand(23, { busted: true })) === 2,
    'a doubled win off a dealer bust pays +2',
  )
  check(settleVsDealer(hand(20), hand(18)) === 1, 'higher total wins +1')
  check(settleVsDealer(hand(18), hand(20)) === -1, 'lower total loses -1')
  check(settleVsDealer(hand(20, { doubled: true }), hand(18)) === 2, 'a doubled regular win pays +2')
}

// ---- vs-Players table ---------------------------------------------------------

console.log('\nvs-Players table')
{
  const entry = (id: string, total: number, opts: Partial<{ busted: boolean; doubled: boolean }> = {}) => ({
    id,
    total,
    busted: false,
    doubled: false,
    ...opts,
  })

  {
    const scores = settlePlayerTable([entry('a', 20), entry('b', 18), entry('c', 0, { busted: true })])
    check(scores.a === 1, 'highest non-bust total wins +1')
    check(scores.b === 0, 'a non-bust non-winner scores 0')
    check(scores.c === -1, 'a bust scores -1')
  }

  {
    const scores = settlePlayerTable([entry('a', 20), entry('b', 20)])
    check(scores.a === 1 && scores.b === 1, 'a tie splits the win -- both score +1')
  }

  {
    const scores = settlePlayerTable([
      entry('a', 0, { busted: true }),
      entry('b', 0, { busted: true, doubled: true }),
    ])
    check(scores.a === -1 && scores.b === -2, 'everyone busted -- doubled bust loses -2, plain -1')
  }

  {
    const scores = settlePlayerTable([entry('a', 21, { doubled: true }), entry('b', 18)])
    check(scores.a === 2 && scores.b === 0, 'a doubled winner pays +2')
  }
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
