// Draws a single playing card that looks like the real thing, with no image
// assets: a white rounded face, rank+suit indices in the top-left and (rotated)
// bottom-right corners, and a traditional pip layout in the middle -- proper
// 2-10 arrangements, a single big pip for the Ace, and a framed court panel for
// J/Q/K.

import type { Card } from '@shared/cards'
import { isRed, rankName, suitSymbol } from '@shared/cards'

/**
 * Standard pip positions per rank: [col, y, flip] where col ∈ {-1, 0, 1} maps
 * to x, y runs 0..1 down the face, and flip draws the pip rotated 180° (the
 * traditional "upside-down" lower pips).
 */
const PIP_LAYOUTS: Record<number, [number, number, 0 | 1][]> = {
  2: [
    [0, 0.16, 0],
    [0, 0.84, 1],
  ],
  3: [
    [0, 0.16, 0],
    [0, 0.5, 0],
    [0, 0.84, 1],
  ],
  4: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
  5: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [0, 0.5, 0],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
  6: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [-1, 0.5, 0],
    [1, 0.5, 0],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
  7: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [0, 0.31, 0],
    [-1, 0.5, 0],
    [1, 0.5, 0],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
  8: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [0, 0.31, 0],
    [-1, 0.5, 0],
    [1, 0.5, 0],
    [0, 0.69, 1],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
  9: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [-1, 0.38, 0],
    [1, 0.38, 0],
    [0, 0.5, 0],
    [-1, 0.62, 1],
    [1, 0.62, 1],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
  10: [
    [-1, 0.16, 0],
    [1, 0.16, 0],
    [0, 0.28, 0],
    [-1, 0.38, 0],
    [1, 0.38, 0],
    [-1, 0.62, 1],
    [1, 0.62, 1],
    [0, 0.72, 1],
    [-1, 0.84, 1],
    [1, 0.84, 1],
  ],
}

function CornerIndex({ card, corner }: { card: Card; corner: 'tl' | 'br' }) {
  return (
    <span className={`card__index card__index--${corner}`} aria-hidden="true">
      <span className="card__rank">{rankName(card.rank)}</span>
      <span className="card__suit">{suitSymbol(card.suit)}</span>
    </span>
  )
}

function CardArt({ card }: { card: Card }) {
  const symbol = suitSymbol(card.suit)

  if (card.suit === 'Joker') {
    return <span className="card__joker-star">★</span>
  }

  if (card.rank === 14) {
    return (
      <span className="card__pip card__pip--ace" style={{ left: '50%', top: '50%' }}>
        {symbol}
      </span>
    )
  }

  if (card.rank >= 11) {
    return (
      <span className="card__court">
        <span className="card__court-suit">{symbol}</span>
        <span className="card__court-letter">{rankName(card.rank)}</span>
        <span className="card__court-suit card__court-suit--bottom">{symbol}</span>
      </span>
    )
  }

  const layout = PIP_LAYOUTS[card.rank] ?? []
  return (
    <>
      {layout.map(([col, y, flip], i) => (
        <span
          key={i}
          className={`card__pip${flip ? ' card__pip--flip' : ''}`}
          style={{ left: `${50 + col * 24}%`, top: `${y * 100}%` }}
        >
          {symbol}
        </span>
      ))}
    </>
  )
}

export function PlayingCard({ card, className = '' }: { card: Card; className?: string }) {
  const tone =
    card.suit === 'Joker' ? 'card--joker' : isRed(card.suit) ? 'card--red' : 'card--black'

  return (
    <div className={`card ${tone} ${className}`.trim()} role="img" aria-label={cardLabel(card)}>
      <CornerIndex card={card} corner="tl" />
      <div className="card__art">
        <CardArt card={card} />
      </div>
      <CornerIndex card={card} corner="br" />
    </div>
  )
}

export function CardBack({ className = '' }: { className?: string }) {
  return <div className={`card card--back ${className}`.trim()} aria-hidden="true" />
}

export function CardOutline({ className = '' }: { className?: string }) {
  return <div className={`card card--outline ${className}`.trim()} aria-hidden="true" />
}

/** A little stack of backs -- purely decorative, used on the lobby. */
export function DeckStack() {
  return (
    <div className="deck-stack" aria-hidden="true">
      <CardBack />
      <CardBack />
      <CardBack />
    </div>
  )
}

const SUIT_WORDS: Record<string, string> = {
  Spades: 'spades',
  Hearts: 'hearts',
  Diamonds: 'diamonds',
  Clubs: 'clubs',
  Joker: 'joker',
}

const RANK_WORDS: Record<number, string> = {
  11: 'jack',
  12: 'queen',
  13: 'king',
  14: 'ace',
}

export function cardLabel(card: Card): string {
  if (card.suit === 'Joker') return 'joker'
  const rank = RANK_WORDS[card.rank] ?? String(card.rank)
  return `${rank} of ${SUIT_WORDS[card.suit] ?? card.suit}`
}
