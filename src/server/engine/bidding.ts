// Runs the bidding phase for one round: goes around the table in turn order,
// collects a legal bid from each seated player, and lets a player declare
// "Double" on their own bid. All validation is server-side; client input is
// never trusted.
//
// Double timing: right after placing their bid, a player gets a short window
// (Config.doubleWindowSeconds) to declare Double before the next player bids.
// Doubling ends the window early; once it expires the chance is gone.

import { Config } from '@shared/config'
import { canDouble } from '@shared/scoring'
import type { Seat } from '../types'
import type { EngineIO } from './io'
import type { RoleManager } from './roles'

export class BiddingManager {
  private currentTurnSeat: Seat | null = null
  private currentCardsDealt = 0
  private currentIsLastBidder = false
  private currentSumSoFar = 0
  private resolver: ((bid: number) => void) | null = null
  private doublesLocked = false
  /** Seat whose post-bid Double window is currently open (null otherwise). */
  private doubleWindowSeat: Seat | null = null
  private doubleWindowResolve: (() => void) | null = null

  constructor(
    private io: EngineIO,
    private roles: RoleManager,
    /** Announces a public moment in the table chat (used for doubling). */
    private systemChat: (text: string) => void,
  ) {}

  private isValidBid(bid: number, cardsDealt: number, isLastBidder: boolean, sumSoFar: number) {
    if (!Number.isInteger(bid) || bid < 0 || bid > cardsDealt) return false
    // Forces at least one guaranteed miss this round.
    if (isLastBidder && sumSoFar + bid === cardsDealt) return false
    return true
  }

  /**
   * Fallback bid for disconnected players: the smallest legal value, so an
   * empty chair doesn't skew scoring too wildly.
   */
  private autoChooseBid(cardsDealt: number, isLastBidder: boolean, sumSoFar: number): number {
    for (let bid = 0; bid <= cardsDealt; bid++) {
      if (this.isValidBid(bid, cardsDealt, isLastBidder, sumSoFar)) return bid
    }
    return 0
  }

  private broadcastBidState(turnOrder: Seat[]) {
    const bids: Record<string, number> = {}
    for (const seat of turnOrder) {
      // Chaos mode may be showing a disguised number; classic returns the real
      // bids untouched.
      if (seat.bid != null) bids[seat.id] = seat.bid
    }
    const displayed = this.roles.isActive() ? this.roles.displayedBids() : bids

    this.io.broadcast('gameState', {
      phase: 'Bidding',
      currentTurnId: this.currentTurnSeat?.id ?? null,
      bids: displayed,
      cardsDealt: this.currentCardsDealt,
    })
  }

  private waitForBid(
    seat: Seat,
    cardsDealt: number,
    isLastBidder: boolean,
    sumSoFar: number,
  ): Promise<number> {
    return new Promise<number>((resolve) => {
      let settled = false
      const finish = (bid: number) => {
        if (settled) return
        settled = true
        this.resolver = null
        resolve(bid)
      }

      this.resolver = finish

      // No bid timer: a player is never skipped for taking too long to bid.
      // The only auto-bid is for a seat that has actually left, because
      // otherwise bidding would hang forever on an empty chair.
      if (!seat.connected) {
        setImmediate(() => finish(this.autoChooseBid(cardsDealt, isLastBidder, sumSoFar)))
      }
    })
  }

  /** Resolves the pending wait if the seat we're waiting on just dropped. */
  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(
        this.autoChooseBid(this.currentCardsDealt, this.currentIsLastBidder, this.currentSumSoFar),
      )
    }
    if (this.doubleWindowSeat?.id === seat.id) this.closeDoubleWindow()
  }

  private closeDoubleWindow() {
    this.doubleWindowSeat = null
    const resolve = this.doubleWindowResolve
    this.doubleWindowResolve = null
    resolve?.()
  }

  /** Blocks until every seat in turnOrder has bid. */
  async runBiddingPhase(turnOrder: Seat[], cardsDealt: number) {
    this.doublesLocked = false
    this.currentCardsDealt = cardsDealt
    let sumSoFar = 0

    for (let i = 0; i < turnOrder.length; i++) {
      const seat = turnOrder[i]
      this.currentTurnSeat = seat
      this.currentIsLastBidder = i === turnOrder.length - 1
      this.currentSumSoFar = sumSoFar
      this.broadcastBidState(turnOrder)
      const bid = await this.waitForBid(seat, cardsDealt, this.currentIsLastBidder, sumSoFar)
      seat.bid = bid
      sumSoFar += bid
      this.broadcastBidState(turnOrder)

      // Post-bid Double window: the bidder gets a few seconds to commit before
      // the next player bids. Doubling ends the wait early.
      if (seat.connected && canDouble(bid)) {
        this.doubleWindowSeat = seat
        this.io.send(seat, 'doubleWindow', { seconds: Config.doubleWindowSeconds })
        await new Promise<void>((resolve) => {
          this.doubleWindowResolve = resolve
          // Guard on the seat: an early close (they doubled, or dropped) may
          // have already opened the NEXT player's window by the time this
          // fires, and it must not shut that one too.
          setTimeout(() => {
            if (this.doubleWindowSeat?.id === seat.id) this.closeDoubleWindow()
          }, Config.doubleWindowSeconds * 1000)
        })
      }
    }

    this.currentTurnSeat = null
  }

  /** Client fired `submitBid`. */
  handleBidSubmission(seat: Seat, bid: number) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, 'actionError', "It's not your turn to bid.")
      return
    }
    if (
      typeof bid !== 'number' ||
      !this.isValidBid(bid, this.currentCardsDealt, this.currentIsLastBidder, this.currentSumSoFar)
    ) {
      this.io.send(seat, 'actionError', "That bid isn't allowed.")
      return
    }
    this.resolver?.(bid)
  }

  /**
   * Client fired `declareDouble`. Doubling is a one-way, final commitment for
   * the round: once declared it can't be taken back, so we only ever set it to
   * true and reject repeats. It's only legal inside the short post-bid window.
   */
  handleDeclareDouble(seat: Seat) {
    if (this.doublesLocked) {
      this.io.send(seat, 'actionError', 'Too late to double — play has started.')
      return
    }
    if (seat.bid == null) {
      this.io.send(seat, 'actionError', 'Place your bid before doubling.')
      return
    }
    if (seat.hasDoubled) return // already committed this round; ignore
    if (this.doubleWindowSeat?.id !== seat.id) {
      this.io.send(seat, 'actionError', 'Your chance to double has passed.')
      return
    }
    if (!canDouble(seat.bid)) {
      this.io.send(seat, 'actionError', 'Double is only allowed on a bid of 0 this game.')
      return
    }
    seat.hasDoubled = true

    // Doubling is public knowledge at a real table, but nothing else on the
    // wire carries it until scoring -- so say it out loud.
    this.systemChat(
      `🔥 ${seat.name} DOUBLES DOWN on a bid of ${seat.bid} — twice the reward, twice the fall.`,
    )

    // Committing ends the window early.
    this.closeDoubleWindow()
  }

  /** Call once bidding is complete and the play phase is starting. */
  lockDoubles() {
    this.doublesLocked = true
    this.closeDoubleWindow()
  }
}
