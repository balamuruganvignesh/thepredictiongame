// The operator's console at /admin: live tables, the game log, shop prices,
// redeem codes, and player wallets.
//
// It is its OWN login, deliberately not the player's Google sign-in. That one
// says who is playing; this one authorises changing prices and wallets, and
// wiring the second to the first would mean one compromised Google session is
// also operator access. The token goes to /admin/login once and comes back as
// an HttpOnly cookie, so it never sits in a URL or in browser history.
//
// Every route it talks to 404s when ADMIN_TOKEN is unset or the session is
// missing -- so this page is inert rather than dangerous on a server that
// never configured it, and the panels simply show what a signed-out visitor
// sees: nothing.

import { useCallback, useEffect, useState, type ReactNode } from 'react'

type Tab = 'tables' | 'games' | 'shop' | 'codes' | 'players'

type RoomSummary = {
  code: string
  gameType: string
  gameName: string
  gameState: string
  players: number
  spectators: number
  lastActivity: number
}

type AdminGame = {
  id: number
  roomCode: string
  gameName: string
  roundNumber: number | null
  aborted: boolean
  endedAt: number
  players: { playerId: string; name: string; totalScore: number; rank: number }[]
}

type PricedItem = {
  id: string
  kind: string
  name: string
  price: number
  basePrice: number | null
  hidden: boolean
}

type AdminCode = {
  code: string
  grant: string
  label: string
  uses: number
  maxUses: number | null
  expiresAt: number | null
}

type PlayerRow = {
  playerId: string
  name: string
  lastSeen: number
  coins: number
  gamesPlayed: number
  email: string | null
}

type LedgerEntry = { id: number; delta: number; reason: string; createdAt: number }

type PlayerDetail = {
  stats: { playerId: string; name: string | null; gamesPlayed: number; wins: number }
  ledger: LedgerEntry[]
  owned: string[]
}

const when = (ms: number) => (ms ? new Date(ms).toLocaleString() : '—')

/** Every admin call goes through here so a lapsed session lands in one place. */
async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!response.ok) return null
  return (await response.json()) as T
}

