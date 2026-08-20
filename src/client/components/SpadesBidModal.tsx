// Spades bid modal: same paper-note-over-a-dimmed-table shape as
// BiddingModal, much simpler content -- no forbidden number, no Double
// window, just 0-13 or Nil. Nil is its own pill, not chip 0, since it's a
// completely different commitment (bidding to take ZERO tricks for a flat
// bonus/penalty) rather than just the bottom of the numeric range.

import { useEffect, useState } from 'react'
import { playBidLock } from '../sound'
import type { SpadesBid } from '@shared/spadesRules'

export type SpadesBidRow = { id: string; name: string; team: 0 | 1; bid: SpadesBid | null; isCurrentTurn: boolean }

type Props = {
  isMyTurn: boolean
  hasBid: boolean
  myBid: SpadesBid | null
  rows: SpadesBidRow[]
  currentTurnName: string | null
  bags: [number, number]
  onBid: (bid: SpadesBid) => void
}

export function SpadesBidModal({ isMyTurn, hasBid, myBid, rows, currentTurnName, bags, onBid }: Props) {
  const [confirming, setConfirming] = useState<SpadesBid | null>(null)

  useEffect(() => {
    if (confirming == null) return
    const timer = setTimeout(() => setConfirming(null), 420)
    return () => clearTimeout(timer)
  }, [confirming])

  const handleBid = (bid: SpadesBid) => {
    setConfirming(bid)
    playBidLock()
    onBid(bid)
  }

  const picking = (isMyTurn && !hasBid) || confirming != null
  const bidLabel = (bid: SpadesBid | null) => (bid == null ? '—' : bid === 'nil' ? 'NIL' : bid)

  return (
    <div className="backdrop backdrop--bidding">
      <div className="note modal modal--bid" role="dialog" aria-modal="true" aria-label="Bidding">
        <header className="note__header modal__title">
          {picking ? 'PLACE YOUR BID' : hasBid ? 'BID PLACED' : 'BIDDING'}
        </header>

        <p className="modal__round">
          team bags: {bags[0]} · {bags[1]}
        </p>

        <div className="bid-pills">
          {rows.map((row) => (
            <span
              key={row.id}
              className={`bid-pill${row.isCurrentTurn ? ' is-turn' : ''}${
                row.bid == null ? ' is-empty' : ''
              }`}
            >
              {row.name} <b>{bidLabel(row.bid)}</b>
            </span>
          ))}
        </div>

        {picking ? (
          <>
            <div className="bid-chips">
              {Array.from({ length: 14 }, (_, n) => {
                const selected = confirming === n
                const dimmed = confirming != null && !selected
                return (
                  <button
                    key={n}
                    className={`bid-chip${selected ? ' bid-chip--selected' : ''}${
                      dimmed ? ' bid-chip--dimmed' : ''
                    }`}
                    onClick={() => handleBid(n)}
                    disabled={confirming != null}
                    aria-label={`Bid ${n}`}
                  >
                    {n}
                  </button>
                )
              })}
            </div>
            <button
              className={`button button--double${confirming === 'nil' ? ' is-committed' : ''}`}
              onClick={() => handleBid('nil')}
              disabled={confirming != null}
            >
              BID NIL — take zero tricks
            </button>
          </>
        ) : (
          <p className="modal__waiting">
            {hasBid ? (
              <>
                you bid <b>{bidLabel(myBid)}</b>
                <br />
                <br />
                waiting for the others…
              </>
            ) : (
              <>{currentTurnName ?? 'someone'} is thinking…</>
            )}
          </p>
        )}
      </div>
    </div>
  )
}
