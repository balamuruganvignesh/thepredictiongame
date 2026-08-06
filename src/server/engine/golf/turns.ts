// The turn phase: one seat at a time draws (stock or discard), sees what they
// got, then decides what to do with it. Each turn is a TWO-stage wait --
// draw, then resolve -- the same chaining shape BiddingManager already uses
// for bid-then-double-window (bidding.ts). No turn timers, ever: only a seat
// that has actually disconnected gets auto-played for, via setImmediate.
//
// This manager owns the stock and discard piles -- they're table furniture,
// not any one seat's -- and the "final lap": once a seat's grid is fully
// face-up, everyone else gets exactly one more turn before the hole ends.

import type { Card } from '@shared/cards'
import { GolfConfig } from '@shared/config'
import { GRID_SIZE, cardValue } from '@shared/golfRules'
import type { GolfDrawSource, GolfResolveAction, GolfState } from '@shared/protocol'
import type { Seat } from '../../types'
import { shuffle, sleep } from '../../types'
import type { EngineIO } from '../io'

export class GolfTurnManager {
  private seats: Seat[] = []
  private stock: Card[] = []
  /** Last element is the visible top. */
  private discardPile: Card[] = []

  private currentTurnSeat: Seat | null = null
  private awaitingResolve = false
  private pendingCard: Card | null = null
  private pendingSource: GolfDrawSource | null = null
  private drawResolver: ((source: GolfDrawSource) => void) | null = null
  private resolveResolver: ((action: GolfResolveAction) => void) | null = null

  private finalLapTriggeredBy: string | null = null
  private finalLapRemaining = new Set<string>()

  /** Set by cancel(): the turn phase bails out at its next checkpoint. */
  private cancelled = false

  constructor(private io: EngineIO) {}

  reset() {
    this.seats = []
    this.stock = []
    this.discardPile = []
    this.currentTurnSeat = null
    this.awaitingResolve = false
    this.pendingCard = null
    this.pendingSource = null
    this.drawResolver = null
    this.resolveResolver = null
    this.finalLapTriggeredBy = null
    this.finalLapRemaining.clear()
    this.cancelled = false
  }

  private discardTop(): Card | null {
    return this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null
  }

  private publicGrids(): Record<string, (Card | null)[]> {
    return Object.fromEntries(
      this.seats.map((seat) => [
        seat.id,
        seat.golfGrid.map((card, i) => (seat.golfRevealed[i] ? card : null)),
      ]),
    )
  }

  /** The live public table -- also exactly the shape of a `golfState` broadcast. */
  snapshot(): GolfState {
    return {
      grids: this.publicGrids(),
      discardTop: this.discardTop(),
      stockCount: this.stock.length,
      currentTurnId: this.currentTurnSeat?.id ?? null,
      awaitingResolve: this.awaitingResolve,
      finalLap: this.finalLapTriggeredBy != null,
      finalLapTriggeredBy: this.finalLapTriggeredBy,
    }
  }

  /** For the reconnect snapshot: a card this seat drew and hasn't placed yet. */
  pendingDrawFor(seat: Seat): { card: Card; source: GolfDrawSource } | null {
    if (this.currentTurnSeat?.id !== seat.id || !this.awaitingResolve) return null
    if (!this.pendingCard || !this.pendingSource) return null
    return { card: this.pendingCard, source: this.pendingSource }
  }

  private broadcastState() {
    this.io.broadcast('golfState', this.snapshot())
  }

  private drawFromStock(): Card {
    if (this.stock.length === 0) this.reshuffleDiscardIntoStock()
    return this.stock.pop() as Card
  }

  /** Keeps the current top where it is; shuffles everything under it into a fresh stock. */
  private reshuffleDiscardIntoStock() {
    const top = this.discardPile.pop()
    this.stock = shuffle(this.discardPile)
    this.discardPile = top ? [top] : []
  }

  /**
   * The least-damaging move for a seat that isn't here to choose: swap the
   * draw in for the worst card you know about if it's actually better; failing
   * that, use a stock draw to learn something instead of wasting it; failing
   * that, you have to swap it in somewhere.
   */
  private autoResolve(seat: Seat, card: Card, source: GolfDrawSource): GolfResolveAction {
    const drawnValue = cardValue(card)
    let worstSlot = -1
    let worstValue = -Infinity
    for (let i = 0; i < GRID_SIZE; i++) {
      if (!seat.golfRevealed[i]) continue
      const value = cardValue(seat.golfGrid[i])
      if (value > worstValue) {
        worstValue = value
        worstSlot = i
      }
    }
    if (worstSlot >= 0 && drawnValue < worstValue) {
      return { type: 'swap', slot: worstSlot }
    }
    if (source === 'stock') {
      const hiddenSlot = seat.golfRevealed.findIndex((revealed) => !revealed)
      if (hiddenSlot >= 0) return { type: 'discardAndFlip', slot: hiddenSlot }
    }
    return { type: 'swap', slot: worstSlot >= 0 ? worstSlot : 0 }
  }

  private waitForDraw(seat: Seat): Promise<GolfDrawSource> {
    return new Promise<GolfDrawSource>((resolve) => {
      let settled = false
      const finish = (source: GolfDrawSource) => {
        if (settled) return
        settled = true
        this.drawResolver = null
        resolve(source)
      }
      this.drawResolver = finish

      // No turn timer, ever. Only a seat that has actually left draws itself.
      if (!seat.connected) setImmediate(() => finish('stock'))
    })
  }

