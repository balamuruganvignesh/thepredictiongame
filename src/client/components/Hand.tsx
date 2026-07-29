// The local player's hand along the bottom of the screen. Clicking a card
// sends playCard -- the server is the final authority on legality, this is just
// UX (illegal cards are veiled and unclickable, playable ones get a warm ring
// and lift on hover).

import type { Card } from '@shared/cards'
import { cardKey, isLegalPlay } from '@shared/cards'
import { PlayingCard, cardLabel } from './PlayingCard'

type Props = {
  hand: Card[]
  isMyTurn: boolean
  leadSuit: string | null
  onPlay: (card: Card) => void
}

export function Hand({ hand, isMyTurn, leadSuit, onPlay }: Props) {
  return (
    <div className="hand" aria-label="Your hand">
      {hand.map((card) => {
        const legal = isMyTurn && isLegalPlay(card, hand, leadSuit)
        return (
          <button
            key={cardKey(card)}
            type="button"
            className={`card-button ${legal ? 'card-button--playable' : 'card-button--muted'}`}
            onClick={() => legal && onPlay(card)}
            disabled={!legal}
            aria-label={legal ? `Play the ${cardLabel(card)}` : cardLabel(card)}
          >
            <PlayingCard card={card} />
          </button>
        )
      })}
    </div>
  )
}