export function Admin() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [token, setToken] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('tables')

  useEffect(() => {
    void api<{ ok: boolean }>('/admin/session').then((body) => setAuthed(body?.ok ?? false))
  }, [])

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoginError(null)
    const response = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (response.ok) {
      setToken('')
      setAuthed(true)
    } else {
      // A wrong token and an unconfigured server are the same 404 on purpose,
      // so the copy can't distinguish them either.
      setLoginError(
        response.status === 429
          ? 'Too many attempts. Wait a minute.'
          : 'That token was not accepted.',
      )
    }
  }

  const signOut = async () => {
    await fetch('/admin/logout', { method: 'POST' })
    setAuthed(false)
  }

  if (authed === null) return <div className="irl-page">Loading…</div>

  if (!authed) {
    return (
      <div className="irl-page admin admin--login">
        <div className="note admin__login-card">
          <h1>Admin</h1>
          <p className="shop__section-blurb">
            This is not your player sign-in. Enter the server's admin token.
          </p>
          <form className="shop__redeem-row" onSubmit={signIn}>
            <input
              className="shop__redeem-input admin__token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="ADMIN TOKEN"
              aria-label="Admin token"
              autoComplete="off"
            />
            <button type="submit" className="button button--accent" disabled={!token}>
              Sign in
            </button>
          </form>
          {loginError && <p className="join__status join__status--error">{loginError}</p>}
        </div>
      </div>
    )
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'tables', label: 'Live tables' },
    { id: 'games', label: 'Game log' },
    { id: 'shop', label: 'Shop & prices' },
    { id: 'codes', label: 'Codes' },
    { id: 'players', label: 'Players' },
  ]

  return (
    <div className="irl-page admin">
      <header className="irl-header">
        <h1>Admin</h1>
        <div className="admin__header-actions">
          <a className="button button--ghost" href="/">
            Back to the tables
          </a>
          <button type="button" className="button button--ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="admin__tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`admin__tab ${tab === entry.id ? 'admin__tab--on' : ''}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'tables' && <TablesPanel />}
      {tab === 'games' && <GamesPanel />}
      {tab === 'shop' && <ShopPanel />}
      {tab === 'codes' && <CodesPanel />}
      {tab === 'players' && <PlayersPanel />}
    </div>
  )
}

function Panel({ title, blurb, children }: { title: string; blurb?: string; children: ReactNode }) {
  return (
    <div className="note shop__section">
      <h2>{title}</h2>
      {blurb && <p className="shop__section-blurb">{blurb}</p>}
      {children}
    </div>
  )
}

// ---- Live tables --------------------------------------------------------------

function TablesPanel() {
  const [status, setStatus] = useState<{ uptimeSeconds: number; rooms: RoomSummary[] } | null>(null)

  // Polled rather than pushed: this page is not a socket client, and a table
  // list that is a few seconds stale is fine for looking over the server's
  // shoulder.
  useEffect(() => {
    const load = () =>
      void api<{ uptimeSeconds: number; rooms: RoomSummary[] }>('/admin/status').then(setStatus)
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  const hours = status ? Math.floor(status.uptimeSeconds / 3600) : 0
  const minutes = status ? Math.floor((status.uptimeSeconds % 3600) / 60) : 0

  return (
    <Panel title="Live tables" blurb={`Server up ${hours}h ${minutes}m. Refreshes every 5 seconds.`}>
      {status && status.rooms.length === 0 && <p className="leaderboard__empty">No tables open.</p>}
      {status && status.rooms.length > 0 && (
        <div className="admin__table-wrap">
          <table className="admin__table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Game</th>
                <th>State</th>
                <th>Seats</th>
                <th>Watching</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {status.rooms.map((room) => (
                <tr key={room.code}>
                  <td className="admin__mono">{room.code}</td>
                  <td>{room.gameName}</td>
                  <td>{room.gameState}</td>
                  <td>{room.players}</td>
                  <td>{room.spectators}</td>
                  <td>{when(room.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ---- Game log -----------------------------------------------------------------

function GamesPanel() {
  const [games, setGames] = useState<AdminGame[] | null>(null)

  useEffect(() => {
    void api<{ games: AdminGame[] }>('/admin/games?limit=100').then((body) =>
      setGames(body?.games ?? []),
    )
  }, [])

  return (
    <Panel
      title="Game log"
      blurb="Every finished game, newest first. Abandoned games (a restart vote) are included and flagged — they're the ones the public leaderboard hides."
    >
      {games?.length === 0 && <p className="leaderboard__empty">No games recorded yet.</p>}
      <ul className="admin__log">
        {games?.map((game) => (
          <li key={game.id} className="admin__log-row">
            <div className="admin__log-head">
              <span className="admin__mono">{game.roomCode}</span>
              <strong>{game.gameName}</strong>
              {game.aborted && <span className="admin__flag">left early</span>}
              <span className="admin__log-when">{when(game.endedAt)}</span>
            </div>
            <div className="admin__log-players">
              {game.players.map((player) => (
                <span key={player.playerId + player.rank} className="admin__chip">
                  {player.rank}. {player.name} <em>{player.totalScore}</em>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ---- Shop prices ---------------------------------------------------------------

function ShopPanel() {
  const [items, setItems] = useState<PricedItem[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const body = await api<{ items: PricedItem[] }>('/admin/items')
    setItems(body?.items ?? [])
    setDrafts({})
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (item: PricedItem, changes: { price?: number; hidden?: boolean }) => {
    setError(null)
    const body = await api<{ ok: boolean }>(`/admin/items/${item.id}`, {
      method: 'POST',
      body: JSON.stringify(changes),
    })
    if (!body) setError('That change was rejected.')
    await load()
  }

  const revert = async (item: PricedItem) => {
    await api(`/admin/items/${item.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <Panel
      title="Shop & prices"
      blurb="Prices apply immediately — the shop, the buy check and what a coverage code is worth all read the same number. Revert puts an item back to the price in the catalogue."
    >
      {error && <p className="join__status join__status--error">{error}</p>}
      <div className="admin__table-wrap">
        <table className="admin__table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Kind</th>
              <th>Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items?.map((item) => {
              const draft = drafts[item.id] ?? String(item.price)
              const dirty = draft !== String(item.price)
              return (
                <tr key={item.id} className={item.hidden ? 'admin__row--off' : undefined}>
                  <td>
                    {item.name}
                    {item.basePrice != null && (
                      <span className="admin__was"> was {item.basePrice}</span>
                    )}
                  </td>
                  <td>{item.kind}</td>
                  <td>
                    <input
                      className="admin__price"
                      value={draft}
                      inputMode="numeric"
                      aria-label={`${item.name} price`}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td className="admin__row-actions">
                    <button
                      type="button"
                      className="button button--accent button--small"
                      disabled={!dirty}
                      onClick={() => void save(item, { price: Number(draft) })}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void save(item, { hidden: !item.hidden })}
                    >
                      {item.hidden ? 'Show' : 'Hide'}
                    </button>
                    {(item.basePrice != null || item.hidden) && (
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void revert(item)}
                      >
                        Revert
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ---- Codes ----------------------------------------------------------------------

function CodesPanel() {
  const [codes, setCodes] = useState<AdminCode[] | null>(null)
  const [shape, setShape] = useState<'coverage' | 'coins'>('coverage')
  const [amount, setAmount] = useState('1')
  const [code, setCode] = useState('')
  const [uses, setUses] = useState('')
  const [days, setDays] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    const body = await api<{ codes: AdminCode[] }>('/admin/codes')
    setCodes(body?.codes ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mint = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus(null)
    const response = await fetch('/admin/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code || undefined,
        [shape]: Number(amount),
        uses: uses ? Number(uses) : undefined,
        days: days ? Number(days) : undefined,
      }),
    })
    const body = (await response.json().catch(() => null)) as
      | { ok: boolean; error?: string; code?: AdminCode }
      | null
    if (!body?.ok) setStatus(body?.error ?? 'That code was rejected.')
    else {
      setStatus(`Created ${body.code!.code} — ${body.code!.grant}`)
      setCode('')
    }
    await load()
  }

  const revoke = async (target: string) => {
    await api(`/admin/codes/${encodeURIComponent(target)}`, { method: 'DELETE' })
    await load()
  }

  return (
    <>
      <Panel
        title="Mint a code"
        blurb="Coverage is a fraction of the shop, priced live and topping a wallet up to it. Coins is a flat amount that simply adds. Leave the code blank to have one generated."
      >
        <form className="admin__form" onSubmit={mint}>
          <label className="admin__field">
            <span>Grant</span>
            <select
              value={shape}
              onChange={(event) => {
                const next = event.target.value as 'coverage' | 'coins'
                setShape(next)
                setAmount(next === 'coverage' ? '1' : '500')
              }}
            >
              <option value="coverage">Coverage (0–1)</option>
              <option value="coins">Coins</option>
            </select>
          </label>
          <label className="admin__field">
            <span>{shape === 'coverage' ? 'Fraction' : 'Coins'}</span>
            <input value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="admin__field">
            <span>Code (optional)</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="auto" />
          </label>
          <label className="admin__field">
            <span>Max uses</span>
            <input value={uses} onChange={(event) => setUses(event.target.value)} placeholder="∞" />
          </label>
          <label className="admin__field">
            <span>Expires in days</span>
            <input value={days} onChange={(event) => setDays(event.target.value)} placeholder="never" />
          </label>
          <button type="submit" className="button button--accent">
            Mint
          </button>
        </form>
        {status && <p className="shop__redeem-status">{status}</p>}
      </Panel>

      <Panel title="Codes">
        {codes?.length === 0 && <p className="leaderboard__empty">No codes.</p>}
        {codes && codes.length > 0 && (
          <div className="admin__table-wrap">
            <table className="admin__table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Grant</th>
                  <th>Uses</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {codes.map((entry) => (
                  <tr key={entry.code}>
                    <td className="admin__mono">{entry.code}</td>
                    <td>{entry.grant}</td>
                    <td>
                      {entry.uses}
                      {entry.maxUses != null ? ` / ${entry.maxUses}` : ''}
                    </td>
                    <td>{entry.expiresAt ? when(entry.expiresAt) : '—'}</td>
                    <td className="admin__row-actions">
                      <button
                        type="button"
                        className="button button--ghost button--small"
                        onClick={() => void revoke(entry.code)}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  )
}

// ---- Players and wallets ----------------------------------------------------------

function PlayersPanel() {
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState<PlayerRow[] | null>(null)
  const [selected, setSelected] = useState<PlayerRow | null>(null)
  const [detail, setDetail] = useState<PlayerDetail | null>(null)
  const [delta, setDelta] = useState('')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<string | null>(null)

  const search = useCallback(async (q: string) => {
    const body = await api<{ players: PlayerRow[] }>(`/admin/players?q=${encodeURIComponent(q)}`)
    setPlayers(body?.players ?? [])
  }, [])

  useEffect(() => {
    void search('')
  }, [search])

  const open = async (player: PlayerRow) => {
    setSelected(player)
    setStatus(null)
    setDetail(await api<PlayerDetail>(`/admin/players/${encodeURIComponent(player.playerId)}`))
  }

  const adjust = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setStatus(null)
    const response = await fetch(`/admin/players/${encodeURIComponent(selected.playerId)}/coins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: Number(delta), note }),
    })
    const body = (await response.json().catch(() => null)) as
      | { ok: boolean; error?: string; balance?: number; ledger?: LedgerEntry[] }
      | null
    if (!body?.ok) {
      setStatus(body?.error ?? 'That adjustment was rejected.')
      return
    }
    setStatus(`Balance is now ${body.balance}.`)
    setDelta('')
    setNote('')
    setDetail((current) => (current ? { ...current, ledger: body.ledger ?? current.ledger } : current))
    // The header reads the SELECTED row's balance, so refreshing only the
    // list would leave the number the operator just changed showing its old
    // value right above the form that changed it.
    setSelected((current) => (current ? { ...current, coins: body.balance ?? current.coins } : current))
    await search(query)
  }

  return (
    <>
      <Panel
        title="Players"
        blurb="Anyone with a game, a wallet or an account — including anonymous ids that have never sat at a table."
      >
        <form
          className="shop__redeem-row"
          onSubmit={(event) => {
            event.preventDefault()
            void search(query)
          }}
        >
          <input
            className="shop__redeem-input admin__search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="name, id or email"
            aria-label="Search players"
          />
          <button type="submit" className="button button--accent">
            Search
          </button>
        </form>

        <div className="admin__table-wrap">
          <table className="admin__table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Id</th>
                <th>Coins</th>
                <th>Games</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {players?.map((player) => (
                <tr key={player.playerId}>
                  <td>{player.name || <em>anonymous</em>}</td>
                  <td className="admin__mono admin__id">{player.playerId}</td>
                  <td>🪙 {player.coins}</td>
                  <td>{player.gamesPlayed}</td>
                  <td className="admin__row-actions">
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => void open(player)}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {selected && (
        <Panel
          title={selected.name || selected.playerId}
          blurb="An adjustment is an ordinary ledger row with an admin: reason, so it shows up in the same history as every other coin."
        >
          <p className="admin__detail-line">
            🪙 {selected.coins} · {detail?.stats.gamesPlayed ?? 0} games · {detail?.stats.wins ?? 0}{' '}
            wins · {detail?.owned.length ?? 0} items owned
          </p>

          <form className="admin__form" onSubmit={adjust}>
            <label className="admin__field">
              <span>Coins (+/−)</span>
              <input value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="100" />
            </label>
            <label className="admin__field admin__field--wide">
              <span>Note</span>
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="why this adjustment"
              />
            </label>
            <button type="submit" className="button button--accent" disabled={!delta}>
              Apply
            </button>
          </form>
          {status && <p className="shop__redeem-status">{status}</p>}

          <ul className="admin__ledger">
            {detail?.ledger.map((entry) => (
              <li key={entry.id}>
                <span className={entry.delta < 0 ? 'admin__debit' : 'admin__credit'}>
                  {entry.delta > 0 ? '+' : ''}
                  {entry.delta}
                </span>
                <span>{entry.reason}</span>
                <span className="admin__log-when">{when(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  )
}
