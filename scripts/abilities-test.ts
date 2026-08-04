// In-process test for the Time Traveler, the Angel and the Mirrorer:
//
//   npx tsx scripts/abilities-test.ts
//
// Runs in about a second, where a chaos playtest takes ten minutes and still
// only exercises whatever the deal happened to hand out -- a 6-player game
// doesn't even contain every role. Here the deal is re-rolled until the seat
// under test holds the exact role and ability we want, then the ability is
// fired directly at RoleManager and its effects are asserted.
//
// The one thing NOT covered here is the play loop unwinding a Rewind, because
// that lives in TrickManager: scripts/rewind-test.ts owns it. What this checks
// is Rewind's guards -- phase, once-per-trick, and the shield ordering.

import type { Card } from '../src/shared/cards'
import { cardKey } from '../src/shared/cards'
import * as RoleDefs from '../src/shared/roleDefs'
import { RoleManager } from '../src/server/engine/roles'
import type { Seat } from '../src/server/types'
import type { EngineIO, TrickHost } from '../src/server/engine/io'

let failures = 0
function check(label: string, condition: boolean) {
  console.log(`  ${condition ? '✓' : '✗'} ${label}`)
  if (!condition) failures++
}

/** Captures everything the engine emits, so effects can be asserted on. */
function makeIO() {
  const sent: { to: string; event: string; payload: unknown }[] = []
  const io: EngineIO = {
    broadcast: (event, payload) => sent.push({ to: '*', event, payload }),
    send: (seat, event, payload) => sent.push({ to: seat.id, event, payload }),
    sendSpectators: () => {},
  }
  return {
    io,
    sent,
    clear: () => sent.splice(0, sent.length),
    to(id: string, event: string) {
      return sent.filter((e) => e.to === id && e.event === event).map((e) => e.payload)
    },
    announcements(): string[] {
      return sent
        .filter((e) => e.event === 'roleAnnounce')
        .map((e) => (e.payload as { message: string }).message)
    },
    privateTo(id: string): string[] {
      return this.to(id, 'abilityResult').map((p) => (p as { message: string }).message)
    },
    errorsTo(id: string): string[] {
      return sent.filter((e) => e.to === id && e.event === 'actionError').map((e) => e.payload as string)
    },
  }
}

function seat(id: string, hand: Card[] = []): Seat {
  return {
    id,
    socketId: `s-${id}`,
    name: id,
    seatIndex: 1,
    ready: true,
    connected: true,
    hand,
    bid: null,
    hasDoubled: false,
    tricksWon: 0,
    collected: [],
    passSelection: null,
    totalScore: 0,
    lastRoundScore: null,
    disconnectedAt: null,
  }
}

function freshHand(): Card[] {
  return [
    { suit: 'Spades', rank: 9 },
    { suit: 'Hearts', rank: 4 },
    { suit: 'Clubs', rank: 11 },
  ]
}

function freshRemainder(): Card[] {
  return [
    { suit: 'Diamonds', rank: 14 },
    { suit: 'Diamonds', rank: 13 },
  ]
}

/**
 * Re-rolls the deal until seats[0] holds `roleId` and has been dealt
 * `abilityId`. Both are random, so this just retries -- with 7 roles and 4
 * abilities each it lands in a few hundred tries at worst.
 */
function dealUntil(roles: RoleManager, seats: Seat[], roleId: string, abilityId: string): boolean {
  const wanted = RoleDefs.getRole(roleId)?.name
  for (let attempt = 0; attempt < 6000; attempt++) {
    roles.assignRoles(seats)
    if (roles.getRoleReveal(seats[0].id)?.roleName !== wanted) continue
    for (let reroll = 0; reroll < 60; reroll++) {
      for (const s of seats) {
        s.hand = freshHand()
        s.bid = null
        s.tricksWon = 0
      }
      roles.startRound(seats, 3, freshRemainder())
      if (roles.getRoleState(seats[0])?.abilityId === abilityId) return true
    }
  }
  return false
}

