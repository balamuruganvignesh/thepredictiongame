// Fast regression test for the Golf rules. No server, no sockets, well under a
// second:
//
//   npx tsx scripts/golf-test.ts
//
// Card values and column scoring are what the client would need to render a
// live score readout, so they're pinned here the same way heartsRules is.

import type { Card } from '../src/shared/cards'
import {
  GRID_SIZE,
  INITIAL_REVEAL_COUNT,
  cardValue,
  columnOf,
  columnScore,
  gridScore,
  partnerSlot,
} from '../src/shared/golfRules'

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

// ---- Card values --------------------------------------------------------------

console.log('\ncard values')
{
  check(cardValue(card('Joker', 15)) === -2, 'joker is -2')
  check(cardValue(card('Spades', 13)) === 0, 'king is 0')
  check(cardValue(card('Hearts', 14)) === 1, 'ace is 1')
  check(cardValue(card('Clubs', 11)) === 10, 'jack is 10')
  check(cardValue(card('Diamonds', 12)) === 10, 'queen is 10')
  for (let rank = 2; rank <= 10; rank++) {
    check(cardValue(card('Spades', rank)) === rank, `${rank} is worth ${rank}`)
  }
}

// ---- Column scoring -------------------------------------------------------------

console.log('\ncolumn scoring')
{
  check(
    columnScore(card('Spades', 7), card('Hearts', 7)) === 0,
    'matching ranks cancel the column, even across suits',
  )
  check(
    columnScore(card('Spades', 13), card('Hearts', 13)) === 0,
    'two kings still cancel, even though a lone king already scores 0',
  )
  check(
    columnScore(card('Spades', 5), card('Hearts', 8)) === 13,
    'non-matching column sums both values',
  )
  check(
    columnScore(card('Joker', 15), card('Hearts', 9)) === 7,
    'a joker column is worth 9 - 2 = 7',
  )
  check(
    columnScore(card('Joker', 15), card('Joker', 15)) === 0,
    'two jokers match too — 0, not -4',
  )
}

// ---- Grid scoring -----------------------------------------------------------------

console.log('\ngrid scoring')
{
  // top row: 5, K, 9 / bottom row: 5, 3, Q
  const grid = [
    card('Clubs', 5),
    card('Spades', 13),
    card('Hearts', 9),
    card('Diamonds', 5),
    card('Hearts', 3),
    card('Clubs', 12),
  ]
  // column 0: 5+5 match -> 0. column 1: K(0) + 3 -> 3. column 2: 9 + Q(10) -> 19.
  check(gridScore(grid) === 22, `worked example scores 22 (got ${gridScore(grid)})`)

  const allKings = new Array(6).fill(null).map(() => card('Spades', 13))
  check(gridScore(allKings) === 0, 'a grid of all kings scores 0 (three matched columns)')

  const worst = [
    card('Diamonds', 9),
    card('Clubs', 10),
    card('Hearts', 10),
    card('Spades', 8),
    card('Diamonds', 7),
    card('Clubs', 9),
  ]
  check(gridScore(worst) === 53, `no matches sums everything (got ${gridScore(worst)})`)
}

// ---- Slot geometry ----------------------------------------------------------------

console.log('\nslot geometry')
{
  check(GRID_SIZE === 6, 'six slots per grid')
  check(INITIAL_REVEAL_COUNT === 2, 'two starting flips')
  for (let i = 0; i < 3; i++) {
    check(columnOf(i) === i && columnOf(i + 3) === i, `slots ${i} and ${i + 3} share column ${i}`)
    check(
      partnerSlot(i) === i + 3 && partnerSlot(i + 3) === i,
      `partnerSlot is symmetric for column ${i}`,
    )
  }
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
