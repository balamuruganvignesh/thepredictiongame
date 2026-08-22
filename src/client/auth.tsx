// Who is signed in. Follows the same shape as deckStyle.tsx and
// a11ySettings.tsx -- a context, because the account is read from the
// landing screen and the settings menu, which sit at unrelated depths.
//
// The one thing this does beyond fetching: when the server hands back a
// canonical playerId that differs from the one in localStorage, it adopts it.
// That single line IS the cross-device mechanism -- Room.join already
// re-attaches an existing seat by playerId, so presenting the same id from a
// second device lands back in the same chair with no new machinery.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { rememberPlayerId, storedPlayerId } from './socket'

export type MeAccount = {
  playerId: string
  name: string | null
  picture: string | null
}

type AuthValue = {
  account: MeAccount | null
  /** False when the server has no Google credentials -- hide the button. */
  loginAvailable: boolean
  /** Null until the first /api/me settles, so the UI can avoid flashing. */
  ready: boolean
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Where the sign-in button points. */
export const loginHref = () => `/auth/google?anon=${encodeURIComponent(storedPlayerId() ?? '')}`

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<MeAccount | null>(null)
  const [loginAvailable, setLoginAvailable] = useState(false)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/me')
      const body = (await response.json()) as {
        account: MeAccount | null
        loginAvailable: boolean
      }
      setLoginAvailable(body.loginAvailable)
      setAccount(body.account)

      // Adopt the account's canonical id. Everything durable in this app --
      // seat re-attach, chaos role history, stats -- keys off this one
      // string, so swapping it here is the whole of "my history followed me
      // to this device".
      if (body.account && body.account.playerId !== storedPlayerId()) {
        rememberPlayerId(body.account.playerId)
      }
    } catch {
      // A failed /api/me means signed out, not broken: anonymous play is the
      // supported default, so there is nothing to report to the player.
      setAccount(null)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await fetch('/auth/logout', { method: 'POST' })
    // A full reload rather than clearing state: the socket resolved this
    // account at connect time and needs to hand its seat back as an
    // anonymous one, which only a fresh connection does.
    window.location.assign('/')
  }, [])

  const value = useMemo(
    () => ({ account, loginAvailable, ready, refresh, logout }),
    [account, loginAvailable, ready, refresh, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
