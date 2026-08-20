// Spades: every rule that is pure. Imported by BOTH sides, same reason every
// other *Rules.ts is: the client has to grey out exactly the cards the server
// would reject, or a disagreement there hangs a round with no turn timers.
//
// No RNG and no state in here -- the deal itself reuses server/engine/deck.ts
// directly (13 cards each fits a plain 52-card deal with no trimming needed).

import type { Card } from './cards'
import { isSameCard } from './cards'

export type SpadesBid = number | 'nil'

/** Seats 0&2 are one team, 1&3 the other -- across the table from each other. */
export function teamOfSeatPosition(position: number): 0 | 1 {
  return (position % 2) as 0 | 1
}

// ---- Legality ---------------------------------------------------------------

export type SpadesPlayContext = {
  /** null when this play LEADS the trick. */
  leadSuit: string | null
  spadesBroken: boolean
}

/**
 * Can this card be played right now?
 *
 * - Follow the led suit whenever you hold it.
 * - Can't LEAD a spade while spades are unbroken -- unless spades are all
 *   you have left, the same "restriction lifts when it can't be obeyed"
 *   shape Hearts' own broken-suit rule uses.
 * - No restriction once you're following: any card is fine when void in the
 *   led suit, spades included -- playing one is exactly what breaks them.
 */
export function isLegalSpadesPlay(card: Card, hand: Card[], ctx: SpadesPlayContext): boolean {
  if (!hand.some((c) => isSameCard(c, card))) return false

  if (ctx.leadSuit == null) {
    if (card.suit === 'Spades' && !ctx.spadesBroken) {
      return hand.every((c) => c.suit === 'Spades')
    }
    return true
  }

  if (hand.some((c) => c.suit === ctx.leadSuit)) return card.suit === ctx.leadSuit
  return true
}

/** Every card in `hand` that `isLegalSpadesPlay` would accept. */
export function legalSpadesPlays(hand: Card[], ctx: SpadesPlayContext): Card[] {
  return hand.filter((card) => isLegalSpadesPlay(card, hand, ctx))
}

/** Playing a spade breaks them -- winning the trick with it is not required. */
export function breaksSpades(card: Card): boolean {
  return card.suit === 'Spades'
}

// ---- Scoring ------------------------------------------------------------------

/** Every 10 accumulated overtricks (bags) costs a team this many points. */
const BAG_PENALTY_THRESHOLD = 10
const BAG_PENALTY = 100

export type SpadesPlayerBid = {
  id: string
  team: 0 | 1
  bid: SpadesBid
  tricksWon: number
}

export type SpadesHandLine = {
  id: string
  bid: SpadesBid
  tricksWon: number
  nilResult: 'made' | 'failed' | null
}

export type SpadesTeamResult = {
  team: 0 | 1
  players: SpadesHandLine[]
  /** Combined numeric bid -- a nil bid contributes 0 here, it's scored separately. */
  bid: number
  tricks: number
  madeBid: boolean
  /** This hand's overtricks, 0 unless the bid was made -- a set never adds bags. */
  overtricks: number
  /** Everything this hand adds to the team's total EXCEPT the running bag penalty. */
  handScore: number
}

/**
 * One hand's result for both teams. Doesn't touch the running bag count --
 * that's sequential state across hands within a game, applied separately by
 * applyBagPenalty so this stays a pure function of just this hand's bids and
 * tricks.
 */
export function scoreSpadesHand(players: SpadesPlayerBid[]): SpadesTeamResult[] {
  return ([0, 1] as const).map((team) => {
    const teamPlayers = players.filter((p) => p.team === team)
    const bid = teamPlayers.reduce((sum, p) => sum + (p.bid === 'nil' ? 0 : p.bid), 0)
    const tricks = teamPlayers.reduce((sum, p) => sum + p.tricksWon, 0)
    const madeBid = tricks >= bid
    const overtricks = madeBid ? tricks - bid : 0
    const bidScore = madeBid ? 10 * bid + overtricks : -10 * bid
    const nilScore = teamPlayers.reduce((sum, p) => {
      if (p.bid !== 'nil') return sum
      return sum + (p.tricksWon === 0 ? 100 : -100)
    }, 0)

    const lines: SpadesHandLine[] = teamPlayers.map((p) => ({
      id: p.id,
      bid: p.bid,
      tricksWon: p.tricksWon,
      nilResult: p.bid === 'nil' ? (p.tricksWon === 0 ? 'made' : 'failed') : null,
    }))

    return { team, players: lines, bid, tricks, madeBid, overtricks, handScore: bidScore + nilScore }
  })
}

/**
 * Folds this hand's overtricks into a team's running bag count and applies
 * the standing penalty every time it crosses the threshold. A while loop, not
 * a single check, because one big hand's overtricks can cross it more than
 * once (e.g. 8 bags already + 5 more in one hand).
 */
export function applyBagPenalty(
  bagsBefore: number,
  overtricksThisHand: number,
): { scorePenalty: number; bagsAfter: number } {
  let bags = bagsBefore + overtricksThisHand
  let scorePenalty = 0
  while (bags >= BAG_PENALTY_THRESHOLD) {
    scorePenalty -= BAG_PENALTY
    bags -= BAG_PENALTY_THRESHOLD
  }
  return { scorePenalty, bagsAfter: bags }
}
