// A visually-hidden live region that narrates the table.
//
// Everything this game tells you is currently told with position, colour and
// motion: whose turn it is (an accent ring on a chip), who won the trick (a
// crown and a green ring), what a round scored (a column appearing in the
// score sheet). None of that reaches a screen reader, and none of it is
// something the player can go back and look up mid-round.
//
// So: one component, mounted by every table, that watches the store and
// speaks the transitions. Derived from what's already in the store rather
// than dispatched alongside each event, so there is no second copy of "what
// just happened" to keep in sync -- and no phase manager has to know this
// exists, the same reason ability announcements funnel through one broadcast
// choke point on the server.
//
// `polite`, never `assertive`: these interrupt nothing, and a trick-taking
// game generates a line every few seconds.

import { useEffect, useRef, useState } from 'react'
import { displayName } from '@shared/cards'
import type { Store } from '../useGame'

export function GameAnnouncer({ store }: { store: Store }) {
  const [message, setMessage] = useState('')
  // The last thing said, so a re-render that changes nothing meaningful
  // doesn't re-announce it.
  const lastRef = useRef('')

  const say = (text: string) => {
    if (!text || text === lastRef.current) return
    lastRef.current = text
    setMessage(text)
  }

  const nameFor = (id: string | null) =>
    id == null ? 'someone' : (store.names[id] ?? 'someone')

  // Your turn. Keyed off currentTurnId rather than a boolean so it re-fires
  // for each of your turns, not once per round.
  useEffect(() => {
    if (store.currentTurnId == null) return
    if (store.currentTurnId === store.meId) {
      say(store.phase === 'bidding' ? 'Your turn to bid.' : 'Your turn to play.')
    } else {
      say(`Waiting on ${nameFor(store.currentTurnId)}.`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.currentTurnId, store.phase, store.trickNumber])

  // Who took the trick, and what it cost -- the crown and the veil, in words.
  useEffect(() => {
    if (!store.trickWinnerId) return
    const cards = store.plays.map((play) => `${nameFor(play.id)} ${displayName(play.card)}`).join(', ')
    say(`${nameFor(store.trickWinnerId)} won trick ${store.trickNumber}. ${cards}.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.trickWinnerId, store.trickNumber])

  // Your own round score, once the round is scored. Everyone else's is in the
  // score sheet, which is a real table and reads fine on its own.
  useEffect(() => {
    if (store.phase != null || store.meId == null) return
    const round = store.history[store.roundNumber]
    if (!round || round[store.meId] == null) return
    const scored = round[store.meId]
    say(
      `Round ${store.roundNumber} scored. You ${scored >= 0 ? 'gained' : 'lost'} ${Math.abs(scored)}, total ${store.totals[store.meId] ?? 0}.`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.phase, store.roundNumber, store.history, store.meId])

  // The result.
  useEffect(() => {
    if (store.view !== 'gameover' || !store.standings || store.standings.length === 0) return
    const winner = store.standings[0]
    say(
      `Game over. ${winner.name} wins with ${winner.totalScore}. You finished ${ordinal(
        store.standings.findIndex((s) => s.id === store.meId) + 1,
      )}.`,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.view, store.standings])

  return (
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  )
}

function ordinal(n: number): string {
  if (n <= 0) return 'unplaced'
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
