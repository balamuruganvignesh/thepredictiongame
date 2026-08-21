// Purchasable powerups, for the Prediction Game only and only on a table
// whose host has switched them on.
//
// Deliberately NOT part of RoleManager. Chaos roles are dealt by the server,
// free, and everyone gets one; powerups are bought, opt-in, and asymmetric.
// Folding them together would mean every chaos code path had to ask "is this
// a role ability or a paid one?", and the two have different fairness rules.
// The shapes are similar on purpose -- this class is injected into the round
// loop the same way RoleManager is -- but they stay separate.
//
// The only state that survives a round is `safetyNets`, which is armed during
// bidding and consumed at scoring.

import type { Card } from '@shared/cards'
import { powerupById } from '@shared/powerups'
import { shuffle, type Seat } from '../types'
import type { EngineIO } from './io'

export class PowerupManager {
  /** Seats holding an armed Safety Net for the round being scored. */
  private safetyNets = new Set<string>()

  constructor(
    private io: EngineIO,
    /** Whether the host switched powerups on for this table. */
    private enabled: boolean,
  ) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (!enabled) this.safetyNets.clear()
  }

  get isEnabled() {
    return this.enabled
  }

  /**
   * Runs a powerup. Returns whether the charge should actually be spent --
   * false means nothing happened and the caller must NOT bill the player.
   * Every rejection is reported privately; a powerup is a purchase, so
   * silently swallowing a failed one would look like theft.
   */
  use(
    seat: Seat,
    powerupId: string,
    target: Seat | null,
    // trumpSuit is a plain string here because that's what Room stores it as
    // ('' between rounds, otherwise a suit name or 'NoTrump').
    context: { seats: Seat[]; trumpSuit: string; phase: 'Bidding' | 'Playing' },
  ): boolean {
    if (!this.enabled) {
      this.deny(seat, 'Powerups are switched off at this table.')
      return false
    }

    const def = powerupById(powerupId)
    if (!def) return false

    if (def.phase !== 'any' && def.phase !== context.phase.toLowerCase()) {
      this.deny(seat, `${def.name} can only be used during ${def.phase}.`)
      return false
    }

    if (def.target === 'other') {
      if (!target || target.id === seat.id) {
        this.deny(seat, `${def.name} needs another player.`)
        return false
      }
    }

    switch (def.id) {
      case 'powerup-peek':
        return this.peek(seat, target!)
      case 'powerup-trump-sense':
        return this.trumpSense(seat, context)
      case 'powerup-safety-net':
        return this.armSafetyNet(seat)
      default:
        return false
    }
  }

  /** Three random cards from a target's hand, told only to the buyer. */
  private peek(seat: Seat, target: Seat): boolean {
    if (target.hand.length === 0) {
      this.deny(seat, `${target.name} has no cards to look at.`)
      return false
    }
    const sample = shuffle([...target.hand]).slice(0, 3)
    this.io.send(seat, 'powerupResult', {
      powerupId: 'powerup-peek',
      text: `${target.name} is holding ${describe(sample)}${
        target.hand.length > sample.length ? ' (among others)' : ''
      }.`,
    })
    return true
  }

  private trumpSense(
    seat: Seat,
    context: { seats: Seat[]; trumpSuit: string },
  ): boolean {
    const { trumpSuit } = context
    if (!trumpSuit || trumpSuit === 'NoTrump') {
      this.deny(seat, 'There is no trump this round.')
      return false
    }
    const lines = context.seats
      .filter((other) => other.id !== seat.id)
      .map((other) => `${other.name}: ${other.hand.filter((c) => c.suit === trumpSuit).length}`)
    this.io.send(seat, 'powerupResult', {
      powerupId: 'powerup-trump-sense',
      text: `Trumps held — ${lines.join(', ')}.`,
    })
    return true
  }

  private armSafetyNet(seat: Seat): boolean {
    if (this.safetyNets.has(seat.id)) {
      this.deny(seat, 'Your Safety Net is already up this round.')
      return false
    }
    this.safetyNets.add(seat.id)
    this.io.send(seat, 'powerupResult', {
      powerupId: 'powerup-safety-net',
      text: 'Safety Net is up. Miss your bid this round and you score 0 instead of losing points.',
    })
    return true
  }

  /**
   * Applied as its own pass in scoreRound, after every other adjustment, so a
   * net catches whatever the final number turned out to be rather than an
   * intermediate one. Only ever raises a negative to zero -- it can never turn
   * a loss into a gain.
   */
  applySafetyNets(scores: Map<string, number>, seats: Seat[]) {
    if (this.safetyNets.size === 0) return
    for (const seat of seats) {
      if (!this.safetyNets.has(seat.id)) continue
      const score = scores.get(seat.id) ?? 0
      if (score < 0) {
        scores.set(seat.id, 0)
        this.io.send(seat, 'powerupResult', {
          powerupId: 'powerup-safety-net',
          text: `Safety Net caught you — ${score} became 0.`,
        })
      } else {
        this.io.send(seat, 'powerupResult', {
          powerupId: 'powerup-safety-net',
          text: 'You made your bid, so the Safety Net went unused. The charge is spent either way.',
        })
      }
    }
  }

  /** Nets are per-round: an unused one does not roll over. */
  endRound() {
    this.safetyNets.clear()
  }

  resetGame() {
    this.safetyNets.clear()
  }

  private deny(seat: Seat, text: string) {
    this.io.send(seat, 'powerupDenied', { text })
  }
}

function describe(cards: Card[]): string {
  const names = cards.map((card) => `${rankName(card.rank)}${suitGlyph(card.suit)}`)
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const RANK_NAMES: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
const rankName = (rank: number) => RANK_NAMES[rank] ?? String(rank)

const SUIT_GLYPHS: Record<string, string> = {
  Spades: '♠',
  Hearts: '♥',
  Diamonds: '♦',
  Clubs: '♣',
  Joker: '🃏',
}
const suitGlyph = (suit: string) => SUIT_GLYPHS[suit] ?? suit
