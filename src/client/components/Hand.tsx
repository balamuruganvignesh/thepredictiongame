// The local player's hand along the bottom of the screen. Clicking a card
// sends playCard -- the server is the final authority on legality, this is just
// UX (illegal cards are veiled and unplayable, playable ones get a warm ring
// and lift on hover).
//
// Keyboard: the whole fan is ONE tab stop with a roving tabindex, arrows to
// move along it, Enter/Space to play, Home/End for the ends. Thirteen
// separate tab stops (a Spades hand) is technically navigable and genuinely
// unusable, and the roving pattern is what every other card/toolbar widget
// converges on.

import type { Card } from '@shared/cards'
import { cardKey, isLegalPlay } from '@shared/cards'
import { dealIn, rememberOrigin } from '../animation'
import { useEnterAnimation } from '../useEnterAnimation'
import { useRovingFocus } from '../useRovingFocus'
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
  /**
   * A card a Time Traveler's Rewind is barring. The opposite of an Illusion:
   * this one is REAL, the server refuses it, so it must actually be
   * unplayable rather than merely look that way.
   */
  barredCard?: string | null
  /**
   * Which cards this game considers legal. Defaults to the Prediction Game's
   * follow-suit rule; Hearts passes its own, which also knows about broken
   * hearts and the first-trick restrictions. It has to agree with the server
   * exactly -- offering an illegal card just earns a rejection toast.
   */
  isPlayable?: (card: Card, hand: Card[]) => boolean
  /**
   * What this fan IS. Defaults to your own hand; a spectator peeking at a
   * seat gets that seat's name instead, since "Your hand" would be a lie in
   * the one place the component renders somebody else's cards.
   */
  label?: string
  onPlay: (card: Card) => void
}

export function Hand({
  hand,
  isMyTurn,
  leadSuit,
  illusionCards = [],
  barredCard = null,
  isPlayable,
  label = 'Your hand',
  onPlay,
}: Props) {
  const allowed = isPlayable ?? ((card: Card, cards: Card[]) => isLegalPlay(card, cards, leadSuit))
  const { containerRef, onKeyDown, itemProps } = useRovingFocus(hand.length, '.card-button')
  const keys = hand.map(cardKey)
  const onEnter = useEnterAnimation(keys)

  return (
    <div
      className="hand"
      ref={containerRef}
      role="group"
      aria-label={`${label}, ${hand.length} card${hand.length === 1 ? '' : 's'}`}
      onKeyDown={onKeyDown}
    >
      {hand.map((card, i) => {
        const key = cardKey(card)
        const barred = key === barredCard
        const legal = isMyTurn && !barred && allowed(card, hand)
        // Independent of `legal`/`isMyTurn` on purpose: gating the veil on
        // legality let a dimmed-vs-blacked-out card leak its own suit (only
        // off-suit cards fell through to the muted look), and it vanished
        // entirely outside your own turn. The illusion has to hold for as
        // long as the card is in illusionCards, full stop.
        const illusioned = illusionCards.includes(key)

        return (
          <button
            key={key}
            type="button"
            className={
              'card-button ' +
              (barred
                ? 'card-button--barred'
                : illusioned
                  ? 'card-button--illusion'
                  : legal
                    ? 'card-button--playable'
                    : 'card-button--muted')
            }
            ref={onEnter(key, (el) => dealIn(el, i))}
            onClick={(event) => {
              if (!legal) return
              // Where this card is RIGHT NOW, so the trick area can fly it in
              // from here. Captured at the click because the hand drops the
              // card before the trick ever renders it -- by then there is
              // nothing left to measure.
              rememberOrigin(key, event.currentTarget)
              onPlay(card)
            }}
            {...itemProps(i)}
            // aria-disabled, NOT disabled: a disabled button is removed from
            // the focus order, which would drop unplayable cards out of the
            // roving fan entirely -- and being able to read your whole hand,
            // playable or not, is the same reason the muted veil stays
            // readable rather than blacking the face out.
            aria-disabled={!legal}
            // The label stays honest: a screen reader shouldn't be fooled by a
            // purely visual trick it can't see.
            aria-label={
              barred
                ? `${cardLabel(card)} — rewound, you must play something else`
                : legal
                  ? `Play the ${cardLabel(card)}`
                  : `${cardLabel(card)} — not playable right now`
            }
          >
            <PlayingCard card={card} />
          </button>
        )
      })}
    </div>
  )
}
