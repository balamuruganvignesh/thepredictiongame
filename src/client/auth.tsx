// Who is signed in, and the wallet that comes with them. Follows the same
// shape as deckStyle.tsx and a11ySettings.tsx -- a context, because the
// account is read from the landing screen, the settings menu and the shop
// page, which sit at unrelated depths.
//
// The one thing this does beyond fetching: when the server hands back a
// canonical playerId that differs from the one in localStorage, it adopts it.
// That single line IS the cross-device mechanism -- Room.join already
// re-attaches an existing seat by playerId, so presenting the same id from a
// second device lands back in the same chair with no new machinery.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MeAccount, Wallet } from '@shared/shop'
import { rememberPlayerId, storedPlayerId, walletPlayerId } from './socket'

type AuthValue = {
  account: MeAccount | null
  /**
   * What this player owns and has equipped, signed in or not. Anonymous
   * players buy and equip too, so every cosmetic gate reads THIS rather than
   * `account` -- which now only answers "who is signed in".
   */
  wallet: Wallet | null
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
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [loginAvailable, setLoginAvailable] = useState(false)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      // The anonymous id is minted here if this browser has never had one:
      // a wallet has to be keyed by something durable to be spendable, and
      // /shop is reachable before anyone has ever sat at a table.
      const response = await fetch(`/api/me?playerId=${encodeURIComponent(walletPlayerId())}`)
      const body = (await response.json()) as {
        account: MeAccount | null
        wallet: Wallet | null
        loginAvailable: boolean
      }
      setLoginAvailable(body.loginAvailable)
      setAccount(body.account)
      setWallet(body.wallet)

      // Adopt the account's canonical id. Everything durable in this app --
      // seat re-attach, chaos role history, stats, the wallet -- keys off
      // this one string, so swapping it here is the whole of "my history
      // followed me to this device".
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
    () => ({ account, wallet, loginAvailable, ready, refresh, logout }),
    [account, wallet, loginAvailable, ready, refresh, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
