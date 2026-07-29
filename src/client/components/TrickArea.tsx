// The cards played so far in the current trick, plus whose turn it is. Sits in
// the middle of the table as a soft inset on the dark backdrop, with a name
// plate above each card, a crown + green ring on the winner and the losers
// veiled once the trick resolves.

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
  return (
    <section className="trick" aria-label="Current trick">
      <header className="trick__info">
        Trick {trickNumber} / {totalTricks}
        {leadSuit && <span className="trick__lead"> • Led: {leadSuit}</span>}
      </header>

      <div className="trick__cards">
        {plays.map((play) => {
          const isWinner = winnerId != null && play.id === winnerId
          const isLoser = winnerId != null && !isWinner
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
        {plays.length === 0 && <p className="trick__empty">waiting for the lead…</p>}
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
