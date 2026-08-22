// Which card art to render. A purely local pixel/classic (and friends)
// toggle, mirrored onto <html> as a data attribute the way tokens.css and
// cards.css already read data-theme and data-motion.
//
// It stays its own context rather than folding into theme.tsx's generic slot
// loop because of one real difference: this attribute is ALWAYS set, never
// removed. The free deck is a value ('classic'), not the absence of one, and
// cards.css keys the classic art's aspect ratio and smoothing off it.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_DECK, deckArt, type DeckArt } from '@shared/decks'

const STORAGE_KEY = 'deckSkin'

const storedDeck = (): string => localStorage.getItem(STORAGE_KEY) || DEFAULT_DECK

const DeckStyleContext = createContext<{
  /** The equipped skin id -- 'classic' when nothing else is picked. */
  deck: string
  /** Which sprite folder that skin draws from. */
  art: DeckArt
  setDeck: (deck: string) => void
} | null>(null)

export function DeckStyleProvider({ children }: { children: ReactNode }) {
  const [deck, setDeckState] = useState<string>(storedDeck)

  useEffect(() => {
    document.documentElement.setAttribute('data-deck', deck)
  }, [deck])

  const setDeck = (next: string) => {
    localStorage.setItem(STORAGE_KEY, next)
    setDeckState(next)
  }

  const value = useMemo(() => ({ deck, art: deckArt(deck), setDeck }), [deck])

  return <DeckStyleContext.Provider value={value}>{children}</DeckStyleContext.Provider>
}

export function useDeckStyle() {
  const ctx = useContext(DeckStyleContext)
  if (!ctx) throw new Error('useDeckStyle must be used within a DeckStyleProvider')
  return ctx
}
