// Draws a single playing card. The faces are Kenney's CC0 pixel-art deck
// (public/cards/, cropped to the artwork so the sprite IS the card), rendered
// with image-rendering: pixelated so upscaling stays crisp instead of going
// soft. Everything around the face -- shadow, radius, the winner/playable
// rings, the muted and illusion veils -- is still CSS on the wrapper, so the
// interaction states are unchanged.

import type { Card } from '@shared/cards'

/** Rank -> the token Kenney's filenames use. */
const RANK_FILE: Record<number, string> = {
  2: '02',
  3: '03',
  4: '04',
  5: '05',
  6: '06',
  7: '07',
  8: '08',
  9: '09',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

const SUIT_FILE: Record<string, string> = {
  Spades: 'spades',
  Hearts: 'hearts',
  Diamonds: 'diamonds',
  Clubs: 'clubs',
}

/** The sprite for a card. */
export function cardImage(card: Card): string {
  if (card.suit === 'Joker') return '/cards/card_joker_red.png'
  const suit = SUIT_FILE[card.suit]
  const rank = RANK_FILE[card.rank]
  if (!suit || !rank) return '/cards/card_back.png'
  return `/cards/card_${suit}_${rank}.png`
}

export function PlayingCard({ card, className = '' }: { card: Card; className?: string }) {
  return (
    <div className={`card ${className}`.trim()}>
      <img className="card__face" src={cardImage(card)} alt={cardLabel(card)} draggable={false} />
    </div>
  )
}

export function CardBack({ className = '' }: { className?: string }) {
  return (
    <div className={`card card--back ${className}`.trim()} aria-hidden="true">
      <img className="card__face" src="/cards/card_back.png" alt="" draggable={false} />
    </div>
  )
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
