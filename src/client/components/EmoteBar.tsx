// The dock's reaction button: a popover of fixed reactions.
//
// This is the one thing added to the dock rather than tucked behind SETTINGS,
// and it fits the rule the dock already follows: moment-to-moment ACTIONS
// live in the dock, everything else goes in the settings popover. Reacting to
// the trick that just landed is as moment-to-moment as it gets -- behind two
// clicks in a menu it would simply never be used.
//
// No backdrop, deliberately, for the same reason QuickAbility has none: you
// react to what's happening, so the table has to stay visible while you pick.

import { useState } from 'react'
import { availableEmotes } from '@shared/emotes'

export function EmoteBar({ onEmote }: { onEmote: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const emotes = availableEmotes()

  return (
    <div className="emotes">
      {open && (
        <div className="note emotes__pop" role="group" aria-label="Reactions">
          {emotes.map((emote) => (
            <button
              key={emote.id}
              type="button"
              className="emotes__pick"
              title={emote.label}
              aria-label={emote.label}
              onClick={() => {
                onEmote(emote.id)
                // Closes on pick: the server rate-limits anyway, so leaving it
                // open would just invite mashing something that gets dropped.
                setOpen(false)
              }}
            >
              {emote.glyph}
            </button>
          ))}
        </div>
      )}

      <button
        className="dock__button dock__button--emote"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="React"
      >
        😀
      </button>
    </div>
  )
}