function setup(roleId: string, abilityId: string) {
  const bus = makeIO()
  const roles = new RoleManager(bus.io)
  const seats = [seat('A'), seat('B'), seat('C'), seat('D')]
  const dealt = dealUntil(roles, seats, roleId, abilityId)
  bus.clear()
  return { bus, roles, seats, dealt }
}

// ---- The Time Traveler ------------------------------------------------------

function testReverseTime() {
  console.log('\n⏳ Reverse Time')
  const { bus, roles, seats, dealt } = setup('time_traveler', 'reverse_time')
  check('the ability was dealt', dealt)
  const [me, victim] = seats

  // Aimed at someone who hasn't bid: refused, and the ability survives.
  roles.handleUseAbility(me, { targetId: victim.id })
  check('refused against a player who hasn’t bid', bus.errorsTo(me.id).length === 1)
  check('the ability is NOT spent by a refusal', roles.getRoleState(me)?.used === false)

  bus.clear()
  victim.bid = 2
  me.bid = 1
  roles.handleUseAbility(me, { targetId: victim.id })

  const prompts = bus.to(victim.id, 'rebidPrompt') as { cardsDealt: number; currentBid: number }[]
  check('the target is prompted to choose again', prompts.length === 1)
  check('the prompt carries their current bid', prompts[0]?.currentBid === 2)
  check('the table is told, by role not by name', bus.announcements().some((m) => m.includes('REVERSE TIME') && !m.includes(me.name)))
  check('the ability is spent', roles.getRoleState(me)?.used === true)

  // THEY pick the number -- and a rewrite ignores the last-bidder sum rule.
  bus.clear()
  roles.handleRebid(victim, 3)
  check('the new bid is theirs, not the Time Traveler’s', victim.bid === 3)
  check('no error on a legal rewrite', bus.errorsTo(victim.id).length === 0)

  const syncs = bus.to(me.id, 'roleSync') as { bidSum?: number }[]
  check(
    'the TRUE bid total rides along, so the last bidder’s forbidden chip stays right',
    syncs.some((s) => s.bidSum === 4),
  )

  bus.clear()
  roles.handleRebid(victim, 1)
  check('the prompt is one-shot: a second answer is refused', bus.errorsTo(victim.id).length === 1)
  check('and the bid is untouched by it', victim.bid === 3)

  bus.clear()
  roles.handleRebid(victim, 99)
  check('an out-of-range rewrite is refused', victim.bid === 3)
}

function testRewindGuards() {
  console.log('\n⏳ Rewind (guards -- the unwinding itself is rewind-test.ts)')
  const { bus, roles, seats, dealt } = setup('time_traveler', 'rewind')
  check('the ability was dealt', dealt)
  const [me, victim] = seats

  let canRewind = { ok: true } as { ok: boolean; error?: string }
  let last: Seat | null = victim
  let rewound = 0
  let trick = 1
  const host: TrickHost = {
    currentTrickNumber: () => trick,
    lastPlayer: () => last,
    canRewind: () => canRewind,
    rewindLastPlay: () => {
      rewound++
    },
  }
  roles.attachTricks(host)

  // Bidding phase: there is nothing on the table yet.
  roles.handleUseAbility(me, {})
  check('refused during bidding', bus.errorsTo(me.id).length === 1 && rewound === 0)
  check('the ability survives that refusal', roles.getRoleState(me)?.used === false)

  // An impossible rewind must not burn the victim's shield on the way out.
  bus.clear()
  roles.setPhase('Playing')
  canRewind = { ok: false, error: 'only legal play' }
  roles.handleUseAbility(me, {})
  check('refused when the card was their only legal play', rewound === 0)
  check('the ability survives that too', roles.getRoleState(me)?.used === false)

  bus.clear()
  canRewind = { ok: true }
  roles.handleUseAbility(me, {})
  check('a valid rewind goes through', rewound === 1)
  check('the table is told', bus.announcements().some((m) => m.includes('REWIND')))
  check('the victim is told their play came back', bus.privateTo(victim.id).length === 1)
  check('the ability is spent', roles.getRoleState(me)?.used === true)
}

