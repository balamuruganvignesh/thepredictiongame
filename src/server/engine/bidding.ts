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
  /**
   * The seats bidding this round, kept so the running total can be recomputed
   * LIVE rather than accumulated. It has to be live: a Time Traveler's Reverse
   * Time can rewrite an already-placed bid while people are still bidding, and
   * a carried-forward running total would then forbid the wrong number for the
   * last bidder -- the exact desync that hangs a round with no turn timers.
   */
  private currentTurnOrder: Seat[] = []
  private resolver: ((bid: number) => void) | null = null
  private doublesLocked = false
  /** Seat whose post-bid Double window is currently open (null otherwise). */
  private doubleWindowSeat: Seat | null = null
  private doubleWindowResolve: (() => void) | null = null

  constructor(
    private io: EngineIO,
    private roles: RoleManager,
  ) {}

  /** The true total of every bid placed by someone OTHER than this seat. */
  private sumExcluding(seat: Seat): number {
    return this.currentTurnOrder.reduce(
      (sum, other) => (other.id === seat.id ? sum : sum + (other.bid ?? 0)),
      0,
    )
  }

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
    // The TRUE running total, which the client needs to work out the last
    // bidder's forbidden bid. It must NOT be derived from the displayed bids:
    // a disguise would forbid the wrong number and the server would then
    // reject the bid the UI told the player was fine.
    let bidSum = 0
    for (const seat of turnOrder) {
      if (seat.bid != null) {
        bids[seat.id] = seat.bid
        bidSum += seat.bid
      }
    }

    // Classic: one honest map for the whole table. Chaos: a Judge's Imposter
    // may be disguising bids, and each player must still see their OWN bid
    // undisguised -- so this goes out per seat rather than as a broadcast.
    if (!this.roles.isActive()) {
      this.io.broadcast('gameState', {
        phase: 'Bidding',
        currentTurnId: this.currentTurnSeat?.id ?? null,
        bids,
        cardsDealt: this.currentCardsDealt,
        bidSum,
      })
      return
    }

    for (const seat of turnOrder) {
      this.io.send(seat, 'gameState', {
        phase: 'Bidding',
        currentTurnId: this.currentTurnSeat?.id ?? null,
        bids: this.roles.displayedBidsFor(seat),
        cardsDealt: this.currentCardsDealt,
        bidSum,
      })
    }
    // Watchers are outsiders: they see every disguise, including its owner's.
    this.io.sendSpectators('gameState', {
      phase: 'Bidding',
      currentTurnId: this.currentTurnSeat?.id ?? null,
      bids: this.roles.displayedBids(),
      cardsDealt: this.currentCardsDealt,
      bidSum,
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
        this.autoChooseBid(this.currentCardsDealt, this.currentIsLastBidder, this.sumExcluding(seat)),
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
    this.currentTurnOrder = turnOrder

    for (let i = 0; i < turnOrder.length; i++) {
      const seat = turnOrder[i]
      this.currentTurnSeat = seat
      this.currentIsLastBidder = i === turnOrder.length - 1
      this.broadcastBidState(turnOrder)
      const bid = await this.waitForBid(seat, cardsDealt, this.currentIsLastBidder, this.sumExcluding(seat))
      seat.bid = bid
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
      // Recomputed here, not cached: an ability may have rewritten someone
      // else's bid since this player's turn opened.
      !this.isValidBid(bid, this.currentCardsDealt, this.currentIsLastBidder, this.sumExcluding(seat))
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

    // Deliberately SILENT -- no chat line, no feed card. The old announcement
    // printed the real bid, which both spammed the table with numbers and
    // handed away a Judge's Imposter disguise for free. Doubling now surfaces
    // at scoring, where the doubled score speaks for itself.

    // Committing ends the window early.
    this.closeDoubleWindow()
  }

  /** Call once bidding is complete and the play phase is starting. */
  lockDoubles() {
    this.doublesLocked = true
    this.closeDoubleWindow()
  }
}
