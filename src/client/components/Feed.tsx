// Floating announcement cards: public ability events in gold, results only you
// can see in violet. They expire on their own -- the full history lives in the
// game log, so nothing is lost when one fades.

import type { FeedCard } from '../useGame'

export function Feed({ cards }: { cards: FeedCard[] }) {
  if (cards.length === 0) return null
  return (
    <div className="feed" role="status" aria-live="polite">
      {cards.map((card) => (
        <div key={card.id} className={`feed__card${card.secret ? ' feed__card--secret' : ''}`}>
          {card.secret ? `🔒 ${card.message}  (only you saw this)` : card.message}
        </div>
      ))}
    </div>
  )
}