function testAlternateUniverse() {
  console.log('\n⏳ Alternate Universe')
  const { bus, roles, seats, dealt } = setup('time_traveler', 'alternate_universe')
  check('the ability was dealt', dealt)
  const me = seats[0]

  roles.handleUseAbility(me, { roleId: 'judge' })
  const after = roles.getRoleState(me)
  check(
    'the ability is now one of the Judge’s',
    after != null && RoleDefs.roles.judge.abilities.includes(after.abilityId ?? ''),
  )
  check('and the turn was NOT spent', after?.used === false)
  check('the role itself is unchanged', roles.getRoleReveal(me.id)?.roleName === 'The Time Traveler')
  check('nothing is announced -- it is private', bus.announcements().length === 0)

  // No chaining, and no naming a role that doesn't exist.
  const { bus: bus2, roles: roles2, seats: seats2 } = setup('time_traveler', 'alternate_universe')
  roles2.handleUseAbility(seats2[0], { roleId: 'nonsense' })
  check('an unknown role is refused', bus2.errorsTo(seats2[0].id).length === 1)
  const { roles: roles3, seats: seats3 } = setup('time_traveler', 'alternate_universe')
  roles3.handleUseAbility(seats3[0], { roleId: 'time_traveler' })
  check(
    'stepping into your OWN role can’t hand back Alternate Universe',
    roles3.getRoleState(seats3[0])?.abilityId !== 'alternate_universe',
  )
}

function testTimeBranches() {
  console.log('\n⏳ Time Branches')
  const { bus, roles, seats, dealt } = setup('time_traveler', 'time_branches')
  check('the ability was dealt', dealt)
  const me = seats[0]
  const given = me.hand[0]
  const before = me.hand.map(cardKey)

  roles.handleUseAbility(me, { cardKey: cardKey(given) })

  check('the hand is still the same size', me.hand.length === before.length)
  check('the card you put back is gone', !me.hand.some((c) => cardKey(c) === cardKey(given)))
  check(
    'and a card from the undealt pile took its place',
    me.hand.some((c) => c.suit === 'Diamonds'),
  )
  check('you are told what you traded', bus.privateTo(me.id).length === 1)
  check('nothing is announced', bus.announcements().length === 0)

  const { bus: bus2, roles: roles2, seats: seats2 } = setup('time_traveler', 'time_branches')
  roles2.handleUseAbility(seats2[0], { cardKey: 'Spades-2' })
  check('a card you don’t hold is refused', bus2.errorsTo(seats2[0].id).length === 1)
  check('and the ability survives', roles2.getRoleState(seats2[0])?.used === false)
}

// ---- The Angel --------------------------------------------------------------

/** Scores one seat the way scoreRound does, including the Grace settle-up. */
function scoreOne(roles: RoleManager, seats: Seat[], base = 0): Map<string, number> {
  roles.prepareScoring()
  const scores = new Map<string, number>()
  for (const s of seats) scores.set(s.id, roles.adjustScore(s, base))
  // Same order as engine/scoring.ts: Twin Fate averages finished round scores,
  // then Grace pays out.
  roles.settleMirror(scores)
  roles.settleGrace(scores)
  return scores
}

function testGuardianAngel() {
  console.log('\n😇 Guardian Angel + Grace')
  const { bus, roles, seats, dealt } = setup('angel', 'guardian_angel')
  check('the ability was dealt', dealt)
  const [angel, saved] = seats

  roles.handleUseAbility(angel, { targetId: saved.id })
  check('nothing is announced when it is cast', bus.announcements().length === 0)

  // Missing by exactly 1 is what the blessing is for.
  for (const s of seats) s.bid = 2
  saved.tricksWon = 1
  angel.tricksWon = 2

  bus.clear()
  const scores = scoreOne(roles, seats, -1)
  check('the blessed player scores as a hit', (scores.get(saved.id) ?? 0) === 12)
  check(
    'the save is announced without naming the Angel',
    bus.announcements().some((m) => m.includes(saved.name) && !m.includes(angel.name)),
  )
  // The Angel hit their own bid, so nothing else moved their score: whatever
  // sits on top of the -1 base is Grace and only Grace.
  check('the Angel banks Grace for it', (scores.get(angel.id) ?? 0) === -1 + 5)
  check(
    'and is told PRIVATELY, so the table never learns why they climbed',
    bus.privateTo(angel.id).some((m) => m.includes('Grace')),
  )
  check('Grace is never announced', !bus.announcements().some((m) => m.includes('Grace')))
}

