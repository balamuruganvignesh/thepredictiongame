// Runs the play phase for one round: leads/follows tricks in turn order,
// enforces follow-suit, resolves each trick's winner, and hands the lead to
// that winner for the next trick. All validation is server-side.

import { Config } from '@shared/config'
import type { Card } from '@shared/cards'
import { cardKey, isLegalPlay, isSameCard, resolveTrickWinnerIndex } from '@shared/cards'
import type { PlayEntry } from '@shared/protocol'
import type { Seat } from '../types'
import { sleep } from '../types'
import type { EngineIO, TrickHost } from './io'
import type { RoleManager } from './roles'

/**
 * What waitForCardPlay resolves with when the wait was ABORTED rather than
 * answered -- a Time Traveler's Rewind pulling the previous play back off the
 * table. The play loop steps backwards instead of recording a card.
 */
const REWIND = Symbol('rewind')

export class TrickManager implements TrickHost {
  private currentTurnSeat: Seat | null = null
  private currentLeadSuit: string | null = null
  private resolver: ((card: Card | typeof REWIND) => void) | null = null

  /**
   * The current trick, live. An instance field rather than a local in
   * runPlayPhase because Rewind reaches in from outside the loop to pop it.
   */
  private trickPlays: { seat: Seat; card: Card }[] = []
  /**
   * Set by a Rewind: this seat may not replay this exact card. Cleared the
   * moment they play something (anything else is fair game, including a card
   * that leaves them worse off).
   */
  private replayBan: { seatId: string; card: Card } | null = null

  // Mirrored for the reconnect snapshot: what's on the table right now.
  private livePlays: PlayEntry[] = []
  private liveTrickNumber = 0

  constructor(
    private io: EngineIO,
    private roles: RoleManager,
    /**
     * Seconds between one card landing and the next player's turn opening.
     * Injected rather than read straight off Config so the in-process tests can
     * drive the loop at zero -- they assert the state machine, not the pacing.
     */
    private playPause: number = Config.playPause,
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
    this.trickPlays = []
    this.replayBan = null
    this.inPlayPause = false
    this.endPause = null
    this.heldRewind = false
  }

  // ---- TrickHost: the Time Traveler's Rewind --------------------------------

  currentTrickNumber(): number {
    return this.liveTrickNumber
  }

  /**
   * True while the loop is sitting in the between-cards pause. The card that
   * just landed is still the most recent play and the trick has NOT resolved,
   * so a Rewind aimed at this moment is perfectly valid -- it just has to be
   * held until the loop comes back. Between TRICKS this is false, and a rewind
   * is refused there for real: that trick has already been scored.
   */
  private inPlayPause = false
  /** Ends the pause early, so a held Rewind lands immediately. */
  private endPause: (() => void) | null = null
  /** A Rewind that arrived during the pause, waiting for the loop. */
  private heldRewind = false

  lastPlayer(): Seat | null {
    // While a play is pending, or during the pause right after one landed.
    // Between tricks both are false and the cards on the table have already
    // been scored into a winner.
    if ((!this.resolver && !this.inPlayPause) || this.trickPlays.length === 0) return null
    return this.trickPlays[this.trickPlays.length - 1].seat
  }

  /**
   * Only ever the MOST RECENT play, and that restriction is load-bearing:
   * undoing an earlier card could change the lead suit under players who have
   * already followed it, retroactively making their legal plays illegal.
   */
  canRewind(): { ok: boolean; error?: string } {
    const last = this.trickPlays[this.trickPlays.length - 1]
    if ((!this.resolver && !this.inPlayPause) || !last) {
      return { ok: false, error: 'There is no card on the table to pull back right now.' }
    }

    // The lead suit as it applied to THEM: if theirs was the opening card there
    // was nothing to follow, so every card in the restored hand is legal.
    const restored = [...last.seat.hand, last.card]
    const leadForThem = this.trickPlays.length === 1 ? null : this.currentLeadSuit
    const alternatives = restored.filter(
      (card) => !isSameCard(card, last.card) && isLegalPlay(card, restored, leadForThem),
    )
    if (alternatives.length === 0) {
      return { ok: false, error: 'That card was their only legal play — there is nothing else.' }
    }
    return { ok: true }
  }

  /**
   * Aborts the pending wait; runPlayPhase owns the loop index, so it unwinds.
   *
   * Fired during the between-cards pause there is no wait to abort yet, so the
   * rewind is HELD rather than refused: the pause is cut short and the next
   * turn opens straight into the unwind. The alternative -- rejecting it -- made
   * the pause a window where a perfectly good Rewind bounced.
   */
  rewindLastPlay(): void {
    if (this.resolver) {
      this.resolver(REWIND)
      return
    }
    if (this.inPlayPause) {
      this.heldRewind = true
      this.endPause?.()
    }
  }

