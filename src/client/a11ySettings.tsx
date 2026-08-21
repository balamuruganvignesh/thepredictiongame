// Accessibility preferences: a four-colour suit badge for anyone who can't
// separate the red suits from the black ones, and an explicit motion switch.
//
// A context (not prop drilling) for the same reason ../deckStyle.tsx is one:
// PlayingCard sits at every depth -- Hand, TrickArea, PassModal, RolePanel,
// the Golf grids, the Blackjack hands. Both prefs also mirror onto <html> as
// data attributes so CSS can react without a class threading through anything.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * 'system' follows the OS `prefers-reduced-motion` setting. The other two are
 * a deliberate override in either direction -- someone on a shared machine
 * whose OS says "reduce" may still want the card flights, and someone whose
 * OS says nothing may still want them gone.
 */
export type MotionPref = 'system' | 'reduced' | 'full'

const COLORBLIND_KEY = 'a11yColorblindSuits'
const MOTION_KEY = 'a11yMotion'

const storedColorblind = (): boolean => localStorage.getItem(COLORBLIND_KEY) === 'on'

const storedMotion = (): MotionPref => {
  const raw = localStorage.getItem(MOTION_KEY)
  return raw === 'reduced' || raw === 'full' ? raw : 'system'
}

/**
 * THE one motion gate, readable outside React on purpose: the animation
 * module (./animation.ts) drives the Web Animations API directly, and WAAPI
 * animations are untouched by the CSS `prefers-reduced-motion` block in
 * tokens.css -- they have to ask. Every JS-driven animation in the app funnels
 * through here so the pref can never apply to half of them.
 */
export function prefersReducedMotion(): boolean {
  const pref = storedMotion()
  if (pref === 'reduced') return true
  if (pref === 'full') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type A11yValue = {
  colorblindSuits: boolean
  setColorblindSuits: (on: boolean) => void
  motion: MotionPref
  setMotion: (motion: MotionPref) => void
}

const A11yContext = createContext<A11yValue | null>(null)

export function A11yProvider({ children }: { children: ReactNode }) {
  const [colorblindSuits, setColorblindState] = useState(storedColorblind)
  const [motion, setMotionState] = useState<MotionPref>(storedMotion)

  useEffect(() => {
    document.documentElement.setAttribute('data-colorblind', colorblindSuits ? 'on' : 'off')
  }, [colorblindSuits])

  // tokens.css keys its reduced-motion rules off this attribute as well as the
  // media query, so 'full' can genuinely override an OS-level "reduce".
  useEffect(() => {
    document.documentElement.setAttribute('data-motion', motion)
  }, [motion])

  const value = useMemo<A11yValue>(
    () => ({
      colorblindSuits,
      setColorblindSuits: (on) => {
        localStorage.setItem(COLORBLIND_KEY, on ? 'on' : 'off')
        setColorblindState(on)
      },
      motion,
      setMotion: (next) => {
        localStorage.setItem(MOTION_KEY, next)
        setMotionState(next)
      },
    }),
    [colorblindSuits, motion],
  )

  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>
}

export function useA11y(): A11yValue {
  const ctx = useContext(A11yContext)
  if (!ctx) throw new Error('useA11y must be used within an A11yProvider')
  return ctx
}