function testGraceOnlyWhenItHelps() {
  console.log('\n😇 Grace is only paid when the kindness actually landed')
  const { roles, seats, dealt } = setup('angel', 'guardian_angel')
  check('the ability was dealt', dealt)
  const [angel, blessed] = seats

  roles.handleUseAbility(angel, { targetId: blessed.id })
  // They hit their bid on their own: the blessing bought nothing.
  for (const s of seats) s.bid = 2
  blessed.tricksWon = 2
  const scores = scoreOne(roles, seats, 0)
  check('no Grace for blessing someone who was never in danger', (scores.get(angel.id) ?? 0) === 0)
}

function testHaloAndSacrifice() {
  console.log('\n😇 Halo and Sacrifice')
  const halo = setup('angel', 'halo')
  check('Halo was dealt', halo.dealt)
  halo.roles.handleUseAbility(halo.seats[0], { targetId: halo.seats[1].id })
  for (const s of halo.seats) s.bid = 1
  const haloScores = scoreOne(halo.roles, halo.seats, -12)
  check('a negative round is floored at zero', (haloScores.get(halo.seats[1].id) ?? 1) === 0)
  check('the Angel banks Grace for the catch', (haloScores.get(halo.seats[0].id) ?? 0) === -12 + 5)

  const sac = setup('angel', 'sacrifice')
  check('Sacrifice was dealt', sac.dealt)
  sac.roles.handleUseAbility(sac.seats[0], { targetId: sac.seats[1].id })
  for (const s of sac.seats) s.bid = 1
  const sacScores = scoreOne(sac.roles, sac.seats, 0)
  check('the target is 10 better off', (sacScores.get(sac.seats[1].id) ?? 0) === 10)
  check(
    'the Angel is down 10 but banks 15 of Grace, so generosity nets +5',
    (sacScores.get(sac.seats[0].id) ?? 0) === -10 + 15,
  )
}

function testIntercede() {
  console.log('\n😇 Intercede')
  const { bus, roles, seats, dealt } = setup('angel', 'intercede')
  check('the ability was dealt', dealt)
  const [angel, shielded, attacker] = seats

  roles.handleUseAbility(angel, { targetId: shielded.id })
  check('nothing is announced when it is cast', bus.announcements().length === 0)

  // Force an attack onto the shielded player and check it bounces.
  roles.setPhase('Playing')
  shielded.bid = 2
  shielded.tricksWon = 1
  attacker.tricksWon = 0
  bus.clear()

  // Any targeted ability will do; Gravekeeper is the simplest to force.
  const attackerRoles = roles as unknown as { abilityBySeat: Map<string, string> }
  attackerRoles.abilityBySeat.set(attacker.id, 'gravekeeper')
  roles.handleUseAbility(attacker, { targetId: shielded.id })
  check(
    'the shield eats the attack, and the message names no role',
    bus.announcements().some((m) => m.includes('A shield shattered') && !m.includes('Guardian')),
  )

  for (const s of seats) s.bid = 1
  const scores = scoreOne(roles, seats, 0)
  check('the Angel banks Grace for the block', (scores.get(angel.id) ?? 0) === 5)
}

