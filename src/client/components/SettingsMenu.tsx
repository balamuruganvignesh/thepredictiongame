// The dock's settings button: everything that isn't a core in-round action --
// which card art renders, the score sheet toggle, and the restart vote -- lives
// behind one button so the dock stays down to settings + chat (+ role/ability
// in chaos). A live restart vote still shows through as a badge on the closed
// button, so nobody misses one just because it's tucked in the menu.

import { useState } from 'react'
import type { RestartVote as RestartVoteState } from '@shared/protocol'
import { ColorblindToggleButton, MotionToggleButton } from './A11yToggles'
import { DeckToggleButton } from './DeckToggle'
import { EffectsToggleButton } from './EffectsToggle'
import { RestartVoteButton } from './RestartVote'
import { SoundToggleButton } from './SoundToggle'

export function SettingsMenu({
  scoresOpen,
  onToggleScores,
  restart,
  meId,
  spectating,
  onVoteRestart,
}: {
  scoresOpen: boolean
  onToggleScores: () => void
  restart: RestartVoteState
  meId: string | null
  spectating: boolean
  onVoteRestart: (vote: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const restartLive = restart.votes.length > 0

  return (
    <div className="settings">
      {open && (
        <div className="note settings__pop" role="dialog" aria-label="Settings">
          <DeckToggleButton className="settings__item" />
          <EffectsToggleButton className="settings__item" />
          <SoundToggleButton className="settings__item" />
          <ColorblindToggleButton className="settings__item" />
          <MotionToggleButton className="settings__item" />
          <button
            className="dock__button settings__item"
            onClick={() => {
              onToggleScores()
              setOpen(false)
            }}
          >
            {scoresOpen ? 'HIDE SCORES' : 'SCORES'}
          </button>
          <RestartVoteButton
            className="settings__item"
            restart={restart}
            meId={meId}
            spectating={spectating}
            onVote={onVoteRestart}
          />
        </div>
      )}

      <button className="dock__button" onClick={() => setOpen((current) => !current)}>
        ⚙ SETTINGS
        {restartLive && !open && (
          <span className="dock__badge dock__badge--vote">
            {restart.votes.length}/{restart.needed}
          </span>
        )}
      </button>
    </div>
  )
}
