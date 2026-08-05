// Hearts: the pass. A paper note over a dimmed table showing your whole hand;
// tap three cards to lift them out, then send. Everyone chooses at the same
// time, so after you've sent there's a waiting state rather than a turn queue.

import { useState } from 'react'
import type { Card } from '@shared/cards'
import { cardKey, isSameCard } from '@shared/cards'
import { PASS_COUNT, passDirectionLabel, type PassDirection } from '@shared/heartsRules'
import { PlayingCard, cardLabel } from './PlayingCard'

type Props = {
  hand: Card[]
  direction: PassDirection
  /** Who the three cards are going to. */
  toName: string | null
  onPass: (cards: Card[]) => void
}

export function PassModal({ hand, direction, toName, onPass }: Props) {
  const [picked, setPicked] = useState<Card[]>([])

  const toggle = (card: Card) => {
    setPicked((current) => {
      if (current.some((c) => isSameCard(c, card))) {
        return current.filter((c) => !isSameCard(c, card))
      }
      // Silently ignore a fourth pick rather than swapping one out: dropping a
      // card the player deliberately chose would be worse than doing nothing.
      return current.length >= PASS_COUNT ? current : [...current, card]
    })
  }

  const ready = picked.length === PASS_COUNT

  return (
    <div className="backdrop backdrop--bidding">
      <div className="note modal modal--pass" role="dialog" aria-modal="true" aria-label="Pass cards">
        <header className="note__header modal__title">
          {passDirectionLabel(direction)}
          {toName && <span className="modal__pass-to"> → {toName}</span>}
        </header>

        <p className="modal__round">
          choose {PASS_COUNT} cards to give away — {picked.length}/{PASS_COUNT} picked
        </p>

        <div className="pass-hand">
          {hand.map((card, i) => {
            const chosen = picked.some((c) => isSameCard(c, card))
            return (
              <button
                key={cardKey(card)}
                type="button"
                className={`card-button ${chosen ? 'card-button--picked' : 'card-button--playable'}`}
                style={{ animationDelay: `${i * 55}ms` }}
                onClick={() => toggle(card)}
                aria-pressed={chosen}
                aria-label={`${chosen ? 'Keep' : 'Pass'} the ${cardLabel(card)}`}
              >
                <PlayingCard card={card} />
              </button>
            )
          })}
        </div>

        <button
          className="button button--accent"
          onClick={() => ready && onPass(picked)}
          disabled={!ready}
        >
          {ready ? 'PASS THESE THREE' : `PICK ${PASS_COUNT - picked.length} MORE`}
        </button>
      </div>
    </div>
  )
}

/** Shown after you've passed, while the rest of the table is still choosing. */
export function PassWaiting({ direction }: { direction: PassDirection }) {
  return (
    <div className="backdrop backdrop--bidding">
      <div className="note modal modal--pass" role="dialog" aria-modal="true" aria-label="Passing">
        <header className="note__header modal__title">{passDirectionLabel(direction)}</header>
        <p className="modal__waiting">
          cards sent
          <br />
          <br />
          waiting for the others…
        </p>
      </div>
    </div>
  )
}