function testRewindNotDealtInOneCardRounds() {
  console.log('\n⏳ Rewind is never dealt in a one-card round')
  const bus = makeIO()
  const roles = new RoleManager(bus.io)
  const seats = [seat('A'), seat('B'), seat('C'), seat('D')]

  // Find a game where seat A is the Time Traveler, then deal one-card rounds at
  // them until the odds of missing a live 'rewind' are negligible.
  let found = false
  for (let attempt = 0; attempt < 4000 && !found; attempt++) {
    roles.assignRoles(seats)
    found = roles.getRoleReveal(seats[0].id)?.roleName === RoleDefs.getRole('time_traveler')?.name
  }
  check('a Time Traveler was found to test', found)

  const dealtAbilities = new Set<string>()
  for (let round = 0; round < 400; round++) {
    for (const s of seats) {
      s.hand = [{ suit: 'Spades', rank: 9 }]
      s.bid = null
      s.tricksWon = 0
    }
    roles.startRound(seats, 1, freshRemainder())
    const ability = roles.getRoleState(seats[0])?.abilityId
    if (ability) dealtAbilities.add(ability)
  }

  check('Rewind is never dealt — it could only ever be refused', !dealtAbilities.has('rewind'))
  check('and the other abilities still are, so the seat is never left empty', dealtAbilities.size >= 2)
}

// ---- The Detective ----------------------------------------------------------

function testIllusionScramblesEveryHand() {
  console.log('\n🕵️ Illusion (blackout + the reshuffle that hides it)')
  const { bus, roles, seats, dealt } = setup('detective', 'illusion')
  check('the ability was dealt', dealt)
  const [me] = seats

  const before = new Map(seats.map((s) => [s.id, s.hand.map(cardKey).join(',')]))
  roles.handleUseAbility(me, { scope: 'all' })

  const blacked = seats
    .filter((s) => s.id !== me.id)
    .map((s) => (bus.to(s.id, 'illusion').at(-1) as { cards: string[] } | undefined)?.cards ?? [])
  check('one card is blacked out in every OTHER hand', blacked.every((c) => c.length === 1))
  check('and never in the Detective’s own', bus.to(me.id, 'illusion').length === 0)

  // The reshuffle has to reach every seat, the caster included -- a hand that
  // didn't move would be the tell.
  check(
    'every seat is re-sent its hand, including the Detective',
    seats.every((s) => bus.to(s.id, 'dealHand').length > 0),
  )
  check(
    'nobody gains or loses a card, only the order moves',
    seats.every((s) => {
      const now = [...s.hand].map(cardKey).sort().join(',')
      const then = (before.get(s.id) as string).split(',').sort().join(',')
      return now === then
    }),
  )

  // A 3-card hand shuffles back to itself 1 time in 6, so prove it over casts
  // rather than off one.
  let moved = false
  for (let i = 0; i < 40 && !moved; i++) {
    const order = seats[1].hand.map(cardKey).join(',')
    const fresh = setup('detective', 'illusion')
    fresh.roles.handleUseAbility(fresh.seats[0], { scope: 'all' })
    moved = fresh.seats[1].hand.map(cardKey).join(',') !== order
  }
  check('the order really is scrambled', moved)
}

// ---- The Mirrorer -----------------------------------------------------------

function testMimic() {
  console.log('\n🪞 Mimic')
  const { bus, roles, seats, dealt } = setup('mirrorer', 'mimic')
  check('the ability was dealt', dealt)
  const [me, mark] = seats

  const forced = roles as unknown as { abilityBySeat: Map<string, string> }
  forced.abilityBySeat.set(mark.id, 'fortune')

  roles.handleUseAbility(me, { targetId: mark.id })
  check('you now hold what they hold', roles.getRoleState(me)?.abilityId === 'fortune')
  check('they keep theirs too — it is copied, not stolen', roles.getRoleState(mark)?.abilityId === 'fortune')
  check('your turn is NOT spent: the copy is there to be used', roles.getRoleState(me)?.used === false)
  check('nothing is announced — the mirror is quiet', bus.announcements().length === 0)

  // And the copied ability really works from its new owner.
  bus.clear()
  roles.handleUseAbility(me, { suit: 'Diamonds' })
  check('the copied ability fires normally', bus.privateTo(me.id).length === 1)
  check('and THAT spends the turn', roles.getRoleState(me)?.used === true)

  // A mirror facing a mirror would re-grant itself for free, forever.
  const second = setup('mirrorer', 'mimic')
  const [me2, mark2] = second.seats
  ;(second.roles as unknown as { abilityBySeat: Map<string, string> }).abilityBySeat.set(mark2.id, 'mimic')
  second.bus.clear()
  second.roles.handleUseAbility(me2, { targetId: mark2.id })
  check('mirroring a mirror is refused', second.bus.errorsTo(me2.id).length === 1)
  check('and the refusal costs nothing', second.roles.getRoleState(me2)?.abilityId === 'mimic')
}

