// Server-only: builds and deals the Hearts deck. The whole deck goes out every
// round, so the deal is "trim to fit, then split evenly" rather than a fixed
// hand size.

import type { Card } from '@shared/cards'
import { sortHand } from '@shared/cards'
import { openingCard, trimmedDeck } from '@shared/heartsRules'
import { shuffle } from '../../types'
import type { Seat } from '../../types'

/**
 * Deals every card to the seats in `order`. `opening` is the card that must
 * lead trick 1 -- the 2 of Clubs unless the trim took it, in which case the
 * lowest club that survived.
 */
export function dealHearts(order: Seat[]): {
  hands: Map<string, Card[]>
  cardsEach: number
  opening: Card
} {
  const { deck, cardsEach } = trimmedDeck(order.length)
  const opening = openingCard(deck)
  shuffle(deck)

  const hands = new Map<string, Card[]>()
  for (const seat of order) hands.set(seat.id, [])

  let cursor = 0
  for (let i = 0; i < cardsEach; i++) {
    for (const seat of order) hands.get(seat.id)!.push(deck[cursor++])
  }

  for (const seat of order) sortHand(hands.get(seat.id)!)

  return { hands, cardsEach, opening }
}
