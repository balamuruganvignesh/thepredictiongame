// Standalone page at /shop, added the same way /leaderboard and /scoresheet
// are: one pathname check in App.tsx and an early return. Plain REST for the
// same reason the leaderboard is -- a wallet is not table-scoped, so it
// doesn't belong on protocol.ts's event map.
//
// Coins come from placing in the top 3 of a finished game and from nowhere
// else. There is no real-money path anywhere in this app by design, so
// nothing here can fail halfway or need a refund.

import { useEffect, useState } from 'react'
import { PLACEMENT_COINS, type MeAccount, type ShopItem, type ShopKind, type Wallet } from '@shared/shop'
import { emoteById } from '@shared/emotes'
import { avatarById } from '@shared/avatars'
import { powerupById } from '@shared/powerups'
import { DEFAULT_DECK } from '@shared/decks'
import { loginHref, useAuth } from '../auth'
import { walletPlayerId } from '../socket'
import { useDeckStyle } from '../deckStyle'
import { useCosmetics } from '../theme'

/**
 * What sits on an item's colour chip. Themes and card backs supply a real
 * swatch colour instead, so they get nothing here.
 */
function swatchGlyph(item: ShopItem): string {
  switch (item.kind) {
    case 'emote':
      return emoteById(item.id)?.glyph ?? '✨'
    case 'avatar':
      return avatarById(item.id)?.glyph ?? '✨'
    case 'powerup':
      return powerupById(item.id)?.glyph ?? '⚡'
    case 'deck':
      return '🎴'
    default:
      return ''
  }
}

const SECTIONS: { kind: ShopKind; title: string; blurb: string }[] = [
  {
    kind: 'powerup',
    title: 'Powerups',
    blurb:
      'The only items that affect play. Bought in charges and spent during a round — and only at a table whose host has switched powerups on. The Prediction Game for now.',
  },
  { kind: 'theme', title: 'Themes', blurb: 'Repaint the whole table. Yours only — a palette is personal.' },
  {
    kind: 'deck',
    title: 'Decks',
    blurb:
      'Which card art you play on. The classic deck is free and stays the default — these sit alongside it.',
  },
  { kind: 'cardback', title: 'Card backs', blurb: 'Recolours every face-down card on your table. Works with either deck.' },
  { kind: 'avatar', title: 'Avatars', blurb: 'Extra profile logos. The twelve free ones stay free.' },
  { kind: 'emote', title: 'Emotes', blurb: 'Extra reactions in the React menu. The original eight stay free.' },
]

