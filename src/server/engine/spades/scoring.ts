// Scores one finished Spades hand and writes the result onto the seats.
// Thin wrapper around the pure math in shared/spadesRules.ts -- this is the
// only place that touches Seat.

import {
  applyBagPenalty,
  scoreSpadesHand,
  teamOfSeatPosition,
  type SpadesPlayerBid,
} from '@shared/spadesRules'
import type { SpadesHandTeamLine, SpadesScoreUpdate } from '@shared/protocol'
import type { Seat } from '../../types'
import type { EngineIO } from '../io'

/**
 * `order` must be the table in canonical seat order (position 0-3), since
 * team membership is derived from array position. Writes both partners'
 * totalScore/lastRoundScore/spadesBags to the SAME value -- the "duplicate
 * the team's number onto every member" choice that lets Room.currentStandings
 * (which is per-seat) show a Spades team correctly with zero special-casing.
 */
export function scoreSpadesHandForSeats(
  io: EngineIO,
  order: Seat[],
  handNumber: number,
): SpadesScoreUpdate {
  const players: SpadesPlayerBid[] = order.map((seat, i) => ({
    id: seat.id,
    team: teamOfSeatPosition(i),
    bid: seat.spadesBid ?? 0,
    tricksWon: seat.tricksWon,
  }))
  const teamResults = scoreSpadesHand(players)

  const teamLines: SpadesHandTeamLine[] = teamResults.map((result) => {
    const teamSeats = order.filter((_, i) => teamOfSeatPosition(i) === result.team)
    const bagsBefore = teamSeats[0]?.spadesBags ?? 0
    const { scorePenalty, bagsAfter } = applyBagPenalty(bagsBefore, result.overtricks)
    const roundScore = result.handScore + scorePenalty

    for (const seat of teamSeats) {
      seat.totalScore += roundScore
      seat.lastRoundScore = roundScore
      seat.spadesBags = bagsAfter
    }

    return {
      team: result.team,
      bid: result.bid,
      tricks: result.tricks,
      madeBid: result.madeBid,
      overtricks: result.overtricks,
      bagPenalty: scorePenalty,
      roundScore,
      totalScore: teamSeats[0]?.totalScore ?? 0,
      players: result.players,
    }
  })

  const update: SpadesScoreUpdate = { handNumber, teams: teamLines }
  io.broadcast('spadesScoreUpdate', update)
  return update
}
