// Which card art to render -- purely a local display preference, not table
// state, so it lives in localStorage rather than in useGame's socket-fed
// store. A context (not prop drilling) because card components sit at every
// depth: Hand, TrickArea, PassModal, RolePanel, Join's DeckStack.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type DeckStyle = 'pixel' | 'classic'

const STORAGE_KEY = 'deckStyle'

const storedDeckStyle = (): DeckStyle =>
  localStorage.getItem(STORAGE_KEY) === 'classic' ? 'classic' : 'pixel'

const DeckStyleContext = createContext<{
  deck: DeckStyle
  setDeck: (deck: DeckStyle) => void
} | null>(null)

export function DeckStyleProvider({ children }: { children: ReactNode }) {
  const [deck, setDeckState] = useState<DeckStyle>(storedDeckStyle)

  // The face art's aspect ratio differs between decks (the classic deck's
  // photographed cards are narrower than the pixel deck's 42x60 sprites), so
  // tokens.css keys --card-aspect off this attribute instead of us threading
  // a ratio through every card wrapper.
  useEffect(() => {
    document.documentElement.setAttribute('data-deck', deck)
  }, [deck])

  const setDeck = (next: DeckStyle) => {
    localStorage.setItem(STORAGE_KEY, next)
    setDeckState(next)
  }

  const value = useMemo(() => ({ deck, setDeck }), [deck])

  return <DeckStyleContext.Provider value={value}>{children}</DeckStyleContext.Provider>
}

export function useDeckStyle() {
  const ctx = useContext(DeckStyleContext)
  if (!ctx) throw new Error('useDeckStyle must be used within a DeckStyleProvider')
  return ctx
}
