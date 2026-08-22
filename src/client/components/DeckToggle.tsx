// Lets a player swap card art mid-game. It cycles rather than opening a
// picker because it lives in the settings popover, where a second nested
// menu would be two clicks deep for a preference you set once.

import { availableDecks } from '@shared/decks'
import { useDeckStyle } from '../deckStyle'

export function DeckToggleButton({ className = '' }: { className?: string }) {
  const { deck, setDeck } = useDeckStyle()

  const decks = availableDecks()
  const index = decks.findIndex((skin) => skin.id === deck)
  const next = decks[(index + 1) % decks.length]
  const current = decks[index === -1 ? 0 : index]

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={() => setDeck(next.id)}
      title={`Switch to the ${next.label} deck`}
    >
      🎴 {current.label.toUpperCase()}
    </button>
  )
}
