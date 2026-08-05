// Bid declaration modal: a paper note over a dimmed table. Header strip on top,
// the round info with the trump glyph, everyone's bids as little pills, then a
// row of circular bid chips that grow under the cursor. The forbidden
// last-bidder number shows crossed out. Double is one click and FINAL.

import { useEffect, useState } from 'react'
import { trumpGlyph } from '../useGame'

export type BidRow = { id: string; name: string; bid: number | null; isCurrentTurn: boolean }

type Props = {
  cardsDealt: number
  trumpSuit: string
  isMyTurn: boolean
  hasBid: boolean
  myBid: number | null
  isLastBidder: boolean
  sumSoFar: number
  rows: BidRow[]
  currentTurnName: string | null
  doubleDeadline: number | null
  doubled: boolean
  onBid: (bid: number) => void
  onDouble: () => void
}

export function BiddingModal({
  cardsDealt,
  trumpSuit,
  isMyTurn,
  hasBid,
  myBid,
  isLastBidder,
  sumSoFar,
  rows,
  currentTurnName,
  doubleDeadline,
  doubled,
  onBid,
  onDouble,
}: Props) {
  const secondsLeft = useCountdown(doubleDeadline)
  const windowOpen = !doubled && doubleDeadline != null && secondsLeft > 0

  // The chip you tapped gets a beat to punch in and glow before this whole
  // section swaps to "waiting for the others" -- without it, a fast server
  // ack (same box, basically instant) means the chips just vanish on click
  // and the flourish never gets a frame.
  const [confirming, setConfirming] = useState<number | null>(null)

  useEffect(() => {
    if (confirming == null) return
    const timer = setTimeout(() => setConfirming(null), 420)
    return () => clearTimeout(timer)
  }, [confirming])

  const handleBid = (n: number) => {
    setConfirming(n)
    onBid(n)
  }

  const picking = (isMyTurn && !hasBid) || confirming != null

  return (
    <div className="backdrop backdrop--bidding">
      <div className="note modal modal--bid" role="dialog" aria-modal="true" aria-label="Bidding">
        <header className="note__header modal__title">
          {picking ? 'PLACE YOUR BID' : hasBid ? 'BID PLACED' : 'BIDDING'}
        </header>

        <p className="modal__round">
          <span className="modal__trump">{trumpGlyph(trumpSuit)}</span> {cardsDealt} card
          {cardsDealt === 1 ? '' : 's'} this round
        </p>

        <div className="bid-pills">
          {rows.map((row) => (
            <span
              key={row.id}
              className={`bid-pill${row.isCurrentTurn ? ' is-turn' : ''}${
                row.bid == null ? ' is-empty' : ''
              }`}
            >
              {row.name} <b>{row.bid ?? '—'}</b>
            </span>
          ))}
        </div>

        {picking ? (
          <div className="bid-chips">
            {Array.from({ length: cardsDealt + 1 }, (_, n) => {
              // The last bidder can't make the bids sum to the number of tricks.
              const forbidden = isLastBidder && sumSoFar + n === cardsDealt
              const selected = confirming === n
              const dimmed = confirming != null && !selected
              return (
                <button
                  key={n}
                  className={`bid-chip${forbidden ? ' is-forbidden' : ''}${
                    selected ? ' bid-chip--selected' : ''
                  }${dimmed ? ' bid-chip--dimmed' : ''}`}
                  onClick={() => !forbidden && handleBid(n)}
                  disabled={forbidden || confirming != null}
                  aria-label={forbidden ? `${n} — not allowed this round` : `Bid ${n}`}
                >
                  {n}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="modal__waiting">
            {hasBid ? (
              <>
                you bid <b>{myBid ?? 0}</b>
                <br />
                <br />
                waiting for the others…
              </>
            ) : (
              <>{currentTurnName ?? 'someone'} is thinking…</>
            )}
          </p>
        )}

        {(windowOpen || doubled) && (
          <button
            className={`button button--double${doubled ? ' is-committed' : ''}`}
            onClick={onDouble}
            disabled={doubled}
          >
            {doubled ? 'DOUBLED ✓' : `DOUBLE DOWN  (${secondsLeft})`}
          </button>
        )}
      </div>
    </div>
  )
}

/** Whole seconds remaining until `deadline`, ticking down. 0 when not set. */
function useCountdown(deadline: number | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (deadline == null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [deadline])

  if (deadline == null) return 0
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
