// Focused test for the Time Traveler's Rewind, which is the one ability that
// reaches into the live play loop and makes it step BACKWARDS:
//
//   npx tsx scripts/rewind-test.ts
//
// Driving this through bots is unreliable -- a rewind only lands in the narrow
// window where a card is on the table and someone else is still to play -- so
// this drives TrickManager directly and asserts the unwinding is exact:
// the card comes back, the same card is refused, the trick still resolves with
// one play per seat, and hands end up empty.
//
// The RoleManager here stays in CLASSIC mode, so every chaos hook no-ops and
// what's under test is purely the loop.

import type { Card } from '../src/shared/cards'
import { cardKey } from '../src/shared/cards'
import { RoleManager } from '../src/server/engine/roles'
import { TrickManager } from '../src/server/engine/tricks'
import type { Seat } from '../src/server/types'
import type { EngineIO } from '../src/server/engine/io'

// Captures dealHand, so the `barred` signal the client renders off can be
// asserted -- without it a human clicks the rewound card and only finds out
// from a rejection toast.
const dealt: { to: string; barred?: string | null }[] = []
const silentIO: EngineIO = {
  broadcast: () => {},
  send: (seat, event, payload) => {
    if (event === 'dealHand') {
      dealt.push({ to: seat.id, barred: (payload as { barred?: string | null }).barred })
    }
  },
  sendSpectators: () => {},
}
const tick = () => new Promise((r) => setTimeout(r, 5))

let failures = 0
function check(label: string, condition: boolean) {
  console.log(`  ${condition ? '✓' : '✗'} ${label}`)
  if (!condition) failures++
}

function seat(id: string, hand: Card[]): Seat {
  return {
    id,
    socketId: `s-${id}`,
    name: id,
    seatIndex: 1,
    ready: true,
    connected: true,
    hand,
    bid: 0,
    hasDoubled: false,
    tricksWon: 0,
    totalScore: 0,
    lastRoundScore: null,
    disconnectedAt: null,
  }
}

