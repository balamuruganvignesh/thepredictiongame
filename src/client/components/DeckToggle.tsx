// Lets a player swap card art mid-game. It cycles rather than opening a
// picker because it lives in the settings popover, where a second nested
// menu would be two clicks deep for a preference you set once.
//
// It only ever cycles skins you OWN (the free classic deck always among
// them), so this is never a button that lands you on a padlock -- the shop
// and the landing screen's picker are where an unowned deck is advertised.

import { availableDecks } from '@shared/decks'
import { useAuth } from '../auth'
import { useDeckStyle } from '../deckStyle'

export function DeckToggleButton({ className = '' }: { className?: string }) {
  const { deck, setDeck } = useDeckStyle()
  const { account } = useAuth()

  const decks = availableDecks(account?.owned ?? [])
  const index = decks.findIndex((skin) => skin.id === deck)
  const next = decks[(index + 1) % decks.length]
  const current = decks[index === -1 ? 0 : index]

  return (
    <button
      className={`dock__button ${className}`.trim()}
      // One owned deck means there is nothing to cycle to; the button stays
      // visible as a label of what you're playing on rather than vanishing.
      disabled={decks.length < 2}
      onClick={() => setDeck(next.id)}
      title={decks.length < 2 ? 'Buy another deck in the shop' : `Switch to the ${next.label} deck`}
    >
      🎴 {current.label.toUpperCase()}
    </button>
  )
}
