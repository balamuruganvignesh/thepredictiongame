// The pass phase: everyone gives three cards to the same neighbour, all at
// once. Unlike bidding this is NOT turn-based -- every seat is prompted
// together and the round moves on when the last one has chosen.
//
// No turn timers here either (see CLAUDE.md): a connected player is waited on
// for as long as they need. Only a seat that has actually disconnected gets
// its three cards chosen for it, which is what stops the phase hanging on an
// empty chair.

import type { Card } from '@shared/cards'
import { isSameCard, sortHand } from '@shared/cards'
import {
  PASS_COUNT,
  isQueenOfSpades,
  passDirection,
  passTargetIndex,
  type PassDirection,
} from '@shared/heartsRules'
import type { Seat } from '../../types'
import type { EngineIO } from '../io'

/**
 * How badly a seat wants rid of a card, for the auto-pass an empty chair gets.
 * The queen first, then the high spades that can be forced to eat her, then
 * high hearts.
 */
function dangerOf(card: Card): number {
  if (isQueenOfSpades(card)) return 1000
  if (card.suit === 'Spades' && card.rank > 12) return 500 + card.rank
  if (card.suit === 'Hearts') return 100 + card.rank
  return card.rank
}

export class PassManager {
  /** One resolver per seat still owing three cards. */
  private pending = new Map<string, () => void>()
  /** Set by cancel(): the pass phase bails out without moving any cards. */
  private cancelled = false

  constructor(private io: EngineIO) {}

  reset() {
    this.pending.clear()
    this.cancelled = false
  }

  /**
   * The table voted to abandon the game. Releases every seat still choosing so
   * `runPassPhase` returns -- and it returns BEFORE any card moves, so a
   * cancelled pass leaves the hands exactly as they were dealt.
   */
  cancel() {
    this.cancelled = true
    for (const resolve of [...this.pending.values()]) resolve()
  }

  /** For the reconnect snapshot: is the pass modal still up for this seat? */
  isPending(seat: Seat): boolean {
    return this.pending.has(seat.id)
  }

  directionFor(roundNumber: number, playerCount: number): PassDirection {
    return passDirection(roundNumber, playerCount)
  }

  /** Who this seat's cards go to this round, or null on a no-pass round. */
  targetFor(order: Seat[], seat: Seat, roundNumber: number): Seat | null {
    const index = order.findIndex((s) => s.id === seat.id)
    const target = passTargetIndex(index, order.length, roundNumber)
    return target == null ? null : order[target]
  }

  /**
   * Blocks until every seat has chosen (or been chosen for), then moves the
   * cards. Returns immediately on a no-pass round.
   */
  async runPassPhase(order: Seat[], roundNumber: number): Promise<void> {
    this.cancelled = false
    const direction = passDirection(roundNumber, order.length)
    if (direction === 'none') {
      for (const seat of order) {
        this.io.send(seat, 'passPrompt', { direction, passToId: null, count: 0 })
      }
      return
    }

    for (const seat of order) seat.passSelection = null

    const waits = order.map((seat) => {
      const target = this.targetFor(order, seat, roundNumber)
      this.io.send(seat, 'passPrompt', {
        direction,
        passToId: target?.id ?? null,
        count: PASS_COUNT,
      })

      return new Promise<void>((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          this.pending.delete(seat.id)
          resolve()
        }
        this.pending.set(seat.id, finish)

        if (!seat.connected) {
          seat.passSelection = this.autoSelect(seat)
          setImmediate(finish)
        }
      })
    })

    await Promise.all(waits)
    // Cancelled mid-choice: leave every hand as dealt. The round is discarded.
    if (this.cancelled) return

    // Every hand is emptied of its outgoing cards BEFORE any incoming card
    // lands, so a card that was just passed to you can't be passed straight on.
    const outgoing = new Map<string, Card[]>()
    for (const seat of order) {
      const selection = seat.passSelection ?? this.autoSelect(seat)
      outgoing.set(seat.id, selection)
      for (const card of selection) {
        const index = seat.hand.findIndex((c) => isSameCard(c, card))
        if (index >= 0) seat.hand.splice(index, 1)
      }
    }

    for (const seat of order) {
      const from = order.find((s) => this.targetFor(order, s, roundNumber)?.id === seat.id)
      const received = from ? (outgoing.get(from.id) as Card[]) : []
      seat.hand.push(...received)
      sortHand(seat.hand)
      seat.passSelection = null

      this.io.send(seat, 'passResult', { cards: received, fromId: from?.id ?? null })
      this.io.send(seat, 'dealHand', { hand: seat.hand })
    }
  }

  /** The three cards an empty chair gives away. */
  private autoSelect(seat: Seat): Card[] {
    return [...seat.hand].sort((a, b) => dangerOf(b) - dangerOf(a)).slice(0, PASS_COUNT)
  }

  /** Client fired `passCards`. One shot: once accepted, the choice is final. */
  handlePassSelection(seat: Seat, cards: Card[]) {
    const resolve = this.pending.get(seat.id)
    if (!resolve) {
      this.io.send(seat, 'actionError', 'There is nothing to pass right now.')
      return
    }
    if (!Array.isArray(cards) || cards.length !== PASS_COUNT) {
      this.io.send(seat, 'actionError', `Pick exactly ${PASS_COUNT} cards to pass.`)
      return
    }

    const chosen: Card[] = []
    for (const card of cards) {
      if (
        typeof card !== 'object' ||
        card == null ||
        typeof card.suit !== 'string' ||
        typeof card.rank !== 'number'
      ) {
        this.io.send(seat, 'actionError', 'Malformed card.')
        return
      }
      // Checked against what's left to choose from, so the same card can't be
      // sent three times.
      if (chosen.some((c) => isSameCard(c, card)) || !seat.hand.some((c) => isSameCard(c, card))) {
        this.io.send(seat, 'actionError', "You don't have that card.")
        return
      }
      chosen.push({ suit: card.suit, rank: card.rank })
    }

    seat.passSelection = chosen
    resolve()
  }

  onSeatDisconnected(seat: Seat) {
    const resolve = this.pending.get(seat.id)
    if (!resolve) return
    if (!seat.passSelection) seat.passSelection = this.autoSelect(seat)
    resolve()
  }
}
