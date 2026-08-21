// Standalone page at /shop, added the same way /leaderboard and /scoresheet
// are: one pathname check in App.tsx and an early return. Plain REST for the
// same reason the leaderboard is -- a wallet is not table-scoped, so it
// doesn't belong on protocol.ts's event map.
//
// Coins come from placing in the top 3 of a finished game and from nowhere
// else. There is no real-money path anywhere in this app by design, so
// nothing here can fail halfway or need a refund.

import { useEffect, useState } from 'react'
import { PLACEMENT_COINS, type MeAccount, type ShopItem, type ShopKind } from '@shared/shop'
import { emoteById } from '@shared/emotes'
import { loginHref, useAuth } from '../auth'
import { useCosmetics } from '../theme'

const SECTIONS: { kind: ShopKind; title: string; blurb: string }[] = [
  { kind: 'theme', title: 'Themes', blurb: 'Repaint the whole table. Yours only — a palette is personal.' },
  { kind: 'cardback', title: 'Card backs', blurb: 'What everyone else sees across the table from you.' },
  { kind: 'emote', title: 'Emotes', blurb: 'Extra reactions in the React menu. The original eight stay free.' },
]

export function Shop() {
  const { account, loginAvailable, refresh } = useAuth()
  const { slots, equip } = useCosmetics()
  const [items, setItems] = useState<ShopItem[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/shop')
      .then((r) => r.json() as Promise<{ items: ShopItem[]; account: MeAccount | null }>)
      .then((body) => setItems(body.items))
      .catch(() => setError("Couldn't reach the shop."))
  }, [])

  const owned = account?.owned ?? []
  const coins = account?.coins ?? 0

  const buy = async (item: ShopItem) => {
    setBusy(item.id)
    setError(null)
    try {
      const response = await fetch('/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      })
      const body = (await response.json()) as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'That purchase did not go through.')
      else await refresh()
    } catch {
      setError("Couldn't reach the shop.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="irl-page">
      <header className="irl-header">
        <h1>Shop</h1>
        <a className="button button--ghost" href="/">
          Back to the tables
        </a>
      </header>

      <div className="note shop__wallet">
        {account ? (
          <>
            <span className="shop__coins">🪙 {coins}</span>
            <span className="shop__wallet-note">
              Finish in the top three of a game to earn {PLACEMENT_COINS.join(' / ')} coins.
            </span>
          </>
        ) : (
          <>
            <span className="shop__wallet-note">
              You can earn coins without an account — placing in the top three banks them against this
              browser, and they follow you the first time you sign in. Spending them needs an account.
            </span>
            {loginAvailable && (
              <a className="button button--accent" href={loginHref()}>
                Sign in with Google
              </a>
            )}
          </>
        )}
      </div>

      {error && <p className="join__status join__status--error">{error}</p>}

      {!items && <p className="leaderboard__empty">Loading…</p>}

      {items &&
        SECTIONS.map((section) => {
          const sectionItems = items.filter((item) => item.kind === section.kind)
          if (sectionItems.length === 0) return null
          return (
            <div className="note shop__section" key={section.kind}>
              <h2>{section.title}</h2>
              <p className="shop__section-blurb">{section.blurb}</p>
              <ul className="shop__grid">
                {sectionItems.map((item) => {
                  const isOwned = owned.includes(item.id)
                  // Themes and card backs are equippable slots; an emote is
                  // simply owned, and shows up in the React menu by itself.
                  const slot = section.kind === 'theme' || section.kind === 'cardback' ? section.kind : null
                  const equipped = slot != null && slots[slot] === item.id
                  return (
                    <li className="shop__item" key={item.id}>
                      <span
                        className="shop__swatch"
                        style={item.swatch ? { background: item.swatch } : undefined}
                        aria-hidden="true"
                      >
                        {item.kind === 'emote' ? (emoteById(item.id)?.glyph ?? '✨') : ''}
                      </span>
                      <div className="shop__item-body">
                        <h3>{item.name}</h3>
                        <p>{item.blurb}</p>
                      </div>
                      {isOwned ? (
                        slot ? (
                          <button
                            type="button"
                            className={`button ${equipped ? 'button--ghost' : 'button--accent'}`}
                            onClick={() => equip(slot, equipped ? '' : item.id)}
                          >
                            {equipped ? 'Unequip' : 'Equip'}
                          </button>
                        ) : (
                          <span className="shop__owned">Owned</span>
                        )
                      ) : (
                        <button
                          type="button"
                          className="button button--accent"
                          disabled={!account || busy === item.id || coins < item.price}
                          onClick={() => void buy(item)}
                          title={account ? undefined : 'Sign in to spend coins'}
                        >
                          🪙 {item.price}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
    </div>
  )
}
