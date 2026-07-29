// Pure scoring math, shared so the client can preview a score and the server
// can compute the authoritative result the same way.

import { Config } from './config'

/**
 * Score for a single player's round result.
 * Doubled: a hit pays 2x(10+bid); a miss costs the whole pot you were chasing,
 * -(10+bid), no matter how far off the bid was.
 */
export function calculateScore(bid: number, tricksWon: number, doubled: boolean): number {
  const diff = Math.abs(bid - tricksWon)

  if (diff === 0) {
    const base = 10 + bid
    return doubled ? base * 2 : base
  }

  if (doubled) return -(10 + bid)

  if (Config.missPenaltyMode === 'flat') return Config.flatMissPenalty
  return -diff
}

/** Can this player legally declare Double given their bid? */
export function canDouble(bid: number): boolean {
  if (Config.doubleOnlyOnZeroBid) return bid === 0
  return true
}