export function Shop() {
  const { account, loginAvailable, refresh } = useAuth()
  const { slots, equip } = useCosmetics()
  // The deck is an equippable slot like the other two, but it lives in its
  // own context because its free option is a VALUE ('classic') rather than
  // the absence of one -- see deckStyle.tsx.
  const { deck: equippedDeck, setDeck } = useDeckStyle()
  const [items, setItems] = useState<ShopItem[] | null>(null)
  const [charges, setCharges] = useState<Record<string, number>>({})
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeStatus, setCodeStatus] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)

  type ShopResponse = {
    items: ShopItem[]
    charges?: Record<string, number>
    wallet: Wallet | null
    account: MeAccount | null
  }

  // The playerId rides along on every shop call: a signed-out browser spends
  // against the id in its own localStorage, which is the id that earned the
  // coins. A signed-in caller's id comes from the session cookie server-side
  // and this one is ignored.
  const playerId = walletPlayerId()

  const loadShop = async () => {
    const body = (await fetch(
      `/api/shop?playerId=${encodeURIComponent(playerId)}`,
    ).then((r) => r.json())) as ShopResponse
    setItems(body.items)
    setCharges(body.charges ?? {})
    setWallet(body.wallet)
  }

  useEffect(() => {
    void loadShop().catch(() => setError("Couldn't reach the shop."))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The wallet is the authority for both, since it exists for anonymous
  // players too; the account only adds who is signed in.
  const owned = wallet?.owned ?? account?.owned ?? []
  const coins = wallet?.coins ?? account?.coins ?? 0

  const buy = async (item: ShopItem) => {
    setBusy(item.id)
    setError(null)
    try {
      const response = await fetch('/api/shop/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, playerId }),
      })
      const body = (await response.json()) as { ok: boolean; error?: string }
      if (!body.ok) setError(body.error ?? 'That purchase did not go through.')
      else {
        await refresh()
        await loadShop()
      }
    } catch {
      setError("Couldn't reach the shop.")
    } finally {
      setBusy(null)
    }
  }

  const redeem = async () => {
    if (!code.trim()) return
    setRedeeming(true)
    setCodeStatus(null)
    try {
      const response = await fetch('/api/shop/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), playerId }),
      })
      const body = (await response.json()) as { ok: boolean; granted?: number; error?: string }
      if (!body.ok) setCodeStatus(body.error ?? 'That code did not work.')
      else {
        setCodeStatus(`Code accepted — ${body.granted} coins added.`)
        setCode('')
        await refresh()
        await loadShop()
      }
    } catch {
      setCodeStatus("Couldn't reach the shop.")
    } finally {
      setRedeeming(false)
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
        <span className="shop__coins">🪙 {coins}</span>
        <span className="shop__wallet-note">
          Finish in the top three of a game to earn {PLACEMENT_COINS.join(' / ')} coins.
          {!account &&
            ' Coins and purchases are kept against this browser — sign in and they follow you to any device.'}
        </span>
        {!account && loginAvailable && (
          <a className="button button--ghost" href={loginHref()}>
            Sign in with Google
          </a>
        )}
      </div>

      <div className="note shop__redeem">
        <h2>Got a code?</h2>
        <p className="shop__section-blurb">
          Codes are handed out, not sold. Each one works once per player and tops your wallet up to
          what it covers — coins you already have count toward it.
        </p>
        <form
          className="shop__redeem-row"
          onSubmit={(event) => {
            event.preventDefault()
            void redeem()
          }}
        >
          <input
            className="shop__redeem-input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ENTER CODE"
            aria-label="Redeem code"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="button button--accent" disabled={redeeming || !code.trim()}>
            {redeeming ? 'Checking…' : 'Redeem'}
          </button>
        </form>
        {codeStatus && <p className="shop__redeem-status">{codeStatus}</p>}
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
                  const slot =
                    section.kind === 'theme' || section.kind === 'cardback' || section.kind === 'deck'
                      ? section.kind
                      : null
                  const equippedHere =
                    slot === 'deck' ? equippedDeck : slot ? slots[slot] : null
                  const equipped = slot != null && equippedHere === item.id
                  const toggleEquip = () => {
                    if (slot === 'deck') setDeck(equipped ? DEFAULT_DECK : item.id)
                    else if (slot) equip(slot, equipped ? '' : item.id)
                  }
                  return (
                    <li className="shop__item" key={item.id}>
                      <span
                        className="shop__swatch"
                        style={item.swatch ? { background: item.swatch } : undefined}
                        aria-hidden="true"
                      >
                        {swatchGlyph(item)}
                      </span>
                      <div className="shop__item-body">
                        <h3>
                          {item.name}
                          {item.consumable && (charges[item.id] ?? 0) > 0 && (
                            <span className="shop__charges"> ×{charges[item.id]}</span>
                          )}
                        </h3>
                        <p>{item.blurb}</p>
                      </div>
                      {isOwned && item.consumable ? (
                        // A consumable is never "Owned" -- it's a stack you
                        // can always add to, so the button keeps its price
                        // and just reports what you're holding.
                        <button
                          type="button"
                          className="button button--accent"
                          disabled={busy === item.id || coins < item.price}
                          onClick={() => void buy(item)}
                          title={`You hold ${charges[item.id] ?? 0}`}
                        >
                          🪙 {item.price}
                        </button>
                      ) : isOwned ? (
                        slot ? (
                          <button
                            type="button"
                            className={`button ${equipped ? 'button--ghost' : 'button--accent'}`}
                            onClick={toggleEquip}
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
                          disabled={busy === item.id || coins < item.price}
                          onClick={() => void buy(item)}
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