  private waitForResolve(seat: Seat, card: Card, source: GolfDrawSource): Promise<GolfResolveAction> {
    return new Promise<GolfResolveAction>((resolve) => {
      let settled = false
      const finish = (action: GolfResolveAction) => {
        if (settled) return
        settled = true
        this.resolveResolver = null
        resolve(action)
      }
      this.resolveResolver = finish

      if (!seat.connected) setImmediate(() => finish(this.autoResolve(seat, card, source)))
    })
  }

  private applyResolve(seat: Seat, card: Card, action: GolfResolveAction) {
    if (action.type === 'swap') {
      const old = seat.golfGrid[action.slot]
      seat.golfGrid[action.slot] = card
      seat.golfRevealed[action.slot] = true
      this.discardPile.push(old)
    } else {
      this.discardPile.push(card)
      seat.golfRevealed[action.slot] = true
    }
  }

  /**
   * Plays the hole out: `order` is the table starting from whoever acts
   * first. `stock`/`discardTop` are what `dealGolfGrids` dealt off the top.
   * Mutates seat.golfGrid and seat.golfRevealed.
   */
  async runTurnPhase(order: Seat[], stock: Card[], discardTop: Card): Promise<void> {
    this.seats = order
    this.stock = [...stock]
    this.discardPile = [discardTop]
    this.cancelled = false
    this.finalLapTriggeredBy = null
    this.finalLapRemaining.clear()
    this.broadcastState()

    let index = 0
    while (true) {
      if (this.cancelled) return
      const seat = order[index % order.length]
      index++

      this.currentTurnSeat = seat
      this.awaitingResolve = false
      this.broadcastState()

      const source = await this.waitForDraw(seat)
      if (this.cancelled) return

      const card = source === 'discard' ? (this.discardPile.pop() as Card) : this.drawFromStock()
      this.pendingCard = card
      this.pendingSource = source
      this.awaitingResolve = true
      this.io.send(seat, 'golfDrawResult', { card, source })
      this.broadcastState()

      const action = await this.waitForResolve(seat, card, source)
      if (this.cancelled) return

      this.applyResolve(seat, card, action)
      this.pendingCard = null
      this.pendingSource = null
      this.currentTurnSeat = null
      this.awaitingResolve = false

      if (!this.finalLapTriggeredBy && seat.golfRevealed.every(Boolean)) {
        this.finalLapTriggeredBy = seat.id
        this.finalLapRemaining = new Set(
          order.filter((s) => s.id !== seat.id).map((s) => s.id),
        )
        this.broadcastState()
        this.io.broadcast('roleAnnounce', {
          message: `🏁 ${seat.name} flipped their whole grid — last lap!`,
        })
      } else {
        this.broadcastState()
        if (this.finalLapTriggeredBy) {
          this.finalLapRemaining.delete(seat.id)
          if (this.finalLapRemaining.size === 0) return
        }
      }

      await sleep(GolfConfig.turnPause)
    }
  }

  /** Client fired `golfDraw`. */
  handleDraw(seat: Seat, source: unknown) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, 'actionError', "It's not your turn.")
      return
    }
    if (this.awaitingResolve) {
      this.io.send(seat, 'actionError', 'Decide what to do with the card you already drew.')
      return
    }
    if (source !== 'stock' && source !== 'discard') {
      this.io.send(seat, 'actionError', 'Malformed draw.')
      return
    }
    if (source === 'discard' && this.discardTop() == null) {
      this.io.send(seat, 'actionError', 'The discard pile is empty.')
      return
    }
    this.drawResolver?.(source)
  }

  private parseAction(action: unknown): GolfResolveAction | null {
    if (typeof action !== 'object' || action == null) return null
    const a = action as { type?: unknown; slot?: unknown }
    if (
      (a.type === 'swap' || a.type === 'discardAndFlip') &&
      typeof a.slot === 'number' &&
      Number.isInteger(a.slot)
    ) {
      return { type: a.type, slot: a.slot }
    }
    return null
  }

  /** Client fired `golfResolve`. */
  handleResolve(seat: Seat, rawAction: unknown) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id || !this.awaitingResolve) {
      this.io.send(seat, 'actionError', "It's not your turn to decide.")
      return
    }
    const action = this.parseAction(rawAction)
    if (!action || action.slot < 0 || action.slot >= GRID_SIZE) {
      this.io.send(seat, 'actionError', 'Malformed action.')
      return
    }
    if (action.type === 'discardAndFlip') {
      if (this.pendingSource !== 'stock') {
        this.io.send(seat, 'actionError', 'A card taken from the discard pile must be placed.')
        return
      }
      if (seat.golfRevealed[action.slot]) {
        this.io.send(seat, 'actionError', 'That card is already face-up.')
        return
      }
    }
    this.resolveResolver?.(action)
  }

  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id !== seat.id) return
    if (this.awaitingResolve && this.resolveResolver && this.pendingCard && this.pendingSource) {
      this.resolveResolver(this.autoResolve(seat, this.pendingCard, this.pendingSource))
    } else if (this.drawResolver) {
      this.drawResolver('stock')
    }
  }

  /**
   * The table voted to abandon the game. Unblocks whoever we're waiting on so
   * `runTurnPhase` returns at its next checkpoint -- whatever it resolves
   * with is discarded along with the rest of the hole.
   */
  cancel() {
    this.cancelled = true
    if (this.awaitingResolve && this.resolveResolver && this.currentTurnSeat && this.pendingCard && this.pendingSource) {
      this.resolveResolver(this.autoResolve(this.currentTurnSeat, this.pendingCard, this.pendingSource))
    } else if (this.drawResolver) {
      this.drawResolver('stock')
    }
  }
}
