// The Spades play phase: 13 tricks, spades always trump, can't lead a spade
// until they're broken. Same shape as HeartsTrickManager (a promise per turn,
// resolved by the socket handler; auto-play only for a seat that has
// actually left) -- trick display itself reuses the fully generic
// trickUpdate/trickResolved events Hearts and the Prediction Game already
// share, so this only owns what's genuinely Spades-specific: the broken-suit
// flag and echoing bids/bags in `spadesState`.

import type { Card } from '@shared/cards'
import { isSameCard, resolveTrickWinnerIndex } from '@shared/cards'
import { SpadesConfig } from '@shared/config'
import {
  breaksSpades,
  isLegalSpadesPlay,
  legalSpadesPlays,
  type SpadesBid,
  type SpadesPlayContext,
} from '@shared/spadesRules'
import type { PlayEntry } from '@shared/protocol'
import type { Seat } from '../../types'
import { sleep } from '../../types'
import type { EngineIO } from '../io'

export class SpadesTrickManager {
  private currentTurnSeat: Seat | null = null
  private currentLeadSuit: string | null = null
  private resolver: ((card: Card) => void) | null = null
  private cancelled = false

  private spadesBroken = false
  private bids: Partial<Record<string, SpadesBid>> = {}
  private bags: [number, number] = [0, 0]

  private livePlays: PlayEntry[] = []
  private liveTrickNumber = 0

  constructor(private io: EngineIO) {}

  reset() {
    this.currentTurnSeat = null
    this.currentLeadSuit = null
    this.resolver = null
    this.spadesBroken = false
    this.bids = {}
    this.bags = [0, 0]
    this.livePlays = []
    this.liveTrickNumber = 0
    this.cancelled = false
  }

  snapshot() {
    return {
      currentTurnId: this.currentTurnSeat?.id ?? null,
      leadSuit: this.currentLeadSuit,
      plays: this.livePlays,
      trickNumber: this.liveTrickNumber,
    }
  }

  /** Whether spades have been broken yet this hand -- for reconnect snapshots. */
  isBroken(): boolean {
    return this.spadesBroken
  }

  private context(leadSuit: string | null): SpadesPlayContext {
    return { leadSuit, spadesBroken: this.spadesBroken }
  }

  private broadcastState() {
    this.io.broadcast('spadesState', {
      phase: 'playing',
      biddingTurnId: null,
      bids: this.bids,
      spadesBroken: this.spadesBroken,
      bags: this.bags,
    })
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

  /** What an empty chair plays: the lowest legal card, saving anything strong. */
  private autoPlay(seat: Seat, leadSuit: string | null): Card {
    const legal = legalSpadesPlays(seat.hand, this.context(leadSuit))
    const pool = legal.length > 0 ? legal : seat.hand
    return [...pool].sort((a, b) => a.rank - b.rank)[0]
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

  /**
   * The table voted to abandon the game. Unblocks whoever we're waiting on;
   * the card it resolves with is discarded along with the rest of the hand.
   */
  cancel() {
    this.cancelled = true
    const seat = this.currentTurnSeat
    if (seat && this.resolver) this.resolver(this.autoPlay(seat, this.currentLeadSuit))
  }

  private rotateToStart(order: Seat[], start: Seat): Seat[] {
    const index = Math.max(
      0,
      order.findIndex((s) => s.id === start.id),
    )
    return order.map((_, i) => order[(index + i) % order.length])
  }

  /**
   * Plays all 13 tricks. `order` is the table in canonical seat order,
   * `leaderSeat` leads trick 1 (left of dealer). `bids`/`bags` are this
   * hand's finalized bids and the bag counts coming in -- purely for display,
   * echoed in every `spadesState` broadcast alongside the live broken-suit
   * flag. Mutates seat.hand and seat.tricksWon.
   */
  async runPlayPhase(
    order: Seat[],
    leaderSeat: Seat,
    bids: Partial<Record<string, SpadesBid>>,
    bags: [number, number],
  ) {
    this.spadesBroken = false
    this.bids = bids
    this.bags = bags
    this.cancelled = false
    let leader = leaderSeat
    this.broadcastState()

    const cardsEach = 13
    for (let trickNumber = 1; trickNumber <= cardsEach; trickNumber++) {
      if (this.cancelled) return
      const rotated = this.rotateToStart(order, leader)
      const plays: { seat: Seat; card: Card }[] = []
      let leadSuit: string | null = null

      for (const seat of rotated) {
        this.currentTurnSeat = seat
        this.currentLeadSuit = leadSuit
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsEach)

        const card = await this.waitForCardPlay(seat, leadSuit)
        if (this.cancelled) return

        const index = seat.hand.findIndex((c) => isSameCard(c, card))
        if (index >= 0) seat.hand.splice(index, 1)
        this.io.send(seat, 'dealHand', { hand: seat.hand })

        if (!this.spadesBroken && breaksSpades(card)) {
          this.spadesBroken = true
          this.io.broadcast('roleAnnounce', { message: '♠️ Spades are broken.' })
        }

        plays.push({ seat, card })
        if (leadSuit == null) leadSuit = card.suit
        this.currentTurnSeat = null
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsEach)
        this.broadcastState()
      }

      this.currentTurnSeat = null
      const winner = plays[resolveTrickWinnerIndex(plays, leadSuit as string, 'Spades')].seat
      winner.tricksWon += 1

      this.io.broadcast('trickResolved', {
        plays: plays.map((p) => ({ id: p.seat.id, card: p.card })),
        winnerId: winner.id,
        trickNumber,
        totalTricks: cardsEach,
        counted: true,
      })

      leader = winner
      await sleep(SpadesConfig.trickResolvePause)
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
    if (!isLegalSpadesPlay(card, seat.hand, ctx)) {
      this.io.send(seat, 'actionError', this.rejection(seat.hand, ctx))
      return
    }

    this.resolver?.(card)
  }

  private rejection(hand: Card[], ctx: SpadesPlayContext): string {
    if (ctx.leadSuit == null) return 'Spades have not been broken yet — you cannot lead one.'
    if (hand.some((c) => c.suit === ctx.leadSuit)) return 'You must follow suit if you can.'
    return 'That card is not in your hand.'
  }
}
