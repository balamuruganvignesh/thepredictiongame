// Golf: every rule that is pure. Imported by BOTH sides, because the client
// draws the same grids and scores the same holes the server does -- a
// disagreement here would just be a wrong number on screen, but keeping the
// rules in one place is what lets the client render column-match highlights
// without duplicating logic.
//
// No RNG and no state in here; the deal itself lives in
// server/engine/golf/deck.ts.

import type { Card } from './cards'

/** 2 rows x 3 columns per player. */
export const GRID_SIZE = 6
/** How many of your own 6 cards you flip face-up before turns begin. */
export const INITIAL_REVEAL_COUNT = 2

/**
 * Joker = -2 (the wildcard bonus), King = 0, Ace = 1, 2-10 = face value
 * (already numerically equal to `Card.rank` in this codebase's scheme),
 * J/Q = 10.
 */
export function cardValue(card: Card): number {
  if (card.suit === 'Joker') return -2
  if (card.rank === 13) return 0 // King
  if (card.rank === 14) return 1 // Ace
  if (card.rank === 11 || card.rank === 12) return 10 // Jack, Queen
  return card.rank // 2-10
}

/**
 * A column is the two cards stacked in one of the grid's 3 positions (top
 * row + bottom row). Matching ranks cancel the whole column to 0 -- even a
 * King-King column, which would otherwise already be worth 0 on its own.
 */
export function columnScore(top: Card, bottom: Card): number {
  if (top.rank === bottom.rank) return 0
  return cardValue(top) + cardValue(bottom)
}

/**
 * Total score for one player's finished grid. `grid` is row-major: indices
 * 0-2 are the top row, 3-5 the bottom row, so column `i` pairs `grid[i]`
 * with `grid[i + 3]`.
 */
export function gridScore(grid: Card[]): number {
  let total = 0
  for (let i = 0; i < 3; i++) {
    total += columnScore(grid[i], grid[i + 3])
  }
  return total
}

/** Which column index (0-2) a slot index (0-5) belongs to. */
export function columnOf(slotIndex: number): number {
  return slotIndex % 3
}

/** The other slot in the same column as `slotIndex`. */
export function partnerSlot(slotIndex: number): number {
  return slotIndex < 3 ? slotIndex + 3 : slotIndex - 3
}
