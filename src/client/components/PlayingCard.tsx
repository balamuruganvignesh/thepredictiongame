// Draws a single playing card. Which art renders is the player's equipped
// deck skin (see ../deckStyle.tsx and @shared/decks) -- a display preference,
// not table state. Only two sprite FOLDERS exist:
//  - "classic": a photographed deck (public/cards-classic/), the free
//    default. It has no Joker face, so Jokers fall back to the pixel deck's
//    in every skin.
//  - "pixel": Kenney's CC0 pixel-art deck (public/cards/, cropped to the
//    artwork so the sprite IS the card), rendered with image-rendering:
//    pixelated so upscaling stays crisp instead of going soft.
// The premium skins beyond those two are CSS filters over the classic
// sprites, applied in ../styles/cards.css off the data-deck attribute, so
// nothing here has to know they exist.
// Everything around the face -- shadow, radius, the winner/playable rings,
// the muted and illusion veils -- is still CSS on the wrapper, so the
// interaction states are unchanged regardless of deck.

import type { Card } from '@shared/cards'
import { displayName } from '@shared/cards'
import { useA11y } from '../a11ySettings'
import { useDeckStyle } from '../deckStyle'
import type { DeckArt } from '@shared/decks'

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

/** Rank -> the token the classic deck's filenames use (2..10,J,Q,K,A). */
const RANK_FILE_CLASSIC: Record<number, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
}

const SUIT_FILE_CLASSIC: Record<string, string> = {
  Spades: 'S',
  Hearts: 'H',
  Diamonds: 'D',
  Clubs: 'C',
}

export const cardBackImage = (art: DeckArt) =>
  art === 'classic' ? '/cards-classic/back.png' : '/cards/card_back.png'

/** The sprite for a card, from the given deck's art folder. */
export function cardImage(card: Card, art: DeckArt = 'classic'): string {
  if (card.suit === 'Joker') return '/cards/card_joker_red.png'
  if (art === 'classic') {
    const suit = SUIT_FILE_CLASSIC[card.suit]
    const rank = RANK_FILE_CLASSIC[card.rank]
    if (!suit || !rank) return cardBackImage(art)
    return `/cards-classic/${rank}${suit}.png`
  }
  const suit = SUIT_FILE[card.suit]
  const rank = RANK_FILE[card.rank]
  if (!suit || !rank) return cardBackImage(art)
  return `/cards/card_${suit}_${rank}.png`
}

export function PlayingCard({ card, className = '' }: { card: Card; className?: string }) {
  const { art } = useDeckStyle()
  const { colorblindSuits } = useA11y()
  return (
    <div className={`card ${className}`.trim()}>
      <img
        className="card__face"
        src={cardImage(card, art)}
        alt={cardLabel(card)}
        draggable={false}
      />
      {/* The four-colour badge. Both decks put the suit across ONE axis --
          red vs. black -- which is exactly the axis a red/green or
          blue/yellow deficiency collapses, and the pixel deck's pips are 6px
          of source art on top of that. The badge restores two independent
          cues at a readable size: a per-suit hue on the four-colour-deck
          convention (spades black, hearts red, diamonds blue, clubs green)
          AND the rank+glyph as text, which carries on its own if the hue
          doesn't. aria-hidden because the <img> alt already names the card --
          this is the same information again, for eyes rather than readers. */}
      {colorblindSuits && (
        <span className={`card__suit-badge card__suit-badge--${card.suit.toLowerCase()}`} aria-hidden="true">
          {displayName(card)}
        </span>
      )}
    </div>
  )
}

export function CardBack({ className = '' }: { className?: string }) {
  const { art } = useDeckStyle()
  return (
    <div className={`card card--back ${className}`.trim()} aria-hidden="true">
      <img className="card__face" src={cardBackImage(art)} alt="" draggable={false} />
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
