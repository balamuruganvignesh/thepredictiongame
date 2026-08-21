// One tab stop for a whole row of buttons, with the arrow keys moving inside
// it -- the roving-tabindex pattern.
//
// Every "pick one of these" row in this app is long enough that individual
// tab stops make keyboard play miserable: a Spades hand is 13 cards and its
// bid row is 15 chips. It also fixes a subtler problem -- the rows contain
// deliberately un-actionable entries (a card you can't legally play, the last
// bidder's forbidden number) that must stay REACHABLE so a keyboard or screen
// reader user can find out they're there. That means `aria-disabled` rather
// than `disabled` at the call sites, since a disabled button is dropped from
// the focus order outright.

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function useRovingFocus(count: number, selector: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [focusIndex, setFocusIndex] = useState(0)

  // These rows shrink and get rewritten underneath us -- a hand loses a card
  // every trick, a Joker swap replaces it wholesale -- so the index has to be
  // clamped back into range or the row ends up with NO tabbable entry at all.
  const index = count === 0 ? 0 : Math.min(focusIndex, count - 1)
  useEffect(() => {
    if (index !== focusIndex) setFocusIndex(index)
  }, [index, focusIndex])

  const moveFocus = (next: number) => {
    if (count === 0) return
    const wrapped = (next + count) % count
    setFocusIndex(wrapped)
    containerRef.current?.querySelectorAll<HTMLElement>(selector)[wrapped]?.focus()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(index - 1)
        break
      case 'Home':
        event.preventDefault()
        moveFocus(0)
        break
      case 'End':
        event.preventDefault()
        moveFocus(count - 1)
        break
    }
  }

  /** Spread onto each entry: owns the single tab stop when it's the current one. */
  const itemProps = (i: number) => ({
    tabIndex: i === index ? 0 : -1,
    onFocus: () => setFocusIndex(i),
  })

  return { containerRef, onKeyDown, itemProps }
}
