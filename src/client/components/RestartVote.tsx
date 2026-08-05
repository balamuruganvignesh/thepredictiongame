// The dock's restart button: any seated player can call a vote to abandon the
// game in progress and drop the table back to the lobby, where everyone who has
// been stuck spectating is given a chair.
//
// Shared by both games' tables -- the vote is a property of the TABLE, not of
// the Prediction Game or of Hearts, so it renders identically in each.

import type { RestartVote as RestartVoteState } from '@shared/protocol'

export function RestartVoteButton({
  restart,
  meId,
  spectating,
  onVote,
  className = '',
}: {
  restart: RestartVoteState
  meId: string | null
  /** Watchers see the tally but can't vote: they aren't in the game being ended. */
  spectating: boolean
  onVote: (vote: boolean) => void
  className?: string
}) {
  const voted = meId != null && restart.votes.includes(meId)
  const count = restart.votes.length
  const live = count > 0

  // A watcher's read-only view of a vote already under way. Nothing to press,
  // so it isn't a button.
  if (spectating) {
    if (!live) return null
    return (
      <span className={`dock__button dock__button--restart is-live ${className}`.trim()} aria-live="polite">
        🔄 RESTART {count}/{restart.needed}
      </span>
    )
  }

  return (
    <button
      className={`dock__button dock__button--restart${live ? ' is-live' : ''} ${className}`.trim()}
      onClick={() => onVote(!voted)}
      title={
        voted
          ? 'Withdraw your vote to restart'
          : restart.waiting > 0
            ? `${restart.waiting} waiting for a chair — vote to end this game and reopen the lobby`
            : 'Vote to end this game and reopen the lobby'
      }
    >
      {voted ? '✓ RESTART' : '🔄 RESTART'}
      {live && (
        <span className="dock__badge dock__badge--vote">
          {count}/{restart.needed}
        </span>
      )}
      {/* Nobody has voted yet: show what a restart would actually be FOR. */}
      {!live && restart.waiting > 0 && <span className="dock__badge">{restart.waiting}👁</span>}
    </button>
  )
}
