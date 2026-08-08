// Scores one finished round: settles each hand against the shared point
// table (either the dealer, or the rest of the table), and rolls the result
// into each seat's running score. Mirrors golf/scoring.ts.

import type { Card } from '@shared/cards'
import { handValue, isBlackjack, isBust, settlePlayerTable, settleVsDealer } from '@shared/blackjackRules'
import type { BlackjackHandResult, BlackjackMode, BlackjackScoreUpdate } from '@shared/protocol'
import type { Seat } from '../../types'
import type { EngineIO } from '../io'

export function scoreBlackjackRound(
  io: EngineIO,
  seats: Seat[],
  mode: BlackjackMode,
  dealerHand: Card[] | null,
  roundNumber: number,
): BlackjackHandResult[] {
  let scores: Record<string, number>

  if (mode === 'dealer' && dealerHand) {
    const dealerValue = handValue(dealerHand)
    const dealerOutcome = {
      total: dealerValue.total,
      busted: isBust(dealerValue),
      blackjack: isBlackjack(dealerHand),
    }
    scores = {}
    for (const seat of seats) {
      const value = handValue(seat.blackjackHand)
      scores[seat.id] = settleVsDealer(
        {
          total: value.total,
          busted: isBust(value),
          blackjack: isBlackjack(seat.blackjackHand),
          doubled: seat.blackjackDoubled,
        },
        dealerOutcome,
      )
    }
  } else {
    scores = settlePlayerTable(
      seats.map((seat) => {
        const value = handValue(seat.blackjackHand)
        return {
          id: seat.id,
          total: value.total,
          busted: isBust(value),
          doubled: seat.blackjackDoubled,
        }
      }),
    )
  }

  const results: BlackjackHandResult[] = seats.map((seat) => {
    const roundScore = scores[seat.id] ?? 0
    seat.totalScore += roundScore
    seat.lastRoundScore = roundScore
    return { id: seat.id, roundScore, totalScore: seat.totalScore }
  })

  const update: BlackjackScoreUpdate = { roundNumber, results }
  io.broadcast('blackjackScoreUpdate', update)
  return results
}
