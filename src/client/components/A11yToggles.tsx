// The two accessibility switches in the settings popover. Purely local
// prefs, like the deck / sound / effects toggles beside them -- see
// ../a11ySettings.
//
// Motion cycles three ways rather than toggling two, because "follow the OS"
// has to stay reachable: a player who overrode it once should be able to hand
// the decision back to their system setting without clearing localStorage.

import { useA11y, type MotionPref } from '../a11ySettings'

const NEXT_MOTION: Record<MotionPref, MotionPref> = {
  system: 'reduced',
  reduced: 'full',
  full: 'system',
}

const MOTION_LABEL: Record<MotionPref, string> = {
  system: '🎬 MOTION: AUTO',
  reduced: '🎬 MOTION: OFF',
  full: '🎬 MOTION: ON',
}

const MOTION_HINT: Record<MotionPref, string> = {
  system: 'Following your system’s reduced-motion setting — click to turn motion off',
  reduced: 'Card flights and deals are off — click to force them on',
  full: 'Card flights and deals are on — click to follow your system setting again',
}

export function ColorblindToggleButton({ className = '' }: { className?: string }) {
  const { colorblindSuits, setColorblindSuits } = useA11y()

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={() => setColorblindSuits(!colorblindSuits)}
      aria-pressed={colorblindSuits}
      title={
        colorblindSuits
          ? 'Hide the four-colour rank/suit badge on every card'
          : 'Show a four-colour rank/suit badge on every card'
      }
    >
      🔤 SUIT LABELS: {colorblindSuits ? 'ON' : 'OFF'}
    </button>
  )
}

export function MotionToggleButton({ className = '' }: { className?: string }) {
  const { motion, setMotion } = useA11y()

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={() => setMotion(NEXT_MOTION[motion])}
      title={MOTION_HINT[motion]}
    >
      {MOTION_LABEL[motion]}
    </button>
  )
}
