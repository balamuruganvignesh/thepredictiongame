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
  /**
   * Cards a Detective's Illusion has made LOOK dead. They are still perfectly
   * legal and still clickable -- the lie is entirely in the styling, and
   * calling the bluff is how you find out.
   */
  illusionCards?: string[]
  onPlay: (card: Card) => void
}

export function Hand({ hand, isMyTurn, leadSuit, illusionCards = [], onPlay }: Props) {
  return (
    <div className="hand" aria-label="Your hand">
      {hand.map((card) => {
        const key = cardKey(card)
        const legal = isMyTurn && isLegalPlay(card, hand, leadSuit)
        const illusioned = legal && illusionCards.includes(key)

        return (
          <button
            key={key}
            type="button"
            className={
              'card-button ' +
              (!legal
                ? 'card-button--muted'
                : illusioned
                  ? 'card-button--illusion'
                  : 'card-button--playable')
            }
            onClick={() => legal && onPlay(card)}
            disabled={!legal}
            // The label stays honest: a screen reader shouldn't be fooled by a
            // purely visual trick it can't see.
            aria-label={legal ? `Play the ${cardLabel(card)}` : cardLabel(card)}
          >
            <PlayingCard card={card} />
          </button>
        )
      })}
    </div>
  )
}
