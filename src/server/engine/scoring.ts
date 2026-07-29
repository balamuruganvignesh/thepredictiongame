// Applies round-end scoring to every seat and broadcasts the results.

import { calculateScore } from '@shared/scoring'
import type { RoundResult } from '@shared/protocol'
import type { Seat } from '../types'
import type { EngineIO } from './io'
import type { RoleManager } from './roles'

/**
 * Scores every seat's bid vs. tricksWon for the round that just finished,
 * updates running totals, and fires scoreUpdate to all clients.
 */
export function scoreRound(
  io: EngineIO,
  roles: RoleManager,
  seats: Seat[],
  roundNumber: number,
): RoundResult[] {
  // Chaos mode: resolve effects that score ACROSS seats (Sabotage's backfire)
  // before anyone's total is computed. No-op in classic.
  roles.prepareScoring()

  const results: RoundResult[] = []
  for (const seat of seats) {
    const bid = seat.bid ?? 0
    let roundScore = calculateScore(bid, seat.tricksWon, seat.hasDoubled)
    // Chaos mode: shields, coin flips, sabotage etc. (no-op in classic).
    roundScore = roles.adjustScore(seat, roundScore)
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
