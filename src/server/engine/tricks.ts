// Runs the play phase for one round: leads/follows tricks in turn order,
// enforces follow-suit, resolves each trick's winner, and hands the lead to
// that winner for the next trick. All validation is server-side.

import { Config } from '@shared/config'
import type { Card } from '@shared/cards'
import { isLegalPlay, isSameCard, resolveTrickWinnerIndex } from '@shared/cards'
import type { PlayEntry } from '@shared/protocol'
import type { Seat } from '../types'
import { sleep } from '../types'
import type { EngineIO } from './io'
import type { RoleManager } from './roles'

export class TrickManager {
  private currentTurnSeat: Seat | null = null
  private currentLeadSuit: string | null = null
  private resolver: ((card: Card) => void) | null = null

  // Mirrored for the reconnect snapshot: what's on the table right now.
  private livePlays: PlayEntry[] = []
  private liveTrickNumber = 0

  constructor(
    private io: EngineIO,
    private roles: RoleManager,
  ) {}

  snapshot() {
    return {
      currentTurnId: this.currentTurnSeat?.id ?? null,
      leadSuit: this.currentLeadSuit,
      plays: this.livePlays,
      trickNumber: this.liveTrickNumber,
    }
  }

  reset() {
    this.currentTurnSeat = null
    this.currentLeadSuit = null
    this.livePlays = []
    this.liveTrickNumber = 0
  }

  private rotateToStart(seatOrder: Seat[], startSeat: Seat): Seat[] {
    const startIndex = Math.max(
      0,
      seatOrder.findIndex((s) => s.id === startSeat.id),
    )
    return seatOrder.map((_, i) => seatOrder[(startIndex + i) % seatOrder.length])
  }

  /**
   * Removes the played card from the seat's hand AND pushes the updated hand to
   * that client. Without the re-send the client keeps rendering its original
   * dealt hand, so played cards appear to stay in it all round.
   */
  private removeCardFromHand(seat: Seat, card: Card) {
    const index = seat.hand.findIndex((c) => isSameCard(c, card))
    if (index >= 0) seat.hand.splice(index, 1)
    this.io.send(seat, 'dealHand', { hand: seat.hand })
  }

  private findAutoPlayCard(hand: Card[], leadSuit: string | null): Card {
    return hand.find((card) => isLegalPlay(card, hand, leadSuit)) ?? hand[0]
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

      // No turn timer: a player's turn is never skipped for taking too long.
      // The only auto-play is for a seat that has actually left, because
      // otherwise the round would hang forever on an empty chair.
      if (!seat.connected) {
        setImmediate(() => finish(this.findAutoPlayCard(seat.hand, leadSuit)))
      }
    })
  }

  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(this.findAutoPlayCard(seat.hand, this.currentLeadSuit))
    }
  }

  /**
   * Blocks until `cardsDealt` tricks have been played out. `seatOrder` is the
   * full table in fixed seat order; `leaderSeat` is whoever leads trick 1 (the
   * player left of the dealer). Mutates seat.hand / seat.tricksWon.
   */
  async runPlayPhase(
    seatOrder: Seat[],
    leaderSeat: Seat,
    cardsDealt: number,
    trumpSuit: string,
  ) {
    // Chaos mode's Peeker can claim the lead (Set the Pace), including for the
    // opening trick if they used it during bidding. No-op in classic.
    let leader = this.roles.overrideNextLeader(leaderSeat)

    for (let trickNumber = 1; trickNumber <= cardsDealt; trickNumber++) {
      const order = this.rotateToStart(seatOrder, leader)
      const plays: { seat: Seat; card: Card }[] = []
      let leadSuit: string | null = null
      this.roles.noteTrickProgress(0)
      for (const seat of order) {
        this.currentTurnSeat = seat
        this.currentLeadSuit = leadSuit
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsDealt)

        const card = await this.waitForCardPlay(seat, leadSuit)
        this.removeCardFromHand(seat, card)
        plays.push({ seat, card })
        this.roles.noteTrickProgress(plays.length)
        if (leadSuit == null) leadSuit = card.suit
        // Clear the turn before echoing the play: otherwise this broadcast
        // still names the player who just went, their hand stays live, and a
        // second click earns them a rejection toast.
        this.currentTurnSeat = null
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsDealt)
      }

      this.currentTurnSeat = null
      const winnerIndex = resolveTrickWinnerIndex(plays, leadSuit as string, trumpSuit)
      const winner = plays[winnerIndex].seat

      // Chaos mode's Gravekeeper can void a win; classic always counts.
      const counted = this.roles.consumeTrickWin(winner, trickNumber)
      if (counted) winner.tricksWon += 1

      this.io.broadcast('trickResolved', {
        plays: plays.map((p) => ({ id: p.seat.id, card: p.card })),
        winnerId: winner.id,
        trickNumber,
        totalTricks: cardsDealt,
        counted,
      })

      // The winner leads next, unless a Peeker seized it (Set the Pace).
      // Skipped after the final trick: there's no next lead to take, and
      // resolving it there would announce a seizure that never happens.
      leader =
        trickNumber < cardsDealt ? this.roles.overrideNextLeader(winner) : winner
      await sleep(Config.trickResolvePause) // let players see how the trick resolved
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
    if (!isLegalPlay(card, seat.hand, this.currentLeadSuit)) {
      this.io.send(seat, 'actionError', 'You must follow suit if you can.')
      return
    }

    this.resolver?.(card)
  }
}
