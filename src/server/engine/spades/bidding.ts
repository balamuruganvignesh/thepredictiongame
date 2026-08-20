// Runs the bidding phase for one Spades hand: goes around the table once,
// collecting a bid (0-13, or Nil) from each seat in turn. Much simpler than
// the Prediction Game's BiddingManager on purpose -- no chaos roles, no
// Double, no forbidden-sum rule. Any player may bid any legal value
// regardless of what others have bid.

import type { SpadesBid } from '@shared/spadesRules'
import type { Seat } from '../../types'
import type { EngineIO } from '../io'

/** Count obvious winners (top spades, other aces) as a simple, honest guess. Never bids Nil -- that's a deliberate human choice. */
function autoChooseBid(hand: { suit: string; rank: number }[]): number {
  const strongSpades = hand.filter((c) => c.suit === 'Spades' && c.rank >= 12).length
  const otherAces = hand.filter((c) => c.suit !== 'Spades' && c.rank === 14).length
  return Math.min(13, strongSpades + otherAces)
}

export class SpadesBiddingManager {
  private currentTurnSeat: Seat | null = null
  private resolver: ((bid: SpadesBid) => void) | null = null
  private cancelled = false
  private seats: Seat[] = []
  /** Set once per hand by runBiddingPhase -- only echoed in the state broadcast, never mutated here. */
  private bags: [number, number] = [0, 0]

  constructor(private io: EngineIO) {}

  reset() {
    this.currentTurnSeat = null
    this.resolver = null
    this.cancelled = false
    this.seats = []
    this.bags = [0, 0]
  }

  currentTurnId(): string | null {
    return this.currentTurnSeat?.id ?? null
  }

  private bids(): Partial<Record<string, SpadesBid>> {
    const out: Partial<Record<string, SpadesBid>> = {}
    for (const seat of this.seats) if (seat.spadesBid != null) out[seat.id] = seat.spadesBid
    return out
  }

  private isValidBid(bid: unknown): bid is SpadesBid {
    if (bid === 'nil') return true
    return typeof bid === 'number' && Number.isInteger(bid) && bid >= 0 && bid <= 13
  }

  private waitForBid(seat: Seat): Promise<SpadesBid> {
    return new Promise<SpadesBid>((resolve) => {
      let settled = false
      const finish = (bid: SpadesBid) => {
        if (settled) return
        settled = true
        this.resolver = null
        resolve(bid)
      }
      this.resolver = finish

      // No bid timer, ever -- only a seat that has actually left bids itself.
      if (!seat.connected) setImmediate(() => finish(autoChooseBid(seat.hand)))
    })
  }

  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(autoChooseBid(seat.hand))
    }
  }

  /** The table voted to abandon the game. Unblocks whoever we're waiting on. */
  cancel() {
    this.cancelled = true
    const seat = this.currentTurnSeat
    if (seat && this.resolver) this.resolver(autoChooseBid(seat.hand))
  }

  /**
   * Blocks until every seat in turnOrder has bid. Mutates seat.spadesBid.
   * `bags` is each team's running count coming INTO this hand -- purely for
   * display, so bidders can see how close their team is to the next penalty.
   */
  async runBiddingPhase(turnOrder: Seat[], bags: [number, number]) {
    this.cancelled = false
    this.seats = turnOrder
    this.bags = bags
    for (const seat of turnOrder) seat.spadesBid = null

    for (const seat of turnOrder) {
      if (this.cancelled) break
      this.currentTurnSeat = seat
      this.broadcastState()
      const bid = await this.waitForBid(seat)
      if (this.cancelled) break
      seat.spadesBid = bid
      this.broadcastState()
    }
    this.currentTurnSeat = null
  }

  broadcastState() {
    this.io.broadcast('spadesState', {
      phase: 'bidding',
      biddingTurnId: this.currentTurnId(),
      bids: this.bids(),
      spadesBroken: false,
      bags: this.bags,
    })
  }

  /** Client fired `submitSpadesBid`. */
  handleBidSubmission(seat: Seat, bid: unknown) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, 'actionError', "It's not your turn to bid.")
      return
    }
    if (!this.isValidBid(bid)) {
      this.io.send(seat, 'actionError', 'Bid 0-13, or Nil.')
      return
    }
    this.resolver?.(bid)
  }
}
