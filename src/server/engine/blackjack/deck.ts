// Server-only: builds the shoe and deals the opening two cards to everyone
// (and the dealer, in vs-Dealer mode), one at a time around the table like a
// real deal. Never imported by the client -- shuffling must stay
// authoritative and hidden from players.

import type { Card } from '@shared/cards'
import { BlackjackConfig } from '@shared/config'
import type { BlackjackMode } from '@shared/protocol'
import type { Seat } from '../../types'
import { shuffle } from '../../types'
import { buildFullDeck } from '../deck'

export function dealBlackjackRound(
  order: Seat[],
  mode: BlackjackMode,
): { hands: Map<string, Card[]>; dealerHand: Card[] | null; shoe: Card[] } {
  const shoe: Card[] = []
  for (let i = 0; i < BlackjackConfig.deckCount; i++) shoe.push(...buildFullDeck(false))
  shuffle(shoe)

  const hands = new Map<string, Card[]>()
  for (const seat of order) hands.set(seat.id, [shoe.pop() as Card])
  const dealerHand: Card[] | null = mode === 'dealer' ? [shoe.pop() as Card] : null

  for (const seat of order) hands.get(seat.id)!.push(shoe.pop() as Card)
  if (dealerHand) dealerHand.push(shoe.pop() as Card)

  return { hands, dealerHand, shoe }
}
