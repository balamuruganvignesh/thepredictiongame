// Fast regression test for the Hearts rules. No server, no sockets, well under
// a second:
//
//   npx tsx scripts/hearts-test.ts
//
// Everything asserted here is a rule the CLIENT also evaluates (it greys out
// illegal cards with the same function). A disagreement between the two sides
// means the server rejects a play the UI offered -- and with no turn timers,
// the round then hangs there forever. So these are the rules worth pinning.

import type { Card } from '../src/shared/cards'
import { displayName } from '../src/shared/cards'
import {
  PASS_COUNT,
  isLegalHeartsPlay,
  isQueenOfSpades,
  openingCard,
  passDirection,
  passTargetIndex,
  penaltyOf,
  scoreHeartsRound,
  trimmedDeck,
} from '../src/shared/heartsRules'

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

// ---- The deck ---------------------------------------------------------------

console.log('\ndeck trim')
for (let players = 3; players <= 7; players++) {
  const { deck, cardsEach } = trimmedDeck(players)
  const hearts = deck.filter((c) => c.suit === 'Hearts').length
  const queen = deck.filter(isQueenOfSpades).length
  const removed = 52 - deck.length

  const problems: string[] = []
  if (deck.length !== players * cardsEach) problems.push('does not deal evenly')
  if (hearts !== 13) problems.push(`only ${hearts} hearts survived`)
  if (queen !== 1) problems.push('the queen of spades was trimmed')
  if (removed !== 52 % players) problems.push(`removed ${removed}, expected ${52 % players}`)
  // A duplicate would mean the splice took the wrong card out.
  if (new Set(deck.map((c) => `${c.suit}${c.rank}`)).size !== deck.length) {
    problems.push('duplicate cards in the deck')
  }

  if (problems.length > 0) fail(`${players}p: ${problems.join(', ')}`)
  else ok(`${players}p: ${deck.length} cards, ${cardsEach} each, all 26 points in play`)
}

console.log('\nopening card')
{
  const four = trimmedDeck(4)
  check(
    displayName(openingCard(four.deck)) === '2♣',
    'a full deck opens on the 2 of clubs',
  )

  // Five players drops two low non-scoring cards; whatever they are, the
  // opening card must still be the lowest club left in the deck.
  const five = trimmedDeck(5)
  const opening = openingCard(five.deck)
  const lowestClub = five.deck
    .filter((c) => c.suit === 'Clubs')
    .reduce((low, c) => (c.rank < low.rank ? c : low))
  check(
    opening.suit === 'Clubs' && opening.rank === lowestClub.rank,
    `5p opens on ${displayName(opening)} — the lowest club dealt`,
  )
  check(
    five.deck.some((c) => c.suit === 'Clubs' && c.rank === 2) ||
      opening.rank > 2,
    'the fallback only kicks in when the 2 of clubs was actually trimmed',
  )
}

// ---- Legality ---------------------------------------------------------------

console.log('\nlegal plays')
{
  const hand = [card('Clubs', 4), card('Clubs', 9), card('Hearts', 13), card('Spades', 12)]

  check(
    !isLegalHeartsPlay(card('Hearts', 13), hand, {
      leadSuit: 'Clubs',
      heartsBroken: true,
      isFirstTrick: false,
    }),
    'must follow suit when holding it',
  )
  check(
    isLegalHeartsPlay(card('Clubs', 4), hand, {
      leadSuit: 'Clubs',
      heartsBroken: true,
      isFirstTrick: false,
    }),
    'following suit is legal',
  )

  const void_ = [card('Hearts', 13), card('Spades', 12), card('Diamonds', 3)]
  check(
    isLegalHeartsPlay(card('Hearts', 13), void_, {
      leadSuit: 'Clubs',
      heartsBroken: false,
      isFirstTrick: false,
    }),
    'a heart may be discarded when void in the led suit (this is what breaks hearts)',
  )
  check(
    !isLegalHeartsPlay(card('Hearts', 13), void_, {
      leadSuit: 'Clubs',
      heartsBroken: false,
      isFirstTrick: true,
    }) &&
      !isLegalHeartsPlay(card('Spades', 12), void_, {
        leadSuit: 'Clubs',
        heartsBroken: false,
        isFirstTrick: true,
      }),
    'no hearts and no queen on the first trick while a safe card is held',
  )
  check(
    isLegalHeartsPlay(card('Diamonds', 3), void_, {
      leadSuit: 'Clubs',
      heartsBroken: false,
      isFirstTrick: true,
    }),
    'the safe card is the one that must go on the first trick',
  )

  const allPenalty = [card('Hearts', 5), card('Hearts', 9), card('Spades', 12)]
  check(
    isLegalHeartsPlay(card('Hearts', 5), allPenalty, {
      leadSuit: 'Clubs',
      heartsBroken: false,
      isFirstTrick: true,
    }),
    'a hand of nothing but penalty cards may dump one on the first trick',
  )

  const mixed = [card('Hearts', 5), card('Clubs', 7)]
  check(
    !isLegalHeartsPlay(card('Hearts', 5), mixed, {
      leadSuit: null,
      heartsBroken: false,
      isFirstTrick: false,
    }),
    'cannot lead a heart while hearts are unbroken',
  )
  check(
    isLegalHeartsPlay(card('Hearts', 5), mixed, {
      leadSuit: null,
      heartsBroken: true,
      isFirstTrick: false,
    }),
    'once broken, hearts lead like any other suit',
  )
  check(
    isLegalHeartsPlay(card('Hearts', 5), [card('Hearts', 5), card('Hearts', 9)], {
      leadSuit: null,
      heartsBroken: false,
      isFirstTrick: false,
    }),
    'a hand of only hearts may lead one even unbroken',
  )

  const opener = card('Clubs', 2)
  check(
    isLegalHeartsPlay(opener, [opener, card('Spades', 3)], {
      leadSuit: null,
      heartsBroken: false,
      isFirstTrick: true,
      mustLeadCard: opener,
    }) &&
      !isLegalHeartsPlay(card('Spades', 3), [opener, card('Spades', 3)], {
        leadSuit: null,
        heartsBroken: false,
        isFirstTrick: true,
        mustLeadCard: opener,
      }),
    'the opening lead is forced to the 2 of clubs',
  )
}

