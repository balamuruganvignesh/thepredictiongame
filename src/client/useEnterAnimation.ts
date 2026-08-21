// Run an entrance animation exactly once, for elements that are genuinely NEW
// on screen.
//
// Every card motion in this app is an entrance: a card is dealt into your
// hand, lands in the trick, is turned face up in a Golf grid. React already
// tells us which of those are new -- a keyed list only mounts a fresh DOM node
// for an entry it didn't have before -- so this just needs to catch the mount
// and not re-fire on the re-renders that follow.
//
// Ref callbacks alone can't do it: an inline arrow is a new function every
// render, so React calls it with null then the element again on EVERY render,
// which would re-animate a card that has been sitting still for a minute.
// Hence the seen-set.
//
// The set is pruned against what's actually rendered, every render. Card keys
// repeat across rounds (the ace of spades is dealt many times a game), so a
// set that only ever grew would silently stop animating a card the second time
// it appeared.

import { useCallback, useRef } from 'react'

export function useEnterAnimation(currentKeys: string[]) {
  const seen = useRef(new Set<string>())

  // Pruned in the render body rather than an effect on purpose: ref callbacks
  // fire during commit, BEFORE effects run, so pruning in an effect would
  // always be one render too late -- the first deal of round 2 would still be
  // looking at round 1's set.
  const live = new Set(currentKeys)
  for (const key of seen.current) {
    if (!live.has(key)) seen.current.delete(key)
  }

  return useCallback(
    (key: string, play: (el: HTMLElement) => void) => (el: HTMLElement | null) => {
      if (!el || seen.current.has(key)) return
      seen.current.add(key)
      play(el)
    },
    [],
  )
}