async function run() {
  // Three cards each, so that after trick 1 everyone still holds a genuine
  // ALTERNATIVE -- a rewind against a player down to their last card is
  // impossible by design, and is asserted separately at the end.
  const a = seat('Ada', [
    { suit: 'Spades', rank: 9 },
    { suit: 'Hearts', rank: 4 },
    { suit: 'Diamonds', rank: 6 },
  ])
  const b = seat('Bo', [
    { suit: 'Spades', rank: 12 },
    { suit: 'Spades', rank: 3 },
    { suit: 'Hearts', rank: 10 },
  ])
  const c = seat('Cy', [
    { suit: 'Spades', rank: 5 },
    { suit: 'Clubs', rank: 7 },
    { suit: 'Diamonds', rank: 2 },
  ])
  const seats = [a, b, c]

  const roles = new RoleManager(silentIO)
  // playPause 0: this test asserts the rewind state machine, and waiting out
  // three real seconds per card would turn a sub-second test into a minute.
  const tricks = new TrickManager(silentIO, roles, 0)
  roles.attachTricks(tricks)

  const done = tricks.runPlayPhase(seats, a, 3, 'Hearts')
  await tick()

  // ---- Trick 1: Ada leads, Bo follows, then Bo's play is rewound ------------
  tricks.handleCardPlay(a, { suit: 'Spades', rank: 9 })
  await tick()
  tricks.handleCardPlay(b, { suit: 'Spades', rank: 12 })
  await tick()

  check('rewind is offered while Cy is still to play', tricks.canRewind().ok)
  check('it names Bo, the most recent player', tricks.lastPlayer()?.id === 'Bo')

  tricks.rewindLastPlay()
  await tick()

  check(
    'the S12 is back in Bo’s hand, and nothing else changed size',
    b.hand.some((card) => cardKey(card) === 'Spades-12') && b.hand.length === 3,
  )
  check('the turn is back on Bo', tricks.snapshot().currentTurnId === b.id)
  check(
    'Bo’s client is told WHICH card is barred, so the UI can grey it',
    dealt.at(-1)?.to === b.id && dealt.at(-1)?.barred === 'Spades-12',
  )
  check('the table shows only Ada’s card again', tricks.snapshot().plays.length === 1)

  // Replaying the same card must bounce; a different legal one must land.
  tricks.handleCardPlay(b, { suit: 'Spades', rank: 12 })
  await tick()
  check('replaying the rewound card is refused', tricks.snapshot().plays.length === 1)

  tricks.handleCardPlay(b, { suit: 'Spades', rank: 3 })
  await tick()
  check('a different card is accepted', tricks.snapshot().plays.length === 2)
  check('and the bar is explicitly cleared once they play', dealt.at(-1)?.barred === null)

  tricks.handleCardPlay(c, { suit: 'Spades', rank: 5 })
  await tick()

  // Ada's S9 beats Bo's forced S3 and Cy's S5 -- the rewind changed who won.
  check('the rewind changed the winner: Ada takes it, not Bo', a.tricksWon === 1)
  check('exactly one trick was counted', a.tricksWon + b.tricksWon + c.tricksWon === 1)

  // ---- Trick 2: rewinding the LEAD, which reopens the suit ------------------
  // Config.trickResolvePause is 1.5s of "let players see how that went".
  await new Promise((r) => setTimeout(r, 1800))
  check('trick 2 has begun', tricks.snapshot().trickNumber === 2)

  const leader = tricks.snapshot().currentTurnId
  const leadSeat = seats.find((s) => s.id === leader)!
  tricks.handleCardPlay(leadSeat, leadSeat.hand[0])
  await tick()

  const ledCard = tricks.snapshot().plays[0]?.card
  check('a lead is on the table', ledCard != null)
  check('rewinding the lead is allowed while they still hold a choice', tricks.canRewind().ok)
  tricks.rewindLastPlay()
  await tick()
  check('rewinding the lead clears the lead suit', tricks.snapshot().leadSuit === null)
  check('the leader is on the clock again', tricks.snapshot().currentTurnId === leadSeat.id)

  // Play the round out and make sure nothing was lost or duplicated. The card
  // has to be a LEGAL one -- an illegal play is rejected, the turn doesn't
  // move, and this loop would spin until the guard and then hang on `done`.
  // Only the very next play is barred from repeating the rewound card.
  let barred: string | null = ledCard ? cardKey(ledCard) : null
  let sawLastCardRefusal = false
  for (let guard = 0; guard < 40; guard++) {
    const state = tricks.snapshot()
    const onTurn = seats.find((s) => s.id === state.currentTurnId)
    if (!onTurn) {
      // Between tricks: wait out the resolve pause rather than giving up.
      if (tricks.snapshot().trickNumber >= 3 && seats.every((s) => s.hand.length === 0)) break
      await new Promise((r) => setTimeout(r, 200))
      continue
    }
    // Down to one card, that card is by definition their only legal play, so a
    // rewind against them must be refused -- the guard that stops the play loop
    // from bouncing a seat between "play again" and "not that one" forever.
    if (onTurn.hand.length === 1 && state.plays.length > 0) {
      sawLastCardRefusal = sawLastCardRefusal || !tricks.canRewind().ok
    }
    const legal = onTurn.hand.filter(
      (h) =>
        state.leadSuit == null ||
        h.suit === state.leadSuit ||
        !onTurn.hand.some((other) => other.suit === state.leadSuit),
    )
    const card = legal.find((h) => cardKey(h) !== barred) ?? legal[0] ?? onTurn.hand[0]
    barred = null
    tricks.handleCardPlay(onTurn, card)
    await tick()
  }

  await done
  check('a rewind against a player on their last card is refused', sawLastCardRefusal)
  check('every hand is empty at the end of the round', seats.every((s) => s.hand.length === 0))
  check(
    'exactly three tricks were won across the table',
    seats.reduce((sum, s) => sum + s.tricksWon, 0) === 3,
  )
}

run().then(
  () => {
    console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
    process.exit(failures === 0 ? 0 : 1)
  },
  (error) => {
    console.error('\nFAIL — threw:', error)
    process.exit(1)
  },
)
