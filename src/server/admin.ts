// The admin API, behind its own login. Everything the /admin page reads or
// writes lives here, and none of it exists unless ADMIN_TOKEN is set.
//
// **404, never 401.** An unauthenticated request gets exactly what a request
// to an unconfigured server gets: nothing. There is no other auth in front of
// this app, and a 401 advertises that there is something here worth guessing
// at. Same posture /admin/status has always taken.
//
// The login is deliberately NOT the player's Google sign-in. That identifies
// who is playing; this authorises changing prices and wallets, and wiring the
// second to the first would mean one compromised Google session is also
// operator access.

import crypto from 'node:crypto'
import express from 'express'
import { describeGrant, formatCode } from './codes'
import { createCode, deleteCode, listCodes, type CodeRow } from './db/codes'
import { pricedItems, revertItem, setItemOverride } from './db/catalogue'
import { adjustCoins, getLedger, getRecentGames, searchPlayers } from './db/admin'
import { getOwned } from './db/shop'
import { getPlayerStats } from './db/stats'
import type { Room } from './room'
import { log } from './logger'

/** Sessions are in memory: one process hosts everything, and a restart logging
 * every operator out is the right side of that trade. */
const sessions = new Map<string, number>()
const SESSION_MS = 12 * 60 * 60 * 1000

// A brute-force floor. The token is a shared secret rather than a password, so
// this is about making an online guessing attack pointless, not about lockout
// policy -- hence a global counter with a short window and no per-account state.
const FAILURE_WINDOW_MS = 60_000
const MAX_FAILURES = 10
let failures: number[] = []

const parseCookies = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter((pair) => pair.length === 2)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  )