  /** The beat after a card lands, cut short if a Rewind arrives during it. */
  private async waitOutPlayPause(): Promise<void> {
    if (this.playPause <= 0) return
    this.inPlayPause = true
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.endPause = null
        resolve()
      }, this.playPause * 1000)
      this.endPause = () => {
        clearTimeout(timer)
        this.endPause = null
        resolve()
      }
    })
    this.inPlayPause = false
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
    // barred: null clears any Rewind bar -- they've played, so it's spent.
    this.io.send(seat, 'dealHand', { hand: seat.hand, barred: null })
  }

  /**
   * `banned` is a card a Rewind forbids this seat from replaying -- an empty
   * chair still has to obey the rewind, or the loop would step back onto the
   * same card forever.
   */
  private findAutoPlayCard(hand: Card[], leadSuit: string | null, banned: Card | null): Card {
    // Legality is judged against the WHOLE hand -- filtering first would hide a
    // card of the lead suit and make a discard look legal.
    const legal = hand.filter((card) => isLegalPlay(card, hand, leadSuit))
    const pool = legal.length > 0 ? legal : hand
    const allowed = banned ? pool.filter((card) => !isSameCard(card, banned)) : pool
    return (allowed.length > 0 ? allowed : pool)[0]
  }

  /** The card this seat is currently barred from replaying, if any. */
  private bannedFor(seat: Seat): Card | null {
    return this.replayBan?.seatId === seat.id ? this.replayBan.card : null
  }

  /** The same bar as a cardKey, for the reconnect snapshot. */
  barredFor(seat: Seat): string | null {
    const banned = this.bannedFor(seat)
    return banned ? cardKey(banned) : null
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

  private waitForCardPlay(seat: Seat, leadSuit: string | null): Promise<Card | typeof REWIND> {
    return new Promise<Card | typeof REWIND>((resolve) => {
      let settled = false
      const finish = (card: Card | typeof REWIND) => {
        if (settled) return
        settled = true
        this.resolver = null
        resolve(card)
      }
      this.resolver = finish

      // A Rewind that arrived during the pause was held, not refused. Spend it
      // now, before this seat is asked for anything: the loop's REWIND branch
      // hands the turn back to whoever played last.
      if (this.heldRewind) {
        this.heldRewind = false
        setImmediate(() => finish(REWIND))
        return
      }

      // No turn timer: a player's turn is never skipped for taking too long.
      // The only auto-play is for a seat that has actually left, because
      // otherwise the round would hang forever on an empty chair.
      if (!seat.connected) {
        setImmediate(() => finish(this.findAutoPlayCard(seat.hand, leadSuit, this.bannedFor(seat))))
      }
    })
  }

  onSeatDisconnected(seat: Seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(
        this.findAutoPlayCard(seat.hand, this.currentLeadSuit, this.bannedFor(seat)),
      )
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
    // Chaos mode's Detective can point the lead at anyone (Set the Pace),
    // including for the opening trick if they used it during bidding. No-op in
    // classic.
    let leader = this.roles.overrideNextLeader(leaderSeat)

    for (let trickNumber = 1; trickNumber <= cardsDealt; trickNumber++) {
      const order = this.rotateToStart(seatOrder, leader)
      const plays: { seat: Seat; card: Card }[] = []
      this.trickPlays = plays
      this.replayBan = null
      let leadSuit: string | null = null
      this.roles.noteTrickProgress(0)
      // Indexed rather than for-of because a Rewind steps the index BACKWARDS.
      for (let i = 0; i < order.length; i++) {
        const seat = order[i]
        this.currentTurnSeat = seat
        this.currentLeadSuit = leadSuit
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsDealt)

        const card = await this.waitForCardPlay(seat, leadSuit)

        // A Time Traveler pulled the previous play back off the table. Undo it
        // and hand the turn back to whoever played it -- always the seat at
        // i - 1, which is why Rewind can only ever reach the most recent card.
        if (card === REWIND) {
          const undone = plays.pop()
          if (undone) {
            // Pushed back WITHOUT re-sorting: a Detective's Illusion scrambles
            // hand order so a blacked-out card can't be placed by where it
            // sits, and sorting this seat's hand here would hand that back.
            undone.seat.hand.push(undone.card)
            // The same message that hands the card back marks it unplayable,
            // so the UI greys it instead of letting them click it and collect
            // a rejection toast.
            this.io.send(undone.seat, 'dealHand', {
              hand: undone.seat.hand,
              barred: cardKey(undone.card),
            })
            this.replayBan = { seatId: undone.seat.id, card: undone.card }
            // Their card WAS the lead: the trick reopens with no suit set.
            if (plays.length === 0) leadSuit = null
            this.roles.noteTrickProgress(plays.length)
            i -= 2 // the loop's ++ lands back on the seat that must replay
          }
          continue
        }

        this.replayBan = null
        this.removeCardFromHand(seat, card)
        plays.push({ seat, card })
        this.roles.noteTrickProgress(plays.length)
        if (leadSuit == null) leadSuit = card.suit
        // Clear the turn before echoing the play: otherwise this broadcast
        // still names the player who just went, their hand stays live, and a
        // second click earns them a rejection toast.
        this.currentTurnSeat = null
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsDealt)

        // A beat before the next player's turn opens, so the card that was just
        // played can be seen. The turn is already cleared above, so during the
        // pause nobody is on the clock and no hand is live -- and the last card
        // of a trick doesn't need it, trickResolvePause covers that moment.
        // A Rewind arriving mid-pause ends it early and is applied on the way
        // out, rather than bouncing off a window it had no way to see.
        if (plays.length < order.length) await this.waitOutPlayPause()
      }

      this.currentTurnSeat = null
      this.replayBan = null
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

      // The winner leads next, unless a Detective redirected it (Set the Pace).
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
    const banned = this.bannedFor(seat)
    if (banned && isSameCard(card, banned)) {
      this.io.send(seat, 'actionError', 'That play was rewound — you must play something else.')
      return
    }

    this.resolver?.(card)
  }
}
