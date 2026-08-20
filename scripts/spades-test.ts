// Fast regression test for the Spades rules. No server, no sockets, well
// under a second:
//
//   npx tsx scripts/spades-test.ts
//
// Legality and the scoring math are what both the client's display and the
// server's scoring depend on, so every branch is pinned here.

import type { Card } from '../src/shared/cards'
import {
  applyBagPenalty,
  breaksSpades,
  isLegalSpadesPlay,
  scoreSpadesHand,
  teamOfSeatPosition,
  type SpadesPlayerBid,
} from '../src/shared/spadesRules'

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

// ---- Teams ------------------------------------------------------------------

console.log('\nteams')
{
  check(teamOfSeatPosition(0) === 0 && teamOfSeatPosition(2) === 0, 'seats 0 and 2 are team 0')
  check(teamOfSeatPosition(1) === 1 && teamOfSeatPosition(3) === 1, 'seats 1 and 3 are team 1')
}

// ---- Legality -----------------------------------------------------------------

console.log('\nlegality')
{
  const hand = [card('Hearts', 5), card('Spades', 10), card('Clubs', 3)]
  check(
    isLegalSpadesPlay(card('Spades', 10), hand, { leadSuit: null, spadesBroken: false }) === false,
    "can't lead a spade before they're broken",
  )
  check(
    isLegalSpadesPlay(card('Spades', 10), hand, { leadSuit: null, spadesBroken: true }),
    'leading a spade is fine once broken',
  )
  check(
    isLegalSpadesPlay(card('Hearts', 5), hand, { leadSuit: null, spadesBroken: false }),
    'leading anything else is always fine',
  )

  const allSpades = [card('Spades', 4), card('Spades', 9)]
  check(
    isLegalSpadesPlay(card('Spades', 4), allSpades, { leadSuit: null, spadesBroken: false }),
    'the restriction lifts when spades are all you have left',
  )

  check(
    isLegalSpadesPlay(card('Spades', 10), hand, { leadSuit: 'Hearts', spadesBroken: false }) ===
      false,
    'must follow suit when you hold it, even a spade you could otherwise lead',
  )
  check(
    isLegalSpadesPlay(card('Hearts', 5), hand, { leadSuit: 'Hearts', spadesBroken: false }),
    'following suit is legal',
  )
  check(
    isLegalSpadesPlay(card('Spades', 10), hand, { leadSuit: 'Diamonds', spadesBroken: false }),
    'void in the led suit: anything goes, spades included -- and that IS what breaks them',
  )

  check(breaksSpades(card('Spades', 2)), 'any spade breaks them')
  check(!breaksSpades(card('Hearts', 2)), 'a non-spade does not')
}

// ---- Scoring: bids and nil ---------------------------------------------------

console.log('\nscoring: made and set bids')
{
  const entry = (id: string, team: 0 | 1, bid: number | 'nil', tricksWon: number): SpadesPlayerBid => ({
    id,
    team,
    bid,
    tricksWon,
  })

  {
    // Team 0 bids 4+3=7, takes exactly 7 -- no bags.
    const results = scoreSpadesHand([
      entry('a', 0, 4, 4),
      entry('b', 1, 3, 3),
      entry('c', 0, 3, 3),
      entry('d', 1, 3, 6),
    ])
    const team0 = results.find((r) => r.team === 0)!
    check(team0.bid === 7 && team0.tricks === 7 && team0.madeBid, 'team bid is the sum of both partners')
    check(team0.overtricks === 0 && team0.handScore === 70, 'exact make: 10x bid, no bags')
  }

  {
    // Team 0 bids 4, takes 6 -- 2 overtricks (bags).
    const results = scoreSpadesHand([
      entry('a', 0, 2, 3),
      entry('b', 1, 5, 5),
      entry('c', 0, 2, 3),
      entry('d', 1, 3, 5),
    ])
    const team0 = results.find((r) => r.team === 0)!
    check(team0.overtricks === 2 && team0.handScore === 42, 'overtricks: 10x bid + 1 per bag')
  }

  {
    // Team 0 bids 8, takes only 6 -- set, flat -80, no bags awarded.
    const results = scoreSpadesHand([
      entry('a', 0, 5, 3),
      entry('b', 1, 2, 6),
      entry('c', 0, 3, 3),
      entry('d', 1, 2, 4),
    ])
    const team0 = results.find((r) => r.team === 0)!
    check(!team0.madeBid && team0.handScore === -80, 'a set is a flat -10x bid, regardless of how far off')
    check(team0.overtricks === 0, 'a set never adds bags')
  }

  console.log('\nscoring: nil')
  {
    // b bids nil and takes zero; d's bid (4) is made exactly, no overtricks,
    // so team1's score isolates the nil bonus cleanly: +100 on top of 10x bid.
    const results = scoreSpadesHand([
      entry('a', 0, 4, 6),
      entry('b', 1, 'nil', 0),
      entry('c', 0, 3, 1),
      entry('d', 1, 4, 4),
    ])
    const team0 = results.find((r) => r.team === 0)!
    check(team0.bid === 7, "nil contributes 0 to the team's numeric bid")
    const team1 = results.find((r) => r.team === 1)!
    const nilLine = team1.players.find((p) => p.id === 'b')!
    check(nilLine.nilResult === 'made', 'nil with zero tricks is a made nil')
    check(team1.handScore === 40 + 100, "made nil is +100 on top of the partner's bid score")
  }

  {
    // b bids nil but takes 1 -- failed nil, -100, but the trick still counts
    // toward the team's own numeric bid.
    const results = scoreSpadesHand([
      entry('a', 0, 4, 5),
      entry('b', 1, 'nil', 1),
      entry('c', 0, 3, 3),
      entry('d', 1, 4, 5),
    ])
    const team1 = results.find((r) => r.team === 1)!
    const nilLine = team1.players.find((p) => p.id === 'b')!
    check(nilLine.nilResult === 'failed', 'nil with 1+ tricks fails')
    // team bid 4 (d only), team tricks 1+5=6, made with 2 overtricks: 40+2=42, minus 100 for the failed nil.
    check(team1.handScore === 42 - 100, 'failed nil is -100, but the trick still counts toward the bid')
  }

  {
    // Both partners bid nil and both take zero.
    const results = scoreSpadesHand([
      entry('a', 0, 'nil', 0),
      entry('b', 1, 5, 5),
      entry('c', 0, 'nil', 0),
      entry('d', 1, 8, 8),
    ])
    const team0 = results.find((r) => r.team === 0)!
    check(team0.bid === 0 && team0.tricks === 0 && team0.madeBid, 'double nil: bid 0, take 0, technically made')
    check(team0.handScore === 200, 'both nils succeed: +100 each, +0 from the bid itself')
  }
}

// ---- Bag penalty --------------------------------------------------------------

console.log('\nbag penalty')
{
  {
    const { scorePenalty, bagsAfter } = applyBagPenalty(3, 4)
    check(scorePenalty === 0 && bagsAfter === 7, 'under the threshold: no penalty yet')
  }
  {
    const { scorePenalty, bagsAfter } = applyBagPenalty(8, 4)
    check(scorePenalty === -100 && bagsAfter === 2, 'crossing 10 costs 100 and keeps the remainder')
  }
  {
    const { scorePenalty, bagsAfter } = applyBagPenalty(9, 13)
    check(scorePenalty === -200 && bagsAfter === 2, 'a big hand can cross the threshold more than once')
  }
  {
    const { scorePenalty, bagsAfter } = applyBagPenalty(0, 0)
    check(scorePenalty === 0 && bagsAfter === 0, 'no overtricks, no change')
  }
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
