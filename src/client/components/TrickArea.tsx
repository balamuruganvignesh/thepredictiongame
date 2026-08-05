// The cards played so far in the current trick, plus whose turn it is. Sits in
// the middle of the table as a soft inset on the dark backdrop, with a name
// plate above each card, a crown + green ring on the winner and the losers
// veiled once the trick resolves.

import { useEffect, useState } from 'react'
import type { PlayEntry } from '@shared/protocol'
import { PlayingCard } from './PlayingCard'

type Props = {
  plays: PlayEntry[]
  names: Record<string, string>
  currentTurnName: string | null
  leadSuit: string | null
  trickNumber: number
  totalTricks: number
  winnerId: string | null
}

export function TrickArea({
  plays,
  names,
  currentTurnName,
  leadSuit,
  trickNumber,
  totalTricks,
  winnerId,
}: Props) {
  // `plays` (and `winnerId` with it) goes straight to empty when the next
  // trick starts -- there's no server-side "clearing" state to key an exit
  // animation off. Hold the last full trick a beat longer so it can sweep
  // away instead of vanishing.
  const [shown, setShown] = useState({ plays, winnerId })
  const [sweeping, setSweeping] = useState(false)

  useEffect(() => {
    if (plays.length > 0) {
      setShown({ plays, winnerId })
      setSweeping(false)
      return
    }
    if (shown.plays.length === 0) return
    setSweeping(true)
    const timer = setTimeout(() => {
      setShown({ plays: [], winnerId: null })
      setSweeping(false)
    }, 260)
    return () => clearTimeout(timer)
  }, [plays, winnerId])

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
              <PlayingCard card={play.card} className="card-pop" />
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