/** Length-independent comparison, so a wrong token can't be found a byte at a time. */
function tokenMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== 'string') return false
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length -- hash both sides to a fixed width first.
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function registerAdminRoutes(
  app: express.Express,
  context: { rooms: Map<string, Room>; startedAt: number },
): void {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN
  if (!ADMIN_TOKEN) return

  const validSession = (token: string | undefined): boolean => {
    if (!token) return false
    const expires = sessions.get(token)
    if (!expires) return false
    if (expires < Date.now()) {
      sessions.delete(token)
      return false
    }
    return true
  }

  /**
   * Either a live admin session cookie or `?token=` on the request. The query
   * form stays supported because a curl one-liner is the fastest way to mint
   * a code from a terminal, and it predates the page.
   */
  const requireAdmin = (req: express.Request, res: express.Response): boolean => {
    if (validSession(parseCookies(req.headers.cookie).pg_admin)) return true
    if (tokenMatches(req.query.token, ADMIN_TOKEN)) return true
    res.status(404).end()
    return false
  }

  // ---- Login -----------------------------------------------------------------

  app.post('/admin/login', express.json(), (req, res) => {
    failures = failures.filter((at) => at > Date.now() - FAILURE_WINDOW_MS)
    if (failures.length >= MAX_FAILURES) {
      res.status(429).json({ ok: false, error: 'Too many attempts. Wait a minute.' })
      return
    }
    if (!tokenMatches(req.body?.token, ADMIN_TOKEN)) {
      failures.push(Date.now())
      log.info('admin.login.failed', {})
      // A 404 here too: a wrong token must not confirm that the login exists.
      res.status(404).end()
      return
    }

    const session = crypto.randomBytes(24).toString('base64url')
    sessions.set(session, Date.now() + SESSION_MS)
    res.setHeader(
      'Set-Cookie',
      [
        `pg_admin=${session}`,
        'HttpOnly',
        'SameSite=Strict',
        'Path=/',
        `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
        // Dropped silently by the browser over plain http, which is how
        // localhost admin is reached -- same conditional the player session
        // cookie uses.
        ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
      ].join('; '),
    )
    log.info('admin.login.ok', {})
    res.json({ ok: true })
  })

  app.post('/admin/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).pg_admin
    if (token) sessions.delete(token)
    res.setHeader('Set-Cookie', 'pg_admin=; HttpOnly; Path=/; Max-Age=0')
    res.json({ ok: true })
  })

  /** Whether this browser is already signed in, so the page can skip the form. */
  app.get('/admin/session', (req, res) => {
    res.json({ ok: validSession(parseCookies(req.headers.cookie).pg_admin) })
  })

  // ---- Overview and the game log ---------------------------------------------

  app.get('/admin/status', (req, res) => {
    if (!requireAdmin(req, res)) return
    res.json({
      uptimeSeconds: Math.floor((Date.now() - context.startedAt) / 1000),
      roomCount: context.rooms.size,
      rooms: [...context.rooms.values()].map((room) => room.summary()),
    })
  })

  app.get('/admin/games', (req, res) => {
    if (!requireAdmin(req, res)) return
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    res.json({ games: getRecentGames(limit) })
  })

  // ---- Shop prices -------------------------------------------------------------

  app.get('/admin/items', (req, res) => {
    if (!requireAdmin(req, res)) return
    res.json({ items: pricedItems() })
  })

  app.post('/admin/items/:id', express.json(), (req, res) => {
    if (!requireAdmin(req, res)) return
    const result = setItemOverride(req.params.id, {
      price: typeof req.body?.price === 'number' ? req.body.price : undefined,
      hidden: typeof req.body?.hidden === 'boolean' ? req.body.hidden : undefined,
    })
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json({ ok: true, item: result.item })
  })

  /** Back to the catalogue price, by deleting the override rather than copying it. */
  app.delete('/admin/items/:id', (req, res) => {
    if (!requireAdmin(req, res)) return
    revertItem(req.params.id)
    res.json({ ok: true, items: pricedItems() })
  })

  // ---- Codes -------------------------------------------------------------------

  const codeJson = (row: CodeRow) => ({
    code: formatCode(row.code),
    grant: describeGrant(row),
    coverage: row.coverage,
    coins: row.coins,
    label: row.label,
    uses: row.uses,
    maxUses: row.max_uses,
    expiresAt: row.expires_at,
  })

  app.get('/admin/codes', (req, res) => {
    if (!requireAdmin(req, res)) return
    res.json({ codes: listCodes().map(codeJson) })
  })

  // `days` rather than a timestamp, because the useful question at mint time
  // is "how long should this last", and a hand-written epoch is the easiest
  // thing in this whole feature to get wrong by a factor of 1000.
  app.post('/admin/codes', express.json(), (req, res) => {
    if (!requireAdmin(req, res)) return
    const days = typeof req.body?.days === 'number' ? req.body.days : null
    const result = createCode({
      code: typeof req.body?.code === 'string' ? req.body.code : null,
      coverage: typeof req.body?.coverage === 'number' ? req.body.coverage : null,
      coins: typeof req.body?.coins === 'number' ? req.body.coins : null,
      label: typeof req.body?.label === 'string' ? req.body.label : null,
      maxUses: typeof req.body?.uses === 'number' ? req.body.uses : null,
      expiresAt: days ? Date.now() + days * 24 * 60 * 60 * 1000 : null,
    })
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json({ ok: true, code: codeJson(result.code) })
  })

  app.delete('/admin/codes/:code', (req, res) => {
    if (!requireAdmin(req, res)) return
    if (!deleteCode(req.params.code)) {
      res.status(404).json({ ok: false, error: 'No such code.' })
      return
    }
    res.json({ ok: true })
  })

  // ---- Players and wallets -----------------------------------------------------

  app.get('/admin/players', (req, res) => {
    if (!requireAdmin(req, res)) return
    const query = typeof req.query.q === 'string' ? req.query.q : ''
    res.json({ players: searchPlayers(query) })
  })

  app.get('/admin/players/:id', (req, res) => {
    if (!requireAdmin(req, res)) return
    const playerId = req.params.id
    res.json({
      stats: getPlayerStats(playerId),
      ledger: getLedger(playerId),
      owned: getOwned(playerId),
    })
  })

  app.post('/admin/players/:id/coins', express.json(), (req, res) => {
    if (!requireAdmin(req, res)) return
    const delta = typeof req.body?.delta === 'number' ? req.body.delta : 0
    const note = typeof req.body?.note === 'string' ? req.body.note : ''
    const result = adjustCoins(req.params.id, delta, note)
    if (!result.ok) {
      res.status(400).json(result)
      return
    }
    res.json({ ok: true, balance: result.balance, ledger: getLedger(req.params.id) })
  })
}