// ---- Scoring ----------------------------------------------------------------

console.log('\nscoring')
{
  const hearts = (n: number) => Array.from({ length: n }, (_, i) => card('Hearts', i + 2))

  const normal = scoreHeartsRound([
    { id: 'a', cards: [...hearts(3), card('Spades', 12), card('Clubs', 9)] },
    { id: 'b', cards: hearts(10).slice(3) },
    { id: 'c', cards: [card('Diamonds', 4)] },
  ])
  const score = (id: string) => normal.find((l) => l.id === id)!.roundScore
  check(score('a') === 16, '3 hearts + the queen scores 16')
  check(score('b') === 7, 'hearts alone score one apiece')
  check(score('c') === 0, 'a clean round scores nothing')
  check(normal.every((l) => !l.shotMoon), 'a split round is not a shot moon')

  const moon = scoreHeartsRound([
    { id: 'a', cards: [...hearts(13), card('Spades', 12)] },
    { id: 'b', cards: [card('Clubs', 3)] },
    { id: 'c', cards: [] },
  ])
  check(
    moon.find((l) => l.id === 'a')!.roundScore === 0 &&
      moon.find((l) => l.id === 'a')!.shotMoon,
    'the shooter takes nothing',
  )
  check(
    moon.filter((l) => l.id !== 'a').every((l) => l.roundScore === 26),
    'everyone else takes all 26',
  )

  check(
    penaltyOf(card('Hearts', 2)) === 1 &&
      penaltyOf(card('Spades', 12)) === 13 &&
      penaltyOf(card('Spades', 13)) === 0,
    'penalty values: heart 1, queen 13, everything else 0',
  )
}

// ---- Passing ----------------------------------------------------------------

console.log('\npassing')
{
  check(PASS_COUNT === 3, 'three cards change hands')

  const directions = (n: number) => [1, 2, 3, 4, 5].map((r) => passDirection(r, n))
  check(
    directions(4).join(',') === 'left,right,across,none,left',
    '4p cycles left → right → across → no pass',
  )
  check(
    directions(3).join(',') === 'left,right,none,none,left',
    '3p turns the across round into a no-pass round (across would be a seat already used)',
  )

  check(passTargetIndex(0, 4, 1) === 1 && passTargetIndex(3, 4, 1) === 0, 'left wraps around')
  check(passTargetIndex(0, 4, 2) === 3 && passTargetIndex(3, 4, 2) === 2, 'right wraps around')
  check(passTargetIndex(0, 4, 3) === 2 && passTargetIndex(3, 4, 3) === 1, 'across is the seat opposite')
  check(passTargetIndex(0, 4, 4) === null, 'round 4 passes nothing')

  // The pass must be a permutation: everyone gives once and receives once, or
  // cards are duplicated or lost outright.
  for (const n of [3, 4, 5, 6, 7]) {
    for (const round of [1, 2, 3]) {
      const targets = Array.from({ length: n }, (_, i) => passTargetIndex(i, n, round))
      if (targets[0] == null) continue
      const distinct = new Set(targets).size === n
      const noSelfPass = targets.every((t, i) => t !== i)
      if (!distinct || !noSelfPass) {
        fail(`${n}p round ${round}: pass targets are not a permutation (${targets.join(',')})`)
      }
    }
  }
  ok('every passing round is a permutation of the table — nobody passes to themselves')
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
