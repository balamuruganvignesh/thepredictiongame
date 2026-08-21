// Step back through a round trick by trick.
//
// In-memory only: the server holds this game's tricks on the Room and the
// viewer asks for them when it opens (see Room.recordTrick). Nothing here
// touches the SQLite store -- replaying a game from a previous server process
// is a strictly bigger problem and explicitly not what this is.
//
// Trick-taking games only. Golf and Blackjack have no tricks to step through,
// so their tables don't offer the button at all rather than opening an empty
// viewer.

import { useEffect, useState } from 'react'
import { displayName } from '@shared/cards'
import type { ReplayData } from '@shared/protocol'
import { PlayingCard } from './PlayingCard'
import { trumpGlyph } from '../useGame'

/** How long each trick holds during autoplay. */
const AUTOPLAY_MS = 1600

export function ReplayViewer({
  replay,
  onClose,
}: {
  replay: ReplayData | null
  onClose: () => void
}) {
  // Index into replay.rounds, not a round NUMBER: the recording is capped at
  // the most recent rounds, so round 1 may well have fallen off the front.
  const [roundIndex, setRoundIndex] = useState(0)
  const [trickIndex, setTrickIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  const rounds = replay?.rounds ?? []
  const round = rounds[roundIndex]
  const tricks = round?.tricks ?? []
  const trick = tricks[trickIndex]

  // Land on the LAST round by default -- the one that just happened is what
  // anyone opening a replay is almost always after.
  useEffect(() => {
    if (rounds.length > 0) setRoundIndex(rounds.length - 1)
  }, [rounds.length])

  useEffect(() => {
    setTrickIndex(0)
    setPlaying(false)
  }, [roundIndex])

  // Autoplay stops at the end of the round rather than rolling into the next
  // one: rounds are the unit people argue about, and silently moving on would
  // lose the one they were watching.
  useEffect(() => {
    if (!playing) return
    if (trickIndex >= tricks.length - 1) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setTrickIndex((i) => i + 1), AUTOPLAY_MS)
    return () => clearTimeout(timer)
  }, [playing, trickIndex, tricks.length])

  const nameFor = (id: string) => replay?.names[id] ?? 'Player'

  return (
    <div className="backdrop">
      <div className="note modal modal--replay" role="dialog" aria-modal="true" aria-label="Replay">
        <header className="note__header modal__title">
          ⏪ REPLAY
          <button className="modal__close" onClick={onClose} aria-label="Close the replay">
            ×
          </button>
        </header>

        {replay == null ? (
          <p className="modal__waiting">loading the tricks…</p>
        ) : rounds.length === 0 ? (
          <p className="modal__waiting">
            nothing to replay yet — come back once a trick has been played.
          </p>
        ) : (
          <>
            <div className="replay__rounds" role="group" aria-label="Pick a round">
              {rounds.map((entry, i) => (
                <button
                  key={entry.roundNumber}
                  type="button"
                  className={`replay__round${i === roundIndex ? ' is-active' : ''}`}
                  onClick={() => setRoundIndex(i)}
                  aria-pressed={i === roundIndex}
                >
                  {entry.roundNumber}
                  {entry.trumpSuit && (
                    <span className="replay__round-trump">{trumpGlyph(entry.trumpSuit)}</span>
                  )}
                </button>
              ))}
            </div>

            <p className="replay__caption">
              Round {round.roundNumber} · trick {trickIndex + 1} of {tricks.length}
              {trick && !trick.counted && ' · win voided'}
            </p>

            <div className="replay__trick">
              {trick?.plays.map((play) => {
                const isWinner = play.id === trick.winnerId && trick.counted
                return (
                  <div
                    key={play.id}
                    className={`card-slot${isWinner ? ' card-slot--winner' : ''}`}
                  >
                    <span className={`card-slot__name${isWinner ? ' is-winner' : ''}`}>
                      {isWinner && '👑 '}
                      {nameFor(play.id)}
                    </span>
                    <PlayingCard card={play.card} />
                  </div>
                )
              })}
            </div>

            {/* The whole trick as text, so it reads without the cards --
                and so a screen reader gets the result rather than a row of
                images it has to piece together. */}
            <p className="replay__summary" aria-live="polite">
              {trick
                ? `${nameFor(trick.winnerId)} took it${trick.counted ? '' : ' (voided)'} — ${trick.plays
                    .map((play) => `${nameFor(play.id)} ${displayName(play.card)}`)
                    .join(', ')}`
                : ''}
            </p>

            <div className="replay__controls">
              <button
                type="button"
                className="button"
                onClick={() => setTrickIndex((i) => Math.max(0, i - 1))}
                disabled={trickIndex === 0}
              >
                ◀ prev
              </button>
              <button
                type="button"
                className="button button--accent"
                onClick={() => setPlaying((on) => !on)}
                disabled={tricks.length < 2}
              >
                {playing ? '❚❚ pause' : '▶ play'}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setTrickIndex((i) => Math.min(tricks.length - 1, i + 1))}
                disabled={trickIndex >= tricks.length - 1}
              >
                next ▶
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
