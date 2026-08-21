// Cycles through the themes this player owns, plus the built-in look. Same
// single-cycling-button shape as DeckToggleButton, for the same reason: a
// palette is a local display preference, not table state.
//
// It only ever offers what's owned, so a player with nothing bought sees no
// button at all rather than a menu item that leads nowhere.

import { shopItemsOfKind } from '@shared/shop'
import { useAuth } from '../auth'
import { useCosmetics } from '../theme'

export function ThemeToggleButton({ className = '' }: { className?: string }) {
  const { account } = useAuth()
  const { slots, equip } = useCosmetics()

  const owned = shopItemsOfKind('theme').filter((item) => account?.owned.includes(item.id))
  if (owned.length === 0) return null

  // '' is the default look and is always in the rotation, so there's a way
  // back to it without owning anything extra.
  const cycle = ['', ...owned.map((item) => item.id)]
  const next = cycle[(cycle.indexOf(slots.theme) + 1) % cycle.length]
  const label = owned.find((item) => item.id === slots.theme)?.name ?? 'DEFAULT'

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
