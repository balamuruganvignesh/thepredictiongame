// End of a Hearts round: turn what each seat collected into penalty points,
// apply Shoot the Moon, and add it to the running totals. Points are BAD here --
// the lowest total wins the game.

import { scoreHeartsRound } from '@shared/heartsRules'
import type { HeartsRoundLineWire } from '@shared/protocol'
import type { Seat } from '../../types'
import type { EngineIO } from '../io'

export function scoreHeartsRoundForSeats(
  io: EngineIO,
  seats: Seat[],
  roundNumber: number,
): HeartsRoundLineWire[] {
  const lines = scoreHeartsRound(seats.map((seat) => ({ id: seat.id, cards: seat.collected })))
  const bySeat = new Map(seats.map((seat) => [seat.id, seat]))

  const results: HeartsRoundLineWire[] = lines.map((line) => {
    const seat = bySeat.get(line.id) as Seat
    seat.totalScore += line.roundScore
    seat.lastRoundScore = line.roundScore
    return { ...line, totalScore: seat.totalScore }
  })

  // The one round event worth announcing: someone took all 26 and handed them
  // straight back to the table.
  const shooter = results.find((line) => line.shotMoon)
  if (shooter) {
    const name = bySeat.get(shooter.id)?.name ?? 'Someone'
    io.broadcast('roleAnnounce', { message: `🌕 ${name} SHOT THE MOON — 26 to everyone else!` })
  }

  io.broadcast('heartsScoreUpdate', { roundNumber, results })
  return results
}