function testTwinFate() {
  console.log('\n🪞 Twin Fate')
  const { bus, roles, seats, dealt } = setup('mirrorer', 'twin_fate')
  check('the ability was dealt', dealt)
  const [me, partner, other] = seats

  roles.handleUseAbility(me, { targetId: partner.id })
  check('nothing is announced when it is cast', bus.announcements().length === 0)
  check('the ability is spent', roles.getRoleState(me)?.used === true)

  for (const s of seats) {
    s.bid = 1
    s.tricksWon = 1
  }
  bus.clear()
  // The base score passes straight through adjustScore here, so these ARE the
  // two round scores: a bad -3 tied to a good +11.
  roles.prepareScoring()
  const scores = new Map<string, number>()
  scores.set(me.id, roles.adjustScore(me, -3))
  scores.set(partner.id, roles.adjustScore(partner, 11))
  scores.set(other.id, roles.adjustScore(other, 7))
  roles.settleMirror(scores)

  check(
    'if either of them wins, they BOTH win',
    scores.get(me.id) === 11 && scores.get(partner.id) === 11,
  )
  check('nobody else is touched', scores.get(other.id) === 7)
  check(
    'the table is told they are tied, since both scores visibly move',
    bus.announcements().some((m) => m.includes('TWIN FATE')),
  )

  // The partner having the worse round is the version that costs you.
  const b = setup('mirrorer', 'twin_fate')
  const [meB, partnerB] = b.seats
  b.roles.handleUseAbility(meB, { targetId: partnerB.id })
  for (const s of b.seats) {
    s.bid = 1
    s.tricksWon = 1
  }
  b.roles.prepareScoring()
  const scoresB = new Map<string, number>()
  scoresB.set(meB.id, b.roles.adjustScore(meB, 11))
  scoresB.set(partnerB.id, b.roles.adjustScore(partnerB, -3))
  b.roles.settleMirror(scoresB)
  check('it works the other way too — your good round carries them', scoresB.get(partnerB.id) === 11)
}

function testTwoWayMirror() {
  console.log('\n🪞 Two-Way Mirror')
  const { bus, roles, seats, dealt } = setup('mirrorer', 'two_way_mirror')
  check('the ability was dealt', dealt)
  const [me, mark, other] = seats

  roles.handleUseAbility(me, { targetId: mark.id })
  check('nothing is announced when it is cast', bus.announcements().length === 0)
  check('the ability is spent', roles.getRoleState(me)?.used === true)

  for (const s of seats) {
    s.bid = 1
    s.tricksWon = 1
  }
  bus.clear()
  roles.prepareScoring()
  const scores = new Map<string, number>()
  scores.set(me.id, roles.adjustScore(me, -8))
  scores.set(mark.id, roles.adjustScore(mark, 13))
  scores.set(other.id, roles.adjustScore(other, 7))
  roles.settleMirror(scores)

  check('the two rounds trade places', scores.get(me.id) === 13 && scores.get(mark.id) === -8)
  check('nobody else is touched', scores.get(other.id) === 7)
  check(
    'the swap is announced — two scores visibly move',
    bus.announcements().some((m) => m.includes('TWO-WAY MIRROR')),
  )
}

testReverseTime()
testRewindGuards()
testAlternateUniverse()
testTimeBranches()
testGuardianAngel()
testGraceOnlyWhenItHelps()
testHaloAndSacrifice()
testIntercede()
testRewindNotDealtInOneCardRounds()
testIllusionScramblesEveryHand()
testMimic()
testTwinFate()
testTwoWayMirror()

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
