// Which card art to render. It used to be a purely local pixel/classic
// toggle; it is now an EQUIPPABLE SLOT like the theme and the card back --
// the classic deck is free and the default, and every other skin is bought
// with coins (see shared/decks.ts and the 'deck' entries in shared/shop.ts).
//
// Same three-part shape as theme.tsx, and for the same reasons:
//  1. localStorage plus a data attribute on <html>, which is the mechanism
//     tokens.css and cards.css already read for data-theme and data-motion.
//  2. A skin is only applied if it is OWNED. The server re-checks this on
//     equip, so this isn't the gate; what it prevents is a stale localStorage
//     value outliving the item it names -- or surviving from before the decks
//     were paywalled at all.
//  3. Equipping mirrors up to the server, so the choice follows the player to
//     another device the way their history does.
//
// It stays its own context rather than folding into theme.tsx's generic slot
// loop because of one real difference: this attribute is ALWAYS set, never
// removed. The free deck is a value ('classic'), not the absence of one, and
// cards.css keys the classic art's aspect ratio and smoothing off it.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEFAULT_DECK, deckArt, deckById, type DeckArt } from '@shared/decks'
import type { ShopKind } from '@shared/shop'
import { useAuth } from './auth'

const STORAGE_KEY = 'deckSkin'

const storedDeck = (): string => localStorage.getItem(STORAGE_KEY) || DEFAULT_DECK

const DeckStyleContext = createContext<{
  /** The equipped skin id -- 'classic' when nothing else is owned/picked. */
  deck: string
  /** Which sprite folder that skin draws from. */
  art: DeckArt
  setDeck: (deck: string) => void
} | null>(null)

export function DeckStyleProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth()
  const [deck, setDeckState] = useState<string>(storedDeck)

  // The server is the source of truth once it has spoken -- a deck bought on
  // a phone should already be equipped here without re-picking it.
  useEffect(() => {
    if (!account) return
    const next = account.equipped.deck ?? DEFAULT_DECK
    localStorage.setItem(STORAGE_KEY, next)
    setDeckState(next)
  }, [account])

  const skin = deckById(deck)
  const owned = !skin || !skin.premium || (account?.owned.includes(deck) ?? false)
  const active = owned ? deck : DEFAULT_DECK

  useEffect(() => {
    document.documentElement.setAttribute('data-deck', active)
  }, [active])

  const setDeck = (next: string) => {
    localStorage.setItem(STORAGE_KEY, next)
    setDeckState(next)
    void fetch('/api/shop/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // The free deck is an UNEQUIP server-side: there is no shop item called
      // 'classic' to own, so sending the id would be rejected.
      body: JSON.stringify({
        kind: 'deck' satisfies ShopKind,
        itemId: next === DEFAULT_DECK ? null : next,
      }),
    }).catch(() => {
      // Signed out, or offline. The local preference still applied, which is
      // the part the player can see -- there's nothing useful to say here.
    })
  }

  const value = useMemo(() => ({ deck: active, art: deckArt(active), setDeck }), [active])

  return <DeckStyleContext.Provider value={value}>{children}</DeckStyleContext.Provider>
}

export function useDeckStyle() {
  const ctx = useContext(DeckStyleContext)
  if (!ctx) throw new Error('useDeckStyle must be used within a DeckStyleProvider')
  return ctx
}
