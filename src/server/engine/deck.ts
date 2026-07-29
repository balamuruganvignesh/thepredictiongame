// Server-only: builds, shuffles, and deals the deck. Never imported by the
// client -- shuffling must stay authoritative and hidden from players.

import type { Card, Suit } from '@shared/cards'
import { sortHand } from '@shared/cards'
import { shuffle } from '../types'
import type { Seat } from '../types'

const SUITS: Suit[] = ['Spades', 'Diamonds', 'Clubs', 'Hearts']

/** A fresh, unshuffled 52-card deck (or 54 with two jokers). */
export function buildFullDeck(includeJokers: boolean): Card[] {
  const cards: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) cards.push({ suit, rank })
  }
  if (includeJokers) {
    cards.push({ suit: 'Joker', rank: 15 }, { suit: 'Joker', rank: 15 })
  }
  return cards
}

/**
 * Deals `cardsPerPlayer` to each seat in `order`, round-robin (one card at a
 * time). Second return value is the undealt remainder of the deck, in order --
 * chaos mode's Fortune ability peeks it.
 */
export function dealHands(
  order: Seat[],
  cardsPerPlayer: number,
): { hands: Map<string, Card[]>; remainder: Card[] } {
  const cardsNeeded = order.length * cardsPerPlayer
  // 10 x 5 = 50 <= 52, so this never triggers with the default sequence; kept
  // so a longer card sequence can't silently deal off the end of the deck.
  const includeJokers = order.length >= 6 && cardsNeeded > 52

  const deck = buildFullDeck(includeJokers)
  if (cardsNeeded > deck.length) {
    throw new Error('Not enough cards in the deck for this deal')
  }
  shuffle(deck)

  const hands = new Map<string, Card[]>()
  for (const seat of order) hands.set(seat.id, [])

  let cursor = 0
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (const seat of order) {
      hands.get(seat.id)!.push(deck[cursor])
      cursor++
    }
  }

  for (const seat of order) sortHand(hands.get(seat.id)!)

  return { hands, remainder: deck.slice(cursor) }
}
