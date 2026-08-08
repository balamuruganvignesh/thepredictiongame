// The turn phase: one seat at a time hits, stands, or doubles, same
// sequential shape as a real blackjack table. A natural 21 on the first two
// cards settles immediately and skips that seat's turn entirely. No turn
// timers, ever: only a seat that has actually disconnected gets auto-played
// for (stand at 17+, else hit), via setImmediate.
//
// This manager owns the shoe -- it's table furniture, not any one seat's,
// same as Golf's stock pile -- and, in vs-Dealer mode, drives the dealer's
// fixed-rule auto-play once every seat is done, revealing the hole card and
// broadcasting each dealer card as it lands so it can be watched.

import type { Card } from '@shared/cards'
import { BlackjackConfig } from '@shared/config'
import { dealerShouldHit, handValue, isBlackjack, isBust } from '@shared/blackjackRules'
import type { BlackjackAction, BlackjackHandPublic, BlackjackMode, BlackjackState } from '@shared/protocol'
import type { Seat } from '../../types'
import { buildFullDeck } from '../deck'
import { shuffle, sleep } from '../../types'
import type { EngineIO } from '../io'

export class BlackjackTurnManager {
  private seats: Seat[] = []
  private hands = new Map<string, Card[]>()
  private dealerHand: Card[] | null = null
  private shoe: Card[] = []
  private mode: BlackjackMode = 'dealer'

  private doubled = new Set<string>()
  private done = new Set<string>()
  private currentTurnSeat: Seat | null = null
  /** True once the dealer's hole card is showing (their auto-play has begun). */
  private revealed = false

  private actionResolver: ((action: BlackjackAction) => void) | null = null

  /** Set by cancel(): the turn phase bails out at its next checkpoint. */
  private cancelled = false

  constructor(private io: EngineIO) {}

  reset() {
    this.seats = []
    this.hands = new Map()
    this.dealerHand = null
    this.shoe = []
    this.doubled.clear()
    this.done.clear()
    this.currentTurnSeat = null
    this.revealed = false
    this.actionResolver = null
    this.cancelled = false
  }

  private drawCard(): Card {
    // Four decks for up to seven players is comfortably enough depth that
    // this never actually triggers -- a safety net, not a required path.
    if (this.shoe.length === 0) this.shoe = shuffle(buildFullDeck(false))
    return this.shoe.pop() as Card
  }

  private publicDealerHand(): (Card | null)[] | null {
    if (!this.dealerHand) return null
    if (this.revealed) return [...this.dealerHand]
    return this.dealerHand.map((card, i) => (i === 0 ? card : null))
  }

  /** The live public table -- also exactly the shape of a `blackjackState` broadcast. */
  snapshot(): BlackjackState {
    const hands: Record<string, BlackjackHandPublic> = {}
    for (const seat of this.seats) {
      const cards = this.hands.get(seat.id) ?? []
      const value = handValue(cards)
      hands[seat.id] = {
        cards,
        total: value.total,
        soft: value.soft,
        busted: isBust(value),
        blackjack: isBlackjack(cards),
        doubled: this.doubled.has(seat.id),
        done: this.done.has(seat.id),
      }
    }

    const dealerValue = this.dealerHand && this.revealed ? handValue(this.dealerHand) : null

    return {
      hands,
      dealerHand: this.publicDealerHand(),
      dealerTotal: dealerValue?.total ?? null,
      dealerBusted: dealerValue ? isBust(dealerValue) : false,
      currentTurnId: this.currentTurnSeat?.id ?? null,
      mode: this.mode,
    }
  }

  private broadcastState() {
    this.io.broadcast('blackjackState', this.snapshot())
  }

  /** The least-damaging move for a seat that isn't here to choose. */
  private autoAction(seat: Seat): BlackjackAction {
    const value = handValue(this.hands.get(seat.id) ?? [])
    return value.total < 17 ? 'hit' : 'stand'
  }

  private waitForAction(seat: Seat): Promise<BlackjackAction> {
    return new Promise<BlackjackAction>((resolve) => {
      let settled = false
      const finish = (action: BlackjackAction) => {
        if (settled) return
        settled = true
        this.actionResolver = null
        resolve(action)
      }
      this.actionResolver = finish

      if (!seat.connected) setImmediate(() => finish(this.autoAction(seat)))
    })
  }

