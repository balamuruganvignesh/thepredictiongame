// A Time Traveler's Reverse Time reopened your bid. Same circular chips as the
// bidding modal, with two deliberate differences: NOTHING is forbidden (a
// rewrite isn't bound by the last-bidder sum rule), and it is dismissible --
// this is not a turn, nothing on the server is waiting on it, and walking away
// simply keeps the bid you already had.

import type { RebidPrompt } from '@shared/protocol'

type Props = {
  prompt: RebidPrompt
  onBid: (bid: number) => void
  onDismiss: () => void
}

export function RebidModal({ prompt, onBid, onDismiss }: Props) {
  return (
    <div className="backdrop" onClick={onDismiss} role="presentation">
      <div
        className="note modal modal--bid"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Your bid was reopened"
      >
        <header className="note__header modal__title">
          ⏳ BID REOPENED
          <button className="modal__close" onClick={onDismiss} aria-label="Keep your bid">
            ×
          </button>
        </header>

        <p className="modal__round">
          somebody rewound the clock on you — you bid <b>{prompt.currentBid}</b>, and you can
          choose again
        </p>

        <div className="bid-chips">
          {Array.from({ length: prompt.cardsDealt + 1 }, (_, n) => (
            <button
              key={n}
              className={`bid-chip${n === prompt.currentBid ? ' is-current' : ''}`}
              onClick={() => onBid(n)}
              aria-label={n === prompt.currentBid ? `Keep your bid of ${n}` : `Change your bid to ${n}`}
            >
              {n}
            </button>
          ))}
        </div>

        <p className="modal__waiting">nothing is waiting on you — close this to keep {prompt.currentBid}</p>
      </div>
    </div>
  )
}
