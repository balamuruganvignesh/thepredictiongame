// S toggles the docked score sheet. All five tables bind it, so it lives here
// rather than five times over.
//
// It used to be Tab, and that had to change. A window-level Tab handler that
// calls preventDefault swallows the ONE key the browser uses to move focus,
// so the keyboard focus ring could never move at all and "play the whole game
// from the keyboard" was impossible by construction -- not a rough edge, a
// hard block. Gating the Tab binding on "nothing is focused yet" doesn't
// rescue it either: focus starts on <body>, so the very first Tab (the one
// that would enter the focus order) is exactly the one that gets eaten, and
// the player is stuck on body forever.
//
// So Tab is released back to the browser and the shortcut moved to S. The
// SCORES item in the settings menu is unchanged and still the discoverable
// route; this is the accelerator for people who had the old one in their
// fingers.

import { useEffect } from 'react'

/** True while the caret is somewhere text is being typed. */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function useScoresheetShortcut(toggle: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 's' && event.key !== 'S') return
      if (isTyping(event.target)) return
      // Leave browser and OS shortcuts (Cmd-S, Ctrl-S) alone.
      if (event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])
}
