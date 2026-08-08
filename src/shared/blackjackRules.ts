// Blackjack: every rule that is pure. Imported by BOTH sides, since the
// client renders the same totals/bust state the server scores by. No RNG, no
// state -- shuffling and dealing live in server/engine/blackjack/deck.ts.

import type { Card } from './cards'

export type HandValue = { total: number; soft: boolean }

/** Ace = 11 (demoted to 1 by handValue if it would bust), face cards = 10. */
function cardBlackjackValue(card: Card): number {
  if (card.rank === 14) return 11 // Ace, counted high until it would bust
  if (card.rank >= 11) return 10 // Jack, Queen, King
  return card.rank // 2-10
}

/**
 * Sums a hand, demoting Aces from 11 to 1 one at a time while the total is
 * over 21. `soft` is true when at least one Ace is still being counted as 11.
 */
export function handValue(cards: Card[]): HandValue {
  let total = 0
  let aces = 0
  for (const card of cards) {
    total += cardBlackjackValue(card)
    if (card.rank === 14) aces++
  }
  while (total > 21 && aces > 0) {
    total -= 10
    aces--
  }
  return { total, soft: aces > 0 }
}

export function isBust(value: HandValue): boolean {
  return value.total > 21
}

/** A natural: 21 on the first two cards only. */
export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21
}

/** The dealer's fixed house rule: hit under 17, stand on all 17s (hard or soft). */
export function dealerShouldHit(value: HandValue): boolean {
  return value.total < 17
}

export type HandOutcome = {
  total: number
  busted: boolean
  blackjack: boolean
  doubled: boolean
}

/**
 * The vs-Dealer point table. Push (equal totals, or both natural) -> 0; a
 * natural beating a non-natural dealer -> +2, and can never be doubled -- a
 * natural settles before any decision is made; a regular win/loss is +-1,
 * doubled to +-2.
 */
export function settleVsDealer(
  player: HandOutcome,
  dealer: Omit<HandOutcome, 'doubled'>,
): number {
  if (player.blackjack && dealer.blackjack) return 0
  if (player.blackjack) return 2
  if (player.busted) return player.doubled ? -2 : -1
  if (dealer.blackjack) return player.doubled ? -2 : -1
  if (dealer.busted) return player.doubled ? 2 : 1
  if (player.total === dealer.total) return 0
  return player.total > dealer.total ? (player.doubled ? 2 : 1) : player.doubled ? -2 : -1
}

/**
 * vs-Players mode: no dealer, so hands are ranked against the whole table
 * instead of settled pairwise. The highest non-busted total wins the round
 * (ties split the win, a natural 21 wins outright since it's the max
 * non-bust value); every busted seat scores -1; every other seat scores 0.
 * Same double multiplier as vs-Dealer.
 */
export function settlePlayerTable(
  entries: { id: string; total: number; busted: boolean; doubled: boolean }[],
): Record<string, number> {
  const scores: Record<string, number> = {}
  const contenders = entries.filter((e) => !e.busted)
  const bestTotal = contenders.reduce((max, e) => Math.max(max, e.total), -Infinity)
  const winners = new Set(contenders.filter((e) => e.total === bestTotal).map((e) => e.id))

  for (const entry of entries) {
    if (entry.busted) scores[entry.id] = entry.doubled ? -2 : -1
    else if (winners.has(entry.id)) scores[entry.id] = entry.doubled ? 2 : 1
    else scores[entry.id] = 0
  }
  return scores
}
