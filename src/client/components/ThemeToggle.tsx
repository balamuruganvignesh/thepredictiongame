// Cycles through the available table palettes, plus the built-in look. Same
// single-cycling-button shape as DeckToggleButton, for the same reason: a
// palette is a local display preference, not table state.

import { THEMES } from '@shared/themes'
import { useCosmetics } from '../theme'

export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { slots, equip } = useCosmetics()

  // '' is the default look and is always in the rotation, so there's a way
  // back to it.
  const cycle = ['', ...THEMES.map((theme) => theme.id)]
  const next = cycle[(cycle.indexOf(slots.theme) + 1) % cycle.length]
  const label = THEMES.find((theme) => theme.id === slots.theme)?.name ?? 'DEFAULT'

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={() => equip('theme', next)}
      title="Change the table's colours"
    >
      🎨 {label.toUpperCase()}
    </button>
  )
}
