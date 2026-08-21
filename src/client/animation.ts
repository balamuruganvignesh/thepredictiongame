// Card motion: deal, flight, flip.
//
// Driven by the Web Animations API rather than an animation library. The
// three motions this app actually needs are all "animate this element from
// where something else was, once, on mount" -- FLIP, essentially -- and every
// one of them needs a rect measured at runtime (a card flies from wherever
// its hand slot happened to be, to wherever its trick slot happens to be).
// A declarative motion library would mean restructuring all five table
// components around motion-aware wrappers to express what `el.animate()`
// expresses directly, and shipping a dependency to a box that runs one Node
// process on 256mb. Everything below is ~100 lines with no runtime deps.
//
// CSS keyframes stay where they belong -- the winner punch, the veil, the
// modal entrance are all fire-and-forget with no measurement involved.
//
// EVERY animation here goes through `run()`, which is the single place the
// reduced-motion preference is honoured. That matters more than it looks:
// the `@media (prefers-reduced-motion: reduce)` block in tokens.css cannot
// reach a WAAPI animation at all, so without this gate the motion pref would
// silently apply to the CSS half of the app and not this half.

import { prefersReducedMotion } from './a11ySettings'

const EASE_OUT = 'cubic-bezier(0.22, 0.8, 0.3, 1)'
const EASE_POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/**
 * The one gate. Returns null (and leaves the element exactly as rendered)
 * when motion is off, so every caller is a no-op rather than a snap.
 */
function run(
  el: HTMLElement,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (prefersReducedMotion()) return null
  if (typeof el.animate !== 'function') return null
  return el.animate(keyframes, { fill: 'both', ...options })
}

// ---- Flight ------------------------------------------------------------------

/**
 * Where a card was on screen just before it left one place for another.
 *
 * Keyed by cardKey and read exactly once: the trick area needs the hand
 * slot's rect to fly from, but by the time the trick renders that card the
 * hand has already dropped it, so the rect has to be captured at the click
 * and stashed. Consuming on read is what stops a stale rect from a previous
 * round being used for the same card later in the game.
 */
const origins = new Map<string, DOMRect>()

export function rememberOrigin(key: string, el: Element | null) {
  if (el) origins.set(key, el.getBoundingClientRect())
}

export function takeOrigin(key: string): DOMRect | null {
  const rect = origins.get(key)
  if (rect) origins.delete(key)
  return rect ?? null
}

/** The on-screen rect of another seat's chip -- where THEIR cards fly from. */
export function seatOrigin(playerId: string): DOMRect | null {
  const chip = document.querySelector(`[data-player-id="${CSS.escape(playerId)}"]`)
  return chip ? chip.getBoundingClientRect() : null
}

/**
 * FLIP: the element is already laid out where it belongs, so animate it FROM
 * the offset/scale that would put it back at `from` and let it settle. Doing
 * it this way (rather than animating toward a measured destination) means the
 * final frame is the real layout, so nothing has to be cleaned up afterwards
 * and a mid-flight re-render can't strand the card somewhere wrong.
 */
export function flyFrom(el: HTMLElement, from: DOMRect | null, duration = 380): Animation | null {
  const to = el.getBoundingClientRect()
  if (!to.width || !to.height) return null

  // No known origin (a spectator's first paint, a reconnect mid-trick): fall
  // back to a plain pop rather than flying from nowhere in particular.
  if (!from || !from.width) {
    return run(
      el,
      [
        { transform: 'scale(0.72)', opacity: 0 },
        { transform: 'scale(1)', opacity: 1 },
      ],
      { duration: 260, easing: EASE_POP },
    )
  }

  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  const scale = from.width / to.width

  return run(
    el,
    [
      {
        transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-6deg)`,
        opacity: 0.9,
        offset: 0,
      },
      // A slight lift off the straight line, so the card arcs onto the table
      // instead of sliding along a ruler.
      {
        transform: `translate(${dx * 0.38}px, ${dy * 0.38 - 18}px) scale(${
          scale + (1 - scale) * 0.62
        }) rotate(-2deg)`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: 'none', opacity: 1, offset: 1 },
    ],
    { duration, easing: EASE_OUT },
  )
}

// ---- Deal --------------------------------------------------------------------

/**
 * A card arriving in your hand: in from off the top of the screen, spinning
 * down into its place in the fan, staggered by position so the hand reads as
 * dealt one card at a time rather than appearing all at once.
 */
export function dealIn(el: HTMLElement, index: number): Animation | null {
  return run(
    el,
    [
      {
        transform: `translate(${18 - index * 4}px, -220px) rotate(${-24 + index * 5}deg) scale(0.78)`,
        opacity: 0,
        offset: 0,
      },
      { transform: 'translate(0, 6px) rotate(2deg) scale(1.02)', opacity: 1, offset: 0.72 },
      { transform: 'none', opacity: 1, offset: 1 },
    ],
    { duration: 460, delay: index * 65, easing: EASE_OUT },
  )
}

// ---- Flip --------------------------------------------------------------------

/**
 * A face-down card turning over: Golf's grid reveals, Blackjack's hole card.
 *
 * A real two-sided flip would need the back and the face stacked in one
 * 3D-transformed container, which means changing the markup of every card
 * that could ever be flipped. This gets the read of a flip from the face
 * alone -- squeeze to nothing edge-on, then open out -- because the moment
 * the element exists it IS the face; the back was a different element that
 * has already been swapped out.
 */
export function flipIn(el: HTMLElement): Animation | null {
  return run(
    el,
    [
      { transform: 'perspective(600px) rotateY(-88deg) scale(0.94)', opacity: 0.4, offset: 0 },
      { transform: 'perspective(600px) rotateY(-38deg) scale(0.98)', opacity: 1, offset: 0.45 },
      { transform: 'perspective(600px) rotateY(12deg) scale(1.03)', opacity: 1, offset: 0.78 },
      { transform: 'none', opacity: 1, offset: 1 },
    ],
    { duration: 420, easing: EASE_OUT },
  )
}
