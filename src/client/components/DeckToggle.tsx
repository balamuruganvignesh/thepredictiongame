// Lets a player swap which card art renders -- pixel-art or the classic
// photographed deck. Purely local (see ../deckStyle.tsx), so it's a single
// button that cycles rather than anything synced through the table.

import { useDeckStyle } from '../deckStyle'

export function DeckToggleButton({ className = '' }: { className?: string }) {
  const { deck, setDeck } = useDeckStyle()
  const isClassic = deck === 'classic'

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={() => setDeck(isClassic ? 'pixel' : 'classic')}
      title={isClassic ? 'Switch to the pixel-art deck' : 'Switch to the classic deck'}
    >
      🎴 {isClassic ? 'CLASSIC' : 'PIXEL'}
    </button>
  )
}
