// The two equippable cosmetic slots: the table's palette and your card back.
// Same shape as deckStyle.tsx -- localStorage plus a data attribute on
// <html>, which is the mechanism tokens.css and cards.css already read for
// data-deck and data-motion -- with two additions:
//
//  1. A slot is only applied if the item is OWNED. The server re-checks this
//     on equip, so this isn't the gate; what it prevents is a stale
//     localStorage value outliving the item it names.
//  2. Equipping mirrors up to the server, so the choice follows the player to
//     another device the same way their history does.
//
// A THEME repaints your whole page and is deliberately personal: there's no
// way to apply someone else's full-page palette to your screen, so it is
// never broadcast. A CARD BACK is the opposite -- it's what the rest of the
// table looks at across from you.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ShopKind } from '@shared/shop'
import { useAuth } from './auth'
import { walletPlayerId } from './socket'

/** '' is the built-in look, which every player has without buying anything. */
type Slots = { theme: string; cardback: string }

const STORAGE_KEYS: Record<keyof Slots, string> = { theme: 'theme', cardback: 'cardback' }
const ATTRIBUTES: Record<keyof Slots, string> = { theme: 'data-theme', cardback: 'data-cardback' }

const stored = (): Slots => ({
  theme: localStorage.getItem(STORAGE_KEYS.theme) ?? '',
  cardback: localStorage.getItem(STORAGE_KEYS.cardback) ?? '',
})

const ThemeContext = createContext<{
  slots: Slots
  equip: (slot: keyof Slots, itemId: string) => void
} | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The WALLET, not the account: an anonymous player buys and equips too, so
  // ownership can't be gated on being signed in.
  const { wallet } = useAuth()
  const [slots, setSlots] = useState<Slots>(stored)

  // The server is the source of truth once it has spoken -- something bought
  // on a phone should already be equipped here without re-picking it.
  useEffect(() => {
    if (!wallet) return
    const next: Slots = {
      theme: wallet.equipped.theme ?? '',
      cardback: wallet.equipped.cardback ?? '',
    }
    localStorage.setItem(STORAGE_KEYS.theme, next.theme)
    localStorage.setItem(STORAGE_KEYS.cardback, next.cardback)
    setSlots(next)
  }, [wallet])

  const ownsOrDefault = (id: string) => !id || (wallet?.owned.includes(id) ?? false)
  const active: Slots = {
    theme: ownsOrDefault(slots.theme) ? slots.theme : '',
    cardback: ownsOrDefault(slots.cardback) ? slots.cardback : '',
  }

  useEffect(() => {
    for (const slot of ['theme', 'cardback'] as const) {
      const value = active[slot]
      if (value) document.documentElement.setAttribute(ATTRIBUTES[slot], value)
      else document.documentElement.removeAttribute(ATTRIBUTES[slot])
    }
  }, [active.theme, active.cardback])

  const equip = (slot: keyof Slots, itemId: string) => {
    localStorage.setItem(STORAGE_KEYS[slot], itemId)
    setSlots((current) => ({ ...current, [slot]: itemId }))
    void fetch('/api/shop/equip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Anonymous players equip too, against the id in their own storage;
      // a signed-in caller's id comes from the session cookie server-side.
      body: JSON.stringify({
        kind: slot satisfies ShopKind,
        itemId: itemId || null,
        playerId: walletPlayerId(),
      }),
    }).catch(() => {
      // Signed out, or offline. The local preference still applied, which is
      // the part the player can see -- there's nothing useful to say here.
    })
  }

  const value = useMemo(() => ({ slots: active, equip }), [active.theme, active.cardback])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useCosmetics() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useCosmetics must be used within a ThemeProvider')
  return ctx
}
