// Pure helpers for working with Card values. No RNG, no state -- safe to
// import from both server and client.

export type Suit = 'Spades' | 'Diamonds' | 'Clubs' | 'Hearts' | 'Joker'

export type Card = {
  suit: Suit
  /** 2-14 (11=J, 12=Q, 13=K, 14=A), 15 reserved for Joker */
  rank: number
}

const RANK_NAMES: Record<number, string> = {
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: 'Jk',
}

export const SUIT_SYMBOLS: Record<string, string> = {
  Spades: '♠',
  Diamonds: '♦',
  Clubs: '♣',
  Hearts: '♥',
  Joker: '★',
}

const RED_SUITS: Record<string, boolean> = { Diamonds: true, Hearts: true }

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? String(rank)
}

export function suitSymbol(suit: string): string {
  return SUIT_SYMBOLS[suit] ?? '?'
}

export function isRed(suit: string): boolean {
  return RED_SUITS[suit] === true
}

/** e.g. "A♠", "10♥", "Jk" */
export function displayName(card: Card): string {
  if (card.suit === 'Joker') return 'Jk'
  return rankName(card.rank) + suitSymbol(card.suit)
}

export function isSameCard(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank
}

/** Stable key for React lists and lookups. */
export function cardKey(card: Card): string {
  return `${card.suit}-${card.rank}`
}

const SUIT_SORT_ORDER: Record<string, number> = {
  Spades: 1,
  Diamonds: 2,
  Clubs: 3,
  Hearts: 4,
  Joker: 5,
}

/** Sort a hand in place: by suit (fixed order, jokers last), then rank desc. */
export function sortHand(hand: Card[]): void {
  hand.sort((a, b) => {
    const orderA = SUIT_SORT_ORDER[a.suit] ?? 99
    const orderB = SUIT_SORT_ORDER[b.suit] ?? 99
    if (orderA !== orderB) return orderA - orderB
    return b.rank - a.rank
  })
}

/**
 * Index of the play that wins a trick.
 * `plays` is the ordered list of cards played this trick.
 * Joker (rank 15) always counts as trump and outranks every other trump.
 */
export function resolveTrickWinnerIndex(
  plays: { card: Card }[],
  leadSuit: string,
  trumpSuit: string,
): number {
  const isTrump = (card: Card) =>
    trumpSuit !== 'NoTrump' && (card.suit === trumpSuit || card.suit === 'Joker')

  const beats = (candidate: Card, current: Card): boolean => {
    const candidateIsTrump = isTrump(candidate)
    const currentIsTrump = isTrump(current)

    if (candidateIsTrump && !currentIsTrump) return true
    if (currentIsTrump && !candidateIsTrump) return false
    if (candidateIsTrump && currentIsTrump) return candidate.rank > current.rank

    // Neither is trump: only the led suit can win.
    if (candidate.suit === leadSuit && current.suit === leadSuit) {
      return candidate.rank > current.rank
    }
    return candidate.suit === leadSuit && current.suit !== leadSuit
  }

  let bestIndex = 0
  let bestCard = plays[0].card
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i].card, bestCard)) {
      bestCard = plays[i].card
      bestIndex = i
    }
  }
  return bestIndex
}

/**
 * Can `card` legally be played given the player's hand and the led suit?
 * Must follow suit if able; otherwise anything (trump or discard) is legal.
 * Jokers are always legal to play.
 */
export function isLegalPlay(card: Card, hand: Card[], leadSuit: string | null): boolean {
  if (leadSuit == null) return true // leading the trick: any card is legal
  if (card.suit === leadSuit || card.suit === 'Joker') return true
  // Had the led suit but didn't play it?
  return !hand.some((c) => c.suit === leadSuit)
}
