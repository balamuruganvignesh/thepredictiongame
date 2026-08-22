// The two personal cosmetic slots: the table's palette and your card back.
// Same shape as deckStyle.tsx -- localStorage plus a data attribute on
// <html>, which is the mechanism tokens.css and cards.css already read for
// data-deck and data-motion.
//
// A THEME repaints your whole page and is deliberately personal: there's no
// way to apply someone else's full-page palette to your screen, so it is
// never broadcast. A CARD BACK is the opposite -- it's what the rest of the
// table looks at across from you.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** '' is the built-in look, which every player has by default. */
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
  const [slots, setSlots] = useState<Slots>(stored)

  useEffect(() => {
    for (const slot of ['theme', 'cardback'] as const) {
      const value = slots[slot]
      if (value) document.documentElement.setAttribute(ATTRIBUTES[slot], value)
      else document.documentElement.removeAttribute(ATTRIBUTES[slot])
    }
  }, [slots.theme, slots.cardback])

  const equip = (slot: keyof Slots, itemId: string) => {
    localStorage.setItem(STORAGE_KEYS[slot], itemId)
    setSlots((current) => ({ ...current, [slot]: itemId }))
  }

  const value = useMemo(() => ({ slots, equip }), [slots.theme, slots.cardback])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useCosmetics() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useCosmetics must be used within a ThemeProvider')
  return ctx
}
