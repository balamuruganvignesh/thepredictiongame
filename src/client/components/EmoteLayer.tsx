// Reactions floating over the table.
//
// Anchored to seat positions read at fire time off `[data-player-id]` --
// the same trick EffectLayer uses, and for the same reason: the chip row
// wraps at 7+ players and the Golf/Blackjack panels reflow, so a ref captured
// earlier would point at the wrong place by the time a burst plays.
//
// Distinct from chat and from the roleAnnounce feed by construction, not by
// convention: this renders bursts that delete themselves, and nothing here
// ever reaches the chat log (see Room.emote for the server half).

import { useEffect, useRef } from 'react'
import type { EmoteBurst } from '@shared/protocol'
import { emoteById } from '@shared/emotes'
import { prefersReducedMotion } from '../a11ySettings'

const BURST_MS = 1500

export function EmoteLayer({
  emotes,
  names,
  onDismiss,
}: {
  emotes: (EmoteBurst & { key: number })[]
  names: Record<string, string>
  onDismiss: (key: number) => void
}) {
  if (emotes.length === 0) return null
  return (
    <div className="emote-layer">
      {emotes.map((burst) => (
        <Burst
          key={burst.key}
          burst={burst}
          name={names[burst.from] ?? 'someone'}
          onDone={() => onDismiss(burst.key)}
        />
      ))}
    </div>
  )
}

/**
 * Where to draw a seat's burst, in viewport coordinates.
 *
 * Clamped into view rather than used raw. The anchor can legitimately be
 * off-screen -- the chip row scrolls away on a short viewport, and a Golf or
 * Blackjack panel can be below the fold on a phone -- and a burst that lands
 * where the anchor really is would then be a reaction nobody ever sees. The
 * whole point of a reaction is that the table notices it, so an anchor that
 * has drifted out of view pins to the nearest edge instead.
 */
function seatCenter(id: string): { x: number; y: number } | null {
  const el = document.querySelector<HTMLElement>(`[data-player-id="${CSS.escape(id)}"]`)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2

  // Clamp only against bounds we actually trust. A viewport reporting 0 (a
  // backgrounded tab, a page mid-restore) would otherwise pin every burst to
  // the same corner -- worse than not clamping at all, since the raw anchor is
  // at least in the right place the moment layout settles.
  const width = window.innerWidth
  const height = window.innerHeight
  if (width <= 0 || height <= 0) return { x, y }

  // Enough room for the glyph and its float, which travels upward.
  const margin = 56
  const clamp = (value: number, max: number) =>
    Math.min(Math.max(value, margin), Math.max(margin, max - margin))
  return { x: clamp(x, width), y: clamp(y, height) }
}

function Burst({
  burst,
  name,
  onDone,
}: {
  burst: EmoteBurst
  name: string
  onDone: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The parent re-renders constantly during a round; hold the latest callback
  // in a ref so the timer below never restarts and strands an entry.
  const doneRef = useRef(onDone)
  doneRef.current = onDone

  useEffect(() => {
    const el = ref.current
    const at = seatCenter(burst.from)
    if (el && at) {
      el.style.left = `${at.x}px`
      el.style.top = `${at.y}px`
    } else if (el) {
      // No anchor on screen (a seat that just left, a layout mid-reflow):
      // put it somewhere harmless rather than at 0,0 in the corner.
      el.style.left = '50%'
      el.style.top = '18%'
    }

    if (el && !prefersReducedMotion()) {
      el.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0, offset: 0 },
          { transform: 'translate(-50%, -110%) scale(1.15)', opacity: 1, offset: 0.28 },
          { transform: 'translate(-50%, -170%) scale(1)', opacity: 1, offset: 0.7 },
          { transform: 'translate(-50%, -230%) scale(0.9)', opacity: 0, offset: 1 },
        ],
        { duration: BURST_MS, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'both' },
      )
    }

    // The timer runs whether or not the animation did, so a reduced-motion
    // table still clears its queue instead of stacking bursts forever -- the
    // same split EffectLayer keeps between its visuals and its dismiss timer.
    const timer = setTimeout(() => doneRef.current(), BURST_MS)
    return () => clearTimeout(timer)
  }, [burst.from])

  const emote = emoteById(burst.emote)
  if (!emote) return null

  return (
    <div className="emote-burst" ref={ref}>
      <span className="emote-burst__glyph" aria-hidden="true">
        {emote.glyph}
      </span>
      {/* The reaction in words, for anyone who can't see it float. */}
      <span className="sr-only">
        {name} reacted: {emote.label}
      </span>
    </div>
  )
}
