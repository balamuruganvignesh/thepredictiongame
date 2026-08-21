// The cards played so far in the current trick, plus whose turn it is. Sits in
// the middle of the table as a soft inset on the dark backdrop, with a name
// plate above each card, a crown + green ring on the winner and the losers
// veiled once the trick resolves.

import { useEffect, useState } from 'react'
import { cardKey } from '@shared/cards'
import type { PlayEntry } from '@shared/protocol'
import { flyFrom, seatOrigin, takeOrigin } from '../animation'
import { useEnterAnimation } from '../useEnterAnimation'
import { PlayingCard } from './PlayingCard'

type Props = {
  plays: PlayEntry[]
  names: Record<string, string>
  currentTurnName: string | null
  leadSuit: string | null
  trickNumber: number
  totalTricks: number
  winnerId: string | null
  /** Whose hand the flights should start from -- see the ref callback below. */
  meId?: string | null
}

export function TrickArea({
  plays,
  names,
  currentTurnName,
  leadSuit,
  trickNumber,
  totalTricks,
  winnerId,
  meId = null,
}: Props) {
  // `plays` (and `winnerId` with it) goes straight to empty when the next
  // trick starts -- there's no server-side "clearing" state to key an exit
  // animation off. Hold the last full trick a beat longer so it can sweep
  // away instead of vanishing.
  //
  // `trickNumber` is held WITH the plays, not read from the prop, and that's
  // load-bearing: during the sweep the prop has already advanced to the next
  // trick while `shown` is still the old one. Building the animation keys off
  // the prop made every held-over card look brand new, so the whole outgoing
  // trick re-animated on its way out -- and the player's own card, whose
  // flight origin is consumed on first use, degraded to the no-origin pop.
  const [shown, setShown] = useState({ plays, winnerId, trickNumber })
  const [sweeping, setSweeping] = useState(false)

  useEffect(() => {
    if (plays.length > 0) {
      setShown({ plays, winnerId, trickNumber })
      setSweeping(false)
      return
    }
    if (shown.plays.length === 0) return
    setSweeping(true)
    const timer = setTimeout(() => {
      setShown({ plays: [], winnerId: null, trickNumber })
      setSweeping(false)
    }, 260)
    return () => clearTimeout(timer)
  }, [plays, winnerId, trickNumber])

  // Keyed per trick as well as per card: the same card can't repeat inside
  // one trick, but a re-led suit across tricks absolutely can. Off
  // `shown.trickNumber`, never the prop -- see above.
  const cardId = (play: PlayEntry) => `${shown.trickNumber}-${play.id}-${cardKey(play.card)}`
  const onEnter = useEnterAnimation(shown.plays.map(cardId))

  return (
    <section className="trick" aria-label="Current trick">
      <header className="trick__info">
        Trick {trickNumber} / {totalTricks}
        {leadSuit && <span className="trick__lead"> • Led: {leadSuit}</span>}
      </header>

      <div className={`trick__cards${sweeping ? ' trick__cards--sweeping' : ''}`}>
        {shown.plays.map((play) => {
          const isWinner = shown.winnerId != null && play.id === shown.winnerId
          const isLoser = shown.winnerId != null && !isWinner
          return (
            <div
              key={play.id}
              className={`card-slot${isWinner ? ' card-slot--winner' : ''}${
                isLoser ? ' card-slot--lost' : ''
              }`}
            >
              <span className={`card-slot__name${isWinner ? ' is-winner' : ''}`}>
                {isWinner && '👑 '}
                {names[play.id] ?? '?'}
              </span>
              {/* Your own card flies from the exact slot it left your hand
                  from; everyone else's flies from their chip in the top bar,
                  which is the only thing on screen that represents them. */}
              <div
                ref={onEnter(cardId(play), (el) =>
                  flyFrom(
                    el,
                    play.id === meId ? takeOrigin(cardKey(play.card)) : seatOrigin(play.id),
                  ),
                )}
              >
                <PlayingCard card={play.card} />
              </div>
            </div>
          )
        })}
        {shown.plays.length === 0 && <p className="trick__empty">waiting for the lead…</p>}
      </div>

      <footer className={`trick__turn${winnerId ? ' is-winner' : ''}`}>
        {winnerId
          ? `${names[winnerId] ?? 'someone'} won the trick!`
          : currentTurnName
            ? `Waiting on ${currentTurnName}…`
            : ''}
      </footer>
    </section>
  )
}