  /** Applies the action; returns whether the seat's turn continues. */
  private applyAction(seat: Seat, action: BlackjackAction): boolean {
    const hand = this.hands.get(seat.id)!

    if (action === 'stand') {
      this.done.add(seat.id)
      return false
    }
    if (action === 'double') {
      this.doubled.add(seat.id)
      hand.push(this.drawCard())
      this.done.add(seat.id)
      return false
    }
    // hit
    hand.push(this.drawCard())
    const value = handValue(hand)
    if (isBust(value) || value.total === 21) {
      this.done.add(seat.id)
      return false
    }
    return true
  }

  /**
   * Plays the round out: `order` is the table in turn order, `hands`/
   * `dealerHand`/`shoe` are what `dealBlackjackRound` dealt. Mutates
   * `seat.blackjackHand`/`blackjackDone`/`blackjackDoubled` as it goes so a
   * reconnect snapshot outside this manager stays in sync.
   */
  async runTurnPhase(
    order: Seat[],
    hands: Map<string, Card[]>,
    dealerHand: Card[] | null,
    shoe: Card[],
    mode: BlackjackMode,
  ): Promise<void> {
    this.seats = order
    this.hands = hands
    this.dealerHand = dealerHand
    this.shoe = [...shoe]
    this.mode = mode
    this.doubled.clear()
    this.done.clear()
    this.revealed = false
    this.cancelled = false

    // Naturals settle immediately, before anyone's turn opens.
    for (const seat of order) {
      if (isBlackjack(this.hands.get(seat.id) ?? [])) this.done.add(seat.id)
    }

    this.currentTurnSeat = null
    this.broadcastState()

    for (const seat of order) {
      if (this.cancelled) return
      if (this.done.has(seat.id)) continue

      this.currentTurnSeat = seat
      this.broadcastState()

      // A seat can act several times in a row (hit, hit, hit…), so the pacing
      // pause below sits AFTER this whole turn, once, rather than between
      // each of a seat's own actions. It has to: `waitForAction` only re-arms
      // its resolver right before each `await`, so a pause in between two
      // waits for the SAME seat leaves the resolver null for its duration --
      // a fast reply lands in that gap, passes the turn check, and
      // `actionResolver?.()` silently no-ops. The dropped action then leaves
      // the round waiting forever on a reply that already came and went.
      let acting = true
      while (acting) {
        const action = await this.waitForAction(seat)
        if (this.cancelled) return
        acting = this.applyAction(seat, action)
        seat.blackjackHand = this.hands.get(seat.id) ?? []
        seat.blackjackDone = this.done.has(seat.id)
        seat.blackjackDoubled = this.doubled.has(seat.id)
        // Cleared BEFORE the turn's final broadcast (not after), so no
        // client ever sees a "still my turn" broadcast for a hand that's
        // actually done -- same ordering Golf's runTurnPhase uses.
        if (!acting) this.currentTurnSeat = null
        this.broadcastState()
        if (this.cancelled) return
      }
      await sleep(BlackjackConfig.actPause)
      if (this.cancelled) return
    }

    if (this.cancelled) return
    if (mode === 'dealer' && this.dealerHand) await this.playDealer()
  }

  /** The dealer's fixed-rule auto-play, once every seat is done. */
  private async playDealer() {
    this.revealed = true
    this.broadcastState()
    await sleep(BlackjackConfig.settleReveal)
    if (this.cancelled) return

    while (dealerShouldHit(handValue(this.dealerHand!))) {
      this.dealerHand!.push(this.drawCard())
      this.broadcastState()
      await sleep(BlackjackConfig.actPause)
      if (this.cancelled) return
    }
  }

  /** Client fired `blackjackAction`. */
  handleAction(seat: Seat, rawAction: unknown) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, 'actionError', "It's not your turn.")
      return
    }
    if (rawAction !== 'hit' && rawAction !== 'stand' && rawAction !== 'double') {
      this.io.send(seat, 'actionError', 'Malformed action.')
      return
    }
    if (rawAction === 'double' && (this.hands.get(seat.id)?.length ?? 0) !== 2) {
      this.io.send(seat, 'actionError', 'You can only double on your first decision.')
      return
    }
    this.actionResolver?.(rawAction)
  }

  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id !== seat.id || !this.actionResolver) return
    this.actionResolver(this.autoAction(seat))
  }

  /**
   * The table voted to abandon the game. Unblocks whoever we're waiting on so
   * `runTurnPhase` returns at its next checkpoint -- whatever it resolves
   * with is discarded along with the rest of the round.
   */
  cancel() {
    this.cancelled = true
    this.actionResolver?.('stand')
  }
}
