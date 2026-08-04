// The Hearts play phase: one trick per card in hand, no trump, the highest
// card of the led suit takes it and leads the next.
//
// Same shape as the Prediction Game's TrickManager (a promise per turn, resolved
// by the socket handler; auto-play only for a seat that has actually left) but
// the legality rules and what a won trick means are entirely different: tricks
// aren't a prize here, they're a bag of penalty points.

import type { Card } from '@shared/cards'
import { isSameCard, resolveTrickWinnerIndex } from '@shared/cards'
import { HeartsConfig } from '@shared/config'
import {
  breaksHearts,
  isLegalHeartsPlay,
  legalHeartsPlays,
  penaltyOf,
  type PlayContext,
} from '@shared/heartsRules'
import type { HeartsState, PlayEntry } from '@shared/protocol'
import type { Seat } from '../../types'
import { sleep } from '../../types'
import type { EngineIO } from '../io'

export class HeartsTrickManager {
  private currentTurnSeat: Seat | null = null
  private currentLeadSuit: string | null = null
  private resolver: ((card: Card) => void) | null = null

  private heartsBroken = false
  private isFirstTrick = true
  /** The forced opening lead, until it has been played. */
  private mustLeadCard: Card | null = null

  // Mirrored for the reconnect snapshot.
  private livePlays: PlayEntry[] = []
  private liveTrickNumber = 0
  private seats: Seat[] = []

  constructor(private io: EngineIO) {}

  reset() {
    this.currentTurnSeat = null
    this.currentLeadSuit = null
    this.resolver = null
    this.heartsBroken = false
    this.isFirstTrick = true
    this.mustLeadCard = null
    this.livePlays = []
    this.liveTrickNumber = 0
  }

  snapshot() {
    return {
      currentTurnId: this.currentTurnSeat?.id ?? null,
      leadSuit: this.currentLeadSuit,
      plays: this.livePlays,
      trickNumber: this.liveTrickNumber,
    }
  }

  /** The Hearts half of a snapshot / the live heartsState payload. */
  state(): HeartsState {
    return {
      heartsBroken: this.heartsBroken,
      isFirstTrick: this.isFirstTrick,
      mustLeadCard: this.mustLeadCard,
      penalties: this.penalties(),
    }
  }

  /** Penalty points taken so far this round, per seat. */
  private penalties(): Record<string, number> {
    return Object.fromEntries(
      this.seats.map((seat) => [
        seat.id,
        seat.collected.reduce((sum, card) => sum + penaltyOf(card), 0),
      ]),
    )
  }

  private broadcastState() {
    this.io.broadcast('heartsState', this.state())
  }

  /** The rules context for the seat about to play. */
  private context(leadSuit: string | null): PlayContext {
    return {
      leadSuit,
      heartsBroken: this.heartsBroken,
      isFirstTrick: this.isFirstTrick,
      mustLeadCard: leadSuit == null ? this.mustLeadCard : null,
    }
  }

  private broadcastTrickState(
    plays: { seat: Seat; card: Card }[],
    leadSuit: string | null,
    trickNumber: number,
    totalTricks: number,
  ) {
    this.livePlays = plays.map((p) => ({ id: p.seat.id, card: p.card }))
    this.liveTrickNumber = trickNumber
    this.currentLeadSuit = leadSuit
    this.io.broadcast('trickUpdate', {
      currentTurnId: this.currentTurnSeat?.id ?? null,
      plays: this.livePlays,
      leadSuit,
      trickNumber,
      totalTricks,
    })
  }

  /** What an empty chair plays: the least damaging legal card it holds. */
  private autoPlay(seat: Seat, leadSuit: string | null): Card {
    const legal = legalHeartsPlays(seat.hand, this.context(leadSuit))
    const pool = legal.length > 0 ? legal : seat.hand
    return [...pool].sort((a, b) => penaltyOf(a) - penaltyOf(b) || a.rank - b.rank)[0]
  }

