// Server-only: builds, shuffles, and deals the golf grids. Never imported by
// the client -- shuffling must stay authoritative and hidden from players.
//
// Jokers are a permanent Golf rule (the -2 wildcard), not the Prediction
// Game's overflow-only joker logic -- always dealt in, regardless of table
// size.

import type { Card } from '@shared/cards'
import { GRID_SIZE } from '@shared/golfRules'
import { shuffle } from '../../types'
import type { Seat } from '../../types'
import { buildFullDeck } from '../deck'

/**
 * Deals a 6-card grid to each seat in `order`, then flips one more card to
 * start the discard pile. Whatever's left is the stock.
 */
export function dealGolfGrids(order: Seat[]): {
  grids: Map<string, Card[]>
  stock: Card[]
  discardTop: Card
} {
  const cardsNeeded = order.length * GRID_SIZE + 1
  const deck = buildFullDeck(true)
  if (cardsNeeded > deck.length) {
    throw new Error('Not enough cards in the deck for this deal')
  }
  shuffle(deck)

  const grids = new Map<string, Card[]>()
  for (const seat of order) grids.set(seat.id, [])

  let cursor = 0
  for (let i = 0; i < GRID_SIZE; i++) {
    for (const seat of order) {
      grids.get(seat.id)!.push(deck[cursor])
      cursor++
    }
  }

  const discardTop = deck[cursor]
  cursor++

  return { grids, stock: deck.slice(cursor), discardTop }
}
