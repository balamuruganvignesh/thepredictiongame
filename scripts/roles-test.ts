// Fast regression test for chaos-mode role assignment. No server needed:
//
//   npx tsx scripts/roles-test.ts
//
// It asserts the rule that matters at a real table: as long as the table FITS
// inside the role pool, nobody shares a role. assignRoles deals round-robin
// from a shuffled pool, so this holds by construction -- the test is here so
// that adding a role, or ever reaching for a plain random pick, can't quietly
// break it.

import * as RoleDefs from '../src/shared/roleDefs'
import { RoleManager } from '../src/server/engine/roles'
import type { Seat } from '../src/server/types'
import type { EngineIO } from '../src/server/engine/io'

const RUNS = 400
const MAX_PLAYERS = 10

const silentIO: EngineIO = { broadcast: () => {}, send: () => {}, sendSpectators: () => {} }

function makeSeats(count: number): Seat[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    socketId: `s${i}`,
    name: `Player ${i + 1}`,
    seatIndex: i + 1,
    ready: true,
    connected: true,
    hand: [],
    bid: null,
    hasDoubled: false,
    tricksWon: 0,
    totalScore: 0,
    lastRoundScore: null,
    disconnectedAt: null,
  }))
}

let failures = 0
const fail = (message: string) => {
  console.error(`  ✗ ${message}`)
  failures++
}

// The Mirrorer is RARE, so it only joins the pool in some games. The pool a
// table can count on is the standard list.
const guaranteedCapacity = RoleDefs.standardRoleOrder.length
console.log(
  `role pool: ${guaranteedCapacity} standard roles (+ the rare Mirrorer some games)\n`,
)

for (let count = 2; count <= MAX_PLAYERS; count++) {
  const seats = makeSeats(count)
  const roles = new RoleManager(silentIO)
  let worstDuplicates = 0
  const seen = new Set<string>()

  for (let run = 0; run < RUNS; run++) {
    roles.assignRoles(seats)
    const assigned = seats.map((seat) => roles.getRoleReveal(seat.id)?.roleName ?? '???')
    for (const name of assigned) seen.add(name)
    if (assigned.includes('???')) fail(`${count}p: a seat came out of assignRoles with no role`)
    worstDuplicates = Math.max(worstDuplicates, assigned.length - new Set(assigned).size)
  }

  const shouldBeUnique = count <= guaranteedCapacity
  if (shouldBeUnique && worstDuplicates > 0) {
    fail(`${count}p fits the pool but saw ${worstDuplicates} duplicate role(s) in ${RUNS} games`)
  } else {
    const note = shouldBeUnique
      ? 'all distinct, every game'
      : `up to ${worstDuplicates} duplicate(s) — expected, the table is bigger than the pool`
    console.log(`  ✓ ${String(count).padStart(2)}p: ${note}`)
  }

  // A pool that never deals some of its roles would satisfy the rule above and
  // still be broken, so check the spread too.
  if (count >= guaranteedCapacity && seen.size < guaranteedCapacity) {
    fail(`${count}p: only ${seen.size} distinct roles ever dealt across ${RUNS} games`)
  }
}

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
