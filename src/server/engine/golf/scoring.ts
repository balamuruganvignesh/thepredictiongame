// Scores one finished hole: reveals whatever's still face-down (so everyone
// sees the grid they were actually holding), adds up the columns, and rolls
// the total into each seat's running score. Mirrors hearts/scoring.ts.

import { gridScore } from '@shared/golfRules'
import type { GolfHoleResult, GolfScoreUpdate, GolfState } from '@shared/protocol'
import type { Seat } from '../../types'
import type { EngineIO } from '../io'

export function scoreGolfHole(io: EngineIO, seats: Seat[], holeNumber: number): GolfHoleResult[] {
  // The hole is over: reveal every card, face-down or not.
  for (const seat of seats) seat.golfRevealed = seat.golfRevealed.map(() => true)

  const grids: GolfState['grids'] = Object.fromEntries(
    seats.map((seat) => [seat.id, [...seat.golfGrid]]),
  )
  io.broadcast('golfState', {
    grids,
    discardTop: null,
    stockCount: 0,
    currentTurnId: null,
    awaitingResolve: false,
    finalLap: false,
    finalLapTriggeredBy: null,
  })

  const results: GolfHoleResult[] = seats.map((seat) => {
    const score = gridScore(seat.golfGrid)
    seat.totalScore += score
    seat.lastRoundScore = score
    return { id: seat.id, gridScore: score, totalScore: seat.totalScore }
  })

  const update: GolfScoreUpdate = { holeNumber, results }
  io.broadcast('golfScoreUpdate', update)
  return results
}
