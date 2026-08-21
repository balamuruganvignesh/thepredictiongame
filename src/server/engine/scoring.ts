// Applies round-end scoring to every seat and broadcasts the results.

import { calculateScore } from '@shared/scoring'
import type { RoundResult } from '@shared/protocol'
import type { Seat } from '../types'
import type { EngineIO } from './io'
import type { RoleManager } from './roles'
import type { PowerupManager } from './powerups'

/**
 * Scores every seat's bid vs. tricksWon for the round that just finished,
 * updates running totals, and fires scoreUpdate to all clients.
 */
export function scoreRound(
  io: EngineIO,
  roles: RoleManager,
  powerups: PowerupManager,
  seats: Seat[],
  roundNumber: number,
): RoundResult[] {
  // Chaos mode: resolve effects that score ACROSS seats (Sabotage's backfire)
  // before anyone's total is computed. No-op in classic.
  roles.prepareScoring()

  // Pass one: every seat's adjusted round score, banked but not yet applied.
  const scores = new Map<string, number>()
  for (const seat of seats) {
    const bid = seat.bid ?? 0
    // Chaos mode: shields, coin flips, sabotage etc. (no-op in classic).
    scores.set(seat.id, roles.adjustScore(seat, calculateScore(bid, seat.tricksWon, seat.hasDoubled)))
  }

  // A Mirrorer's Twin Fate averages two seats' finished round scores, so it can
  // only run once the pass above is complete. Before Grace: an Angel's payout is
  // private and personal, and shouldn't be handed to a bound partner. No-op in
  // classic.
  roles.settleMirror(scores)

  // An Angel's Grace is only banked as the seats they helped are scored above,
  // so it can't be settled until that whole pass is done -- an Angel sitting
  // earlier in seat order than the player they saved would otherwise be paid
  // out before they had earned it. No-op in classic.
  roles.settleGrace(scores)

  // Last of all: a bought Safety Net catches whatever the final number turned
  // out to be, rather than an intermediate one, and can only ever raise a
  // negative to zero. No-op on a table with powerups switched off.
  powerups.applySafetyNets(scores, seats)

  const results: RoundResult[] = []
  for (const seat of seats) {
    const bid = seat.bid ?? 0
    const roundScore = scores.get(seat.id) ?? 0
    seat.lastRoundScore = roundScore
    seat.totalScore += roundScore

    results.push({
      id: seat.id,
      bid,
      tricksWon: seat.tricksWon,
      doubled: seat.hasDoubled,
      roundScore,
      totalScore: seat.totalScore,
    })
  }

  io.broadcast('scoreUpdate', { roundNumber, results })
  return results
}
