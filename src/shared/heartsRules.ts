// Hearts: every rule that is pure. Imported by BOTH sides, because the client
// has to grey out exactly the cards the server would reject -- a disagreement
// there means a rejected play, and with no turn timers the round hangs on it.
//
// No RNG and no state in here; the deal itself lives in
// server/engine/hearts/deck.ts.

import type { Card, Suit } from './cards'
import { isSameCard } from './cards'

export type PassDirection = 'left' | 'right' | 'across' | 'none'

/** Q of Spades, the 13-pointer. */
export const QUEEN_OF_SPADES: Card = { suit: 'Spades', rank: 12 }

/** All 26 penalty points: 13 hearts + the queen. */
export const TOTAL_PENALTY = 26

export function isQueenOfSpades(card: Card): boolean {
  return card.suit === 'Spades' && card.rank === 12
}

/** 1 for a heart, 13 for the queen, 0 for everything else. */
export function penaltyOf(card: Card): number {
  if (card.suit === 'Hearts') return 1
  if (isQueenOfSpades(card)) return 13
  return 0
}

/** A card that carries no penalty -- the only kind an uneven deal may drop. */
export function isScoringCard(card: Card): boolean {
  return penaltyOf(card) > 0
}

// ---- The deck ---------------------------------------------------------------

// Which suit gives up a card first when ranks tie. Clubs last, so the 2 of
// Clubs -- the card that opens the game -- survives as long as possible.
const TRIM_SUIT_ORDER: Record<string, number> = { Diamonds: 1, Spades: 2, Clubs: 3 }

const SUITS: Suit[] = ['Spades', 'Diamonds', 'Clubs', 'Hearts']

/**
 * The deck this many players get: a full 52 with the lowest NON-SCORING cards
 * removed until it deals evenly. Every heart and the queen always survive, so
 * all 26 penalty points are in play at every table size.
 */
export function trimmedDeck(playerCount: number): { deck: Card[]; cardsEach: number } {
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) deck.push({ suit, rank })
  }

  const excess = deck.length % playerCount
  if (excess > 0) {
    const droppable = deck
      .filter((card) => !isScoringCard(card))
      .sort((a, b) => a.rank - b.rank || TRIM_SUIT_ORDER[a.suit] - TRIM_SUIT_ORDER[b.suit])
      .slice(0, excess)
    for (const card of droppable) {
      deck.splice(
        deck.findIndex((c) => isSameCard(c, card)),
        1,
      )
    }
  }

  return { deck, cardsEach: deck.length / playerCount }
}

/**
 * The card that must lead trick 1: the 2 of Clubs, or the lowest club still in
 * the deck when the trim took it.
 */
export function openingCard(deck: Card[]): Card {
  const clubs = deck.filter((card) => card.suit === 'Clubs')
  return clubs.reduce((lowest, card) => (card.rank < lowest.rank ? card : lowest), clubs[0])
}

// ---- Legality ---------------------------------------------------------------

export type PlayContext = {
  /** null when this play LEADS the trick. */
  leadSuit: string | null
  heartsBroken: boolean
  isFirstTrick: boolean
  /** Set only for the very first play of the round: it must be this exact card. */
  mustLeadCard?: Card | null
}

/**
 * Can this card be played right now?
 *
 * - Follow the led suit whenever you hold it.
 * - Can't lead a heart while hearts are unbroken -- unless hearts are all you
 *   have left, or there'd be no legal lead at all.
 * - Trick 1 takes no penalty cards: no hearts, no queen, unless your hand is
 *   nothing but penalty cards.
 * - The opening lead is forced to the 2 of Clubs (or the lowest club dealt).
 */
export function isLegalHeartsPlay(card: Card, hand: Card[], ctx: PlayContext): boolean {
  if (!hand.some((c) => isSameCard(c, card))) return false

  if (ctx.leadSuit == null) {
    if (ctx.mustLeadCard) return isSameCard(card, ctx.mustLeadCard)
    if (card.suit === 'Hearts' && !ctx.heartsBroken) {
      // Hearts and nothing else: the restriction can't be obeyed, so it lifts.
      return hand.every((c) => c.suit === 'Hearts')
    }
    return true
  }

  if (hand.some((c) => c.suit === ctx.leadSuit)) return card.suit === ctx.leadSuit

  // Void in the led suit: anything goes, except dumping penalty cards on the
  // opening trick when you have a harmless card to give instead.
  if (ctx.isFirstTrick && penaltyOf(card) > 0) {
    return hand.every((c) => penaltyOf(c) > 0)
  }
  return true
}

/** Every card in `hand` that `isLegalHeartsPlay` would accept. */
export function legalHeartsPlays(hand: Card[], ctx: PlayContext): Card[] {
  return hand.filter((card) => isLegalHeartsPlay(card, hand, ctx))
}

/** Playing a heart breaks hearts -- winning the trick with it is not required. */
export function breaksHearts(card: Card): boolean {
  return card.suit === 'Hearts'
}

// ---- Scoring ----------------------------------------------------------------

export type HeartsRoundLine = {
  id: string
  hearts: number
  hadQueen: boolean
  shotMoon: boolean
  /** What this round adds to their total. */
  roundScore: number
}

/**
 * Round scores from what each player collected. A player holding all 26 points
 * SHOT THE MOON: they take 0 and everyone else takes 26.
 */
export function scoreHeartsRound(
  collected: { id: string; cards: Card[] }[],
): HeartsRoundLine[] {
  const raw = collected.map((entry) => {
    const hearts = entry.cards.filter((card) => card.suit === 'Hearts').length
    const hadQueen = entry.cards.some(isQueenOfSpades)
    return { id: entry.id, hearts, hadQueen, points: hearts + (hadQueen ? 13 : 0) }
  })

  const shooter = raw.find((line) => line.points === TOTAL_PENALTY)

  return raw.map((line) => ({
    id: line.id,
    hearts: line.hearts,
    hadQueen: line.hadQueen,
    shotMoon: shooter != null && shooter.id === line.id,
    roundScore: shooter ? (shooter.id === line.id ? 0 : TOTAL_PENALTY) : line.points,
  }))
}

// ---- Passing ----------------------------------------------------------------

/** How many cards change hands, when they change hands at all. */
export const PASS_COUNT = 3

/**
 * left -> right -> across -> no pass, repeating. With three players "across" is
 * the same seat as left or right, so that round becomes a no-pass round.
 */
export function passDirection(roundNumber: number, playerCount: number): PassDirection {
  const cycle: PassDirection[] = ['left', 'right', 'across', 'none']
  const direction = cycle[(roundNumber - 1) % cycle.length]
  if (direction === 'across' && playerCount < 4) return 'none'
  return direction
}

/**
 * Seat index that receives `seatIndex`'s three cards, or null on a no-pass
 * round. Indices are into the canonical seat order.
 */
export function passTargetIndex(
  seatIndex: number,
  playerCount: number,
  roundNumber: number,
): number | null {
  const direction = passDirection(roundNumber, playerCount)
  const offset =
    direction === 'left'
      ? 1
      : direction === 'right'
        ? playerCount - 1
        : direction === 'across'
          ? Math.floor(playerCount / 2)
          : null
  if (offset == null) return null
  return (seatIndex + offset) % playerCount
}

export function passDirectionLabel(direction: PassDirection): string {
  switch (direction) {
    case 'left':
      return 'PASS LEFT'
    case 'right':
      return 'PASS RIGHT'
    case 'across':
      return 'PASS ACROSS'
    default:
      return 'NO PASS'
  }
}
