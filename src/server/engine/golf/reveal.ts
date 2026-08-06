// The initial reveal: everyone flips 2 of their own 6 cards face-up at once.
// Simultaneous, not turn-based -- same shape as Hearts' pass phase
// (hearts/passing.ts): one promise per seat, Promise.all, and the phase moves
// on only once every seat has chosen (or been chosen for).
//
// No turn timers here either (see CLAUDE.md): a connected player is waited on
// for as long as they need. Only a seat that has actually disconnected gets
// two slots picked for it, which is what stops the phase hanging on an empty
// chair.

import { GRID_SIZE, INITIAL_REVEAL_COUNT } from '@shared/golfRules'
import type { Seat } from '../../types'
import { randomInt } from '../../types'
import type { EngineIO } from '../io'

export class GolfRevealManager {
  /** One resolver per seat still owing its initial two flips. */
  private pending = new Map<string, () => void>()
  /** Set by cancel(): the reveal phase bails out without flipping anything. */
  private cancelled = false

  constructor(private io: EngineIO) {}

  reset() {
    this.pending.clear()
    this.cancelled = false
  }

  /**
   * The table voted to abandon the game. Releases every seat still choosing
   * so runRevealPhase returns -- before any card is flipped, so a cancelled
   * reveal leaves the grid exactly as dealt.
   */
  cancel() {
    this.cancelled = true
    for (const resolve of [...this.pending.values()]) resolve()
  }

  /** For the reconnect snapshot: is this seat still choosing? */
  isPending(seat: Seat): boolean {
    return this.pending.has(seat.id)
  }

  /** Two distinct random slots, for a seat that isn't here to choose. */
  private autoSelect(): [number, number] {
    const first = randomInt(0, GRID_SIZE - 1)
    let second = randomInt(0, GRID_SIZE - 1)
    while (second === first) second = randomInt(0, GRID_SIZE - 1)
    return [first, second]
  }

  private applyReveal(seat: Seat, slots: [number, number]) {
    seat.golfRevealed[slots[0]] = true
    seat.golfRevealed[slots[1]] = true
  }

  /** Blocks until every seat in `order` has flipped its two starting cards. */
  async runRevealPhase(order: Seat[]): Promise<void> {
    this.cancelled = false

    const waits = order.map((seat) => {
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
          this.applyReveal(seat, this.autoSelect())
          setImmediate(finish)
        }
      })
    })

    await Promise.all(waits)
    // Cancelled mid-choice: the caller checks `aborted` right after this
    // returns and won't broadcast the result -- but bailing here too keeps
    // this manager's own state consistent with every other one's cancel().
    if (this.cancelled) return
    // Broadcasting the result is Room's job -- it's the one who knows the
    // pile state (stock/discard) that belongs alongside the grids in a full
    // golfState, which this manager never touches.
  }

  /** Client fired `golfRevealInitial`. One shot: once accepted, it's final. */
  handleReveal(seat: Seat, slots: unknown) {
    const resolve = this.pending.get(seat.id)
    if (!resolve) {
      this.io.send(seat, 'actionError', 'There is nothing to reveal right now.')
      return
    }
    if (
      !Array.isArray(slots) ||
      slots.length !== INITIAL_REVEAL_COUNT ||
      !slots.every((s) => Number.isInteger(s) && s >= 0 && s < GRID_SIZE)
    ) {
      this.io.send(seat, 'actionError', `Pick exactly ${INITIAL_REVEAL_COUNT} cards to flip.`)
      return
    }
    if (slots[0] === slots[1]) {
      this.io.send(seat, 'actionError', 'Pick two different cards.')
      return
    }

    this.applyReveal(seat, [slots[0], slots[1]])
    resolve()
  }

  onSeatDisconnected(seat: Seat) {
    const resolve = this.pending.get(seat.id)
    if (!resolve) return
    this.applyReveal(seat, this.autoSelect())
    resolve()
  }
}