  private waitForCardPlay(seat: Seat, leadSuit: string | null): Promise<Card> {
    return new Promise<Card>((resolve) => {
      let settled = false
      const finish = (card: Card) => {
        if (settled) return
        settled = true
        this.resolver = null
        resolve(card)
      }
      this.resolver = finish

      // No turn timer, ever. Only a seat that has left plays itself.
      if (!seat.connected) setImmediate(() => finish(this.autoPlay(seat, leadSuit)))
    })
  }

  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(this.autoPlay(seat, this.currentLeadSuit))
    }
  }

  private rotateToStart(order: Seat[], start: Seat): Seat[] {
    const index = Math.max(
      0,
      order.findIndex((s) => s.id === start.id),
    )
    return order.map((_, i) => order[(index + i) % order.length])
  }

  /**
   * Plays the round out. `order` is the table in canonical seat order;
   * `opening` is the card that must lead trick 1, and whoever holds it leads.
   * Mutates seat.hand and seat.collected.
   */
  async runPlayPhase(order: Seat[], cardsEach: number, opening: Card): Promise<void> {
    this.seats = order
    this.heartsBroken = false
    this.isFirstTrick = true
    this.mustLeadCard = opening

    let leader =
      order.find((seat) => seat.hand.some((card) => isSameCard(card, opening))) ?? order[0]
    this.broadcastState()

    for (let trickNumber = 1; trickNumber <= cardsEach; trickNumber++) {
      const rotated = this.rotateToStart(order, leader)
      const plays: { seat: Seat; card: Card }[] = []
      let leadSuit: string | null = null

      for (const seat of rotated) {
        this.currentTurnSeat = seat
        this.currentLeadSuit = leadSuit
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsEach)

        const card = await this.waitForCardPlay(seat, leadSuit)

        const index = seat.hand.findIndex((c) => isSameCard(c, card))
        if (index >= 0) seat.hand.splice(index, 1)
        this.io.send(seat, 'dealHand', { hand: seat.hand })

        // The forced opening lead is spent the moment it's played.
        if (this.mustLeadCard && isSameCard(card, this.mustLeadCard)) this.mustLeadCard = null

        if (!this.heartsBroken && breaksHearts(card)) {
          this.heartsBroken = true
          this.io.broadcast('roleAnnounce', { message: '💔 Hearts are broken.' })
        }

        plays.push({ seat, card })
        if (leadSuit == null) leadSuit = card.suit
        // Clear the turn before echoing the play, so this broadcast doesn't
        // still name the seat that just went and invite a second click.
        this.currentTurnSeat = null
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsEach)
        this.broadcastState()
      }

      this.currentTurnSeat = null
      // 'NoTrump' is exactly the Hearts rule: only the led suit can win.
      const winner = plays[resolveTrickWinnerIndex(plays, leadSuit as string, 'NoTrump')].seat
      winner.tricksWon += 1
      winner.collected.push(...plays.map((p) => p.card))

      this.io.broadcast('trickResolved', {
        plays: plays.map((p) => ({ id: p.seat.id, card: p.card })),
        winnerId: winner.id,
        trickNumber,
        totalTricks: cardsEach,
        counted: true,
      })

      this.isFirstTrick = false
      this.broadcastState()
      leader = winner
      await sleep(HeartsConfig.trickResolvePause)
    }
  }

  /** Client fired `playCard`. */
  handleCardPlay(seat: Seat, card: Card) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, 'actionError', "It's not your turn to play.")
      return
    }
    if (
      typeof card !== 'object' ||
      card == null ||
      typeof card.suit !== 'string' ||
      typeof card.rank !== 'number'
    ) {
      this.io.send(seat, 'actionError', 'Malformed card.')
      return
    }
    if (!seat.hand.some((c) => isSameCard(c, card))) {
      this.io.send(seat, 'actionError', "You don't have that card.")
      return
    }

    const ctx = this.context(this.currentLeadSuit)
    if (!isLegalHeartsPlay(card, seat.hand, ctx)) {
      this.io.send(seat, 'actionError', this.rejection(seat.hand, ctx))
      return
    }

    this.resolver?.(card)
  }

  /** Says WHICH rule the card broke, so the toast is actually useful. */
  private rejection(hand: Card[], ctx: PlayContext): string {
    if (ctx.leadSuit == null) {
      if (ctx.mustLeadCard) return 'The round has to open with the lowest club dealt.'
      return 'Hearts have not been broken yet — you cannot lead one.'
    }
    if (hand.some((c) => c.suit === ctx.leadSuit)) return 'You must follow suit if you can.'
    return 'No penalty cards on the first trick.'
  }
}
