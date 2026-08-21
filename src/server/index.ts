// Game server: an Express app for the built client plus a Socket.IO layer that
// carries the protocol in src/shared/protocol.ts. Every table is a Socket.IO
// room keyed by its 4-letter code, so one process hosts many games at once.

import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import compression from 'compression'
import express from 'express'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol'
import { Room } from './room'
import type { Seat, Spectator } from './types'
import { log } from './logger'
import { captureError } from './errorTracking'
import { getLeaderboard, getPlayerStats } from './db/stats'
import {
  accountForSession,
  createSession,
  destroySession,
  parseCookies,
  reapExpiredSessions,
  upsertAccount,
  SESSION_MAX_AGE_SECONDS,
  type Account,
} from './db/accounts'
import { buyItem, equipItem, getBalance, getCharges, getEquipped, getOwned } from './db/shop'
import { authUrl, exchangeCode, googleConfigured } from './auth/google'
import { SHOP_ITEMS, type MeAccount } from '@shared/shop'
import { AVATARS, GOOGLE_AVATAR, isSelectableAvatar } from '@shared/avatars'
import { redis, redisSub } from './redis'
import { registerRoom, refreshRoom, removeRoom } from './roomDirectory'

const PORT = Number(process.env.PORT ?? 3001)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const startedAt = Date.now()

// One process hosts EVERY table, so Node's default of dying on an unhandled
// error would drop every game in progress at once. Log and keep serving: a
// broken round is far better than kicking the whole site off. The round loop's
// phases are async, so a throw in there surfaces as an unhandled rejection and
// would otherwise be completely silent.
process.on('uncaughtException', (error) => {
  log.error('uncaughtException', { error: String(error) })
  captureError('uncaughtException', error)
})
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', { reason: String(reason) })
  captureError('unhandledRejection', reason)
})

const app = express()
const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: true },
})

// With REDIS_URL unset (the default), this whole block doesn't run and
// nothing about broadcast behavior changes from before. With it set, a
// broadcast to a room made on THIS process also reaches sockets connected to
// any other instance in the same room -- necessary groundwork for more than
// one machine, but not sufficient on its own (see redis.ts).
if (redis && redisSub) {
  io.adapter(createAdapter(redis, redisSub))
  log.info('redis.adapter.enabled')
}

// ---- Room registry -----------------------------------------------------------

const rooms = new Map<string, Room>()

// No I/O/1/0: room codes get read aloud and typed in by hand.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = ''
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    if (!rooms.has(code)) return code
  }
  throw new Error('Could not allocate a room code')
}

// Sweep out tables nobody has touched in a while, so abandoned rooms don't
// hold their codes (or their memory) forever.
const ROOM_TTL_MS = 2 * 60 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.isEmpty && now - room.lastActivity > ROOM_TTL_MS) {
      rooms.delete(code)
      removeRoom(code)
      log.info('room.reaped', { code })
    } else {
      refreshRoom(code)
    }
  }
  // One heartbeat is enough for a process that hosts every table -- an
  // expired-session sweep does not deserve an interval of its own.
  reapExpiredSessions()
}, 10 * 60 * 1000)

// ---- Socket wiring -----------------------------------------------------------

io.on('connection', (socket) => {
  // Which table and chair this socket is currently driving. A spectator holds
  // a viewerId but never resolves to a seat, so every gameplay handler below
  // silently ignores them -- watching is read-only by construction.
  let room: Room | null = null
  let seatId: string | null = null

  // Resolved once, at connect, from the session cookie that rode along with
  // the handshake. Signed in or not is fixed for the life of the socket --
  // logging in reloads the page, which reconnects.
  const account: Account | null = accountForSession(
    parseCookies(socket.handshake.headers.cookie).pg_session,
  )

  /** Every gameplay handler needs the same "are you actually seated?" check. */
  const withSeat = (fn: (room: Room, seat: Seat) => void) => {
    const currentRoom = room
    const currentSeat = currentRoom && seatId ? currentRoom.getSeat(seatId) : undefined
    if (!currentRoom || !currentSeat) return
    fn(currentRoom, currentSeat)
  }

  /** Resolves to a seat if they have one, otherwise to a spectator. */
  const withViewer = (fn: (room: Room, seat: Seat | null, spectator: Spectator | null) => void) => {
    const currentRoom = room
    if (!currentRoom || !seatId) return
    const seat = currentRoom.getSeat(seatId) ?? null
    const spectator = seat ? null : (currentRoom.getSpectator(seatId) ?? null)
    if (!seat && !spectator) return
    fn(currentRoom, seat, spectator)
  }

  socket.on('join', ({ roomCode, name, playerId, gameType, avatar }) => {
    if (room) return // already seated on this socket

    let target: Room
    if (roomCode) {
      const code = String(roomCode).trim().toUpperCase()
      const existing = rooms.get(code)
      if (!existing) {
        socket.emit('joinError', `No table with the code ${code}.`)
        return
      }
      target = existing
    } else {
      target = new Room(newRoomCode(), io)
      // Only ever on a table that doesn't exist yet: the creator picked the
      // game on the landing screen. Joiners by code inherit whatever the table
      // already is.
      if (gameType) target.openOn(gameType)
      rooms.set(target.code, target)
      registerRoom(target.code)
      log.info('room.created', { code: target.code })
    }

    // A signed-in socket's identity comes from its session, never from the
    // payload: the client-supplied playerId is just a string on the wire and
    // trusting it would let anyone claim a stranger's history, wallet and
    // seat. Anonymous players keep sending their own localStorage id exactly
    // as before, which is what keeps that path unchanged.
    const claimedId = account ? account.playerId : playerId ? String(playerId) : null

    const known = claimedId
      ? target.getSeat(claimedId) != null || target.getSpectator(claimedId) != null
      : false
    // Resolved once here rather than on every reaction: Room must not do a
    // synchronous SQLite read on a hot path in the process that hosts every
    // table. A brand-new anonymous id owns nothing, so this is only ever a
    // real query for a returning or signed-in player.
    const owned = claimedId ? getOwned(claimedId) : []

    // A signed-in player's avatar comes from their account (so it follows
    // them across devices); an anonymous one sends their own from
    // localStorage. Either way it is validated against what they actually
    // own before it can reach anyone else's screen -- the same rule the
    // premium emote check follows.
    const requested = account ? (getEquipped(account.playerId).avatar ?? null) : (avatar ?? null)
    const chosen = requested && isSelectableAvatar(requested, owned) ? requested : null
    const profile =
      chosen === GOOGLE_AVATAR
        ? { avatar: null, avatarUrl: account?.picture ?? null }
        : { avatar: chosen, avatarUrl: null }

    const result = target.join(String(name ?? ''), claimedId, socket.id, owned, profile)
    if ('error' in result) {
      socket.emit('joinError', result.error)
      return
    }

    room = target
    void socket.join(target.code)

    if ('spectator' in result) {
      const { spectator } = result
      seatId = spectator.id
      socket.emit('joined', {
        playerId: spectator.id,
        roomCode: target.code,
        name: spectator.name,
        spectating: true,
      })
      target.sendChatHistoryToSocket(socket.id)
      if (!known) target.systemChat(`${spectator.name} is watching.`)
      target.broadcastLobby()
      // The table's restart vote counts who is waiting for a chair -- this
      // arrival is exactly what makes calling one worth it.
      target.broadcastRestartVote()
      target.sendState(spectator)
      return
    }

    seatId = result.seat.id

    socket.emit('joined', {
      playerId: result.seat.id,
      roomCode: target.code,
      name: result.seat.name,
      spectating: false,
    })
    target.sendChatHistory(result.seat)
    target.systemChat(
      known ? `${result.seat.name} is back.` : `${result.seat.name} joined the table.`,
    )
    target.broadcastLobby()
    // Mid-game rejoin: replay the whole table state onto their empty client.
    if (target.gameState !== 'Lobby') target.sendState(result.seat)

    // Charges are private, so they ride `send` on join rather than the
    // roster -- nobody else needs to know what you're holding.
    target.sendPowerupCharges(result.seat)
  })

  socket.on('toggleReady', (ready) => withSeat((r, s) => r.setReady(s, ready === true)))
  socket.on('startGame', () => withSeat((r, s) => r.startGame(s)))
  socket.on('setMode', (mode) => withSeat((r, s) => r.setMode(s, mode)))
  socket.on('setGameType', (gameType) => withSeat((r, s) => r.setGameType(s, gameType)))
  socket.on('setTargetScore', (score) => withSeat((r, s) => r.setTargetScore(s, Number(score))))
  socket.on('setHoleCount', (holes) => withSeat((r, s) => r.setHoleCount(s, Number(holes))))
  socket.on('setTournamentGames', (games) => withSeat((r, s) => r.setTournamentGames(s, games ?? [])))
  socket.on('passCards', (cards) => withSeat((r, s) => r.passCards(s, cards)))
  socket.on('golfRevealInitial', (slots) => withSeat((r, s) => r.golfRevealInitial(s, slots)))
  socket.on('golfDraw', (source) => withSeat((r, s) => r.golfDraw(s, source)))
  socket.on('golfResolve', (action) => withSeat((r, s) => r.golfResolve(s, action)))
  socket.on('setBlackjackMode', (mode) => withSeat((r, s) => r.setBlackjackMode(s, mode)))
  socket.on('setBlackjackRounds', (rounds) => withSeat((r, s) => r.setBlackjackRounds(s, Number(rounds))))
  socket.on('blackjackAction', (action) => withSeat((r, s) => r.blackjackAction(s, action)))
  socket.on('setSpadesTargetScore', (score) => withSeat((r, s) => r.setSpadesTargetScore(s, Number(score))))
  socket.on('setPublic', (isPublic) => withSeat((r, s) => r.setPublic(s, isPublic === true)))
  // withSeat, not withViewer: the burst is drawn over the sender's own place
  // at the table, and a spectator hasn't got one. They still have chat.
  socket.on('emote', (emoteId) => withSeat((r, s) => r.emote(s, String(emoteId ?? ''))))
  socket.on('submitSpadesBid', (bid) => withSeat((r, s) => r.submitSpadesBid(s, bid)))
  socket.on('submitBid', (bid) => withSeat((r, s) => r.submitBid(s, Number(bid))))
  socket.on('submitRebid', (bid) => withSeat((r, s) => r.submitRebid(s, Number(bid))))
  socket.on('declareDouble', () => withSeat((r, s) => r.declareDouble(s)))
  socket.on('playCard', (card) => withSeat((r, s) => r.playCard(s, card)))
  socket.on('useAbility', (payload) => withSeat((r, s) => r.useAbility(s, payload ?? {})))
  // Seated players only: a spectator can't vote to end the game they're waiting on.
  socket.on('voteRestart', (vote) => withSeat((r, s) => r.voteRestart(s, vote !== false)))
  // Watching and talking are the two things a spectator CAN do.
  socket.on('requestState', () =>
    withViewer((r, seat, spectator) => r.sendState(seat ?? spectator!)),
  )
  // withViewer, not withSeat: someone stuck spectating a game they can't
  // join yet is exactly who benefits most from being able to look back at
  // the round that just went by.
  socket.on('requestReplay', () =>
    withViewer((r, seat, spectator) => r.sendReplay(seat ?? spectator!)),
  )
  // Seated players hold no spectator identity, so this is silently a no-op
  // for them -- picking a hand to watch only makes sense without one of your own.
  socket.on('watchSeat', (targetSeatId) =>
    withViewer((r, seat, spectator) => {
      if (!seat && spectator) r.watchSeat(spectator, targetSeatId ? String(targetSeatId) : null)
    }),
  )
  socket.on('setPowerups', (enabled) => withSeat((r, seat) => r.setPowerups(seat, Boolean(enabled))))

  socket.on('usePowerup', (data) =>
    withSeat((r, seat) =>
      r.usePowerup(
        seat,
        String(data?.powerupId ?? ''),
        data?.targetId ? String(data.targetId) : undefined,
      ),
    ),
  )

  socket.on('chat', (text) =>
    withViewer((r, seat, spectator) => {
      if (seat) r.chat(seat, String(text ?? ''))
      else r.spectatorChat(spectator!, String(text ?? ''))
    }),
  )

  socket.on('disconnect', () => {
    withViewer((r, seat, spectator) => {
      if (seat) {
        // Only announce a real departure -- if this socket has already been
        // replaced by a reconnect, detach() is a no-op and nobody left.
        if (seat.socketId === socket.id) r.systemChat(`${seat.name} left.`)
        r.detach(seat, socket.id)
      } else {
        r.detachSpectator(spectator!, socket.id)
      }
    })
    room = null
    seatId = null
  })
})

// ---- Player stats / leaderboard --------------------------------------------------

// Cross-game, not table-scoped, so these are plain REST rather than an
// addition to the Socket.IO protocol in protocol.ts -- that stays the single
// source of truth for anything a live table sends. Public reads: no PII
// beyond a display name already visible to anyone at a table, and there's no
// auth system anywhere in this app to gate them behind anyway.
app.get('/api/leaderboard', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100)
  res.json(getLeaderboard(limit))
})

app.get('/api/players/:id/stats', (req, res) => {
  res.json(getPlayerStats(req.params.id))
})

// ---- Accounts, wallet and shop ---------------------------------------------------

// The whole auth surface is off unless Google is configured -- with the env
// vars unset these routes are never registered at all, the same "the route
// does not exist by default" posture /admin/status takes below. That is what
// lets a fork, a fresh clone or a local dev box run with no config and behave
// exactly as it did before any of this existed.
//
// Anonymous play is never gated. Signing in buys you one identity across
// devices and the ability to spend coins; it is never a precondition for
// sitting down at a table.

/** Reads the caller's account from the session cookie, or null. */
const sessionAccount = (req: express.Request): Account | null =>
  accountForSession(parseCookies(req.headers.cookie).pg_session)

const sessionCookie = (token: string) =>
  [
    `pg_session=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    // Secure must be conditional: over plain http on localhost the browser
    // drops a Secure cookie silently and dev login fails with no error.
    ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
  ].join('; ')

/** What /api/me and the shop routes both return for a player. */
function meFor(account: Account): MeAccount {
  return {
    playerId: account.playerId,
    name: account.name,
    picture: account.picture,
    coins: getBalance(account.playerId),
    owned: getOwned(account.playerId),
    equipped: getEquipped(account.playerId),
  }
}

if (googleConfigured) {
  app.get('/auth/google', (req, res) => {
    // The anonymous playerId rides along so the callback can adopt it as the
    // account's canonical id and carry every past game over. It is not a
    // secret -- it is already broadcast to every table this player joins.
    const anon = typeof req.query.anon === 'string' ? req.query.anon : ''
    const state = crypto.randomBytes(16).toString('base64url')

    res.setHeader('Set-Cookie', [
      `pg_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
      `pg_oauth_anon=${encodeURIComponent(anon)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
    ])
    res.redirect(authUrl(state))
  })

  app.get('/auth/google/callback', (req, res) => {
    void (async () => {
      const cookies = parseCookies(req.headers.cookie)
      const code = typeof req.query.code === 'string' ? req.query.code : null
      const state = typeof req.query.state === 'string' ? req.query.state : null

      // CSRF: the state we minted must come back on both the redirect AND the
      // cookie. Without this, a third party could walk a logged-in browser
      // through a login to an account they control.
      if (!code || !state || state !== cookies.pg_oauth_state) {
        res.redirect('/?login=failed')
        return
      }

      const profile = await exchangeCode(code)
      if (!profile) {
        res.redirect('/?login=failed')
        return
      }

      const account = upsertAccount(profile, cookies.pg_oauth_anon || null)
      const token = createSession(account.id)

      res.setHeader('Set-Cookie', [
        sessionCookie(token),
        'pg_oauth_state=; Path=/; Max-Age=0',
        'pg_oauth_anon=; Path=/; Max-Age=0',
      ])
      // Back to the landing screen: the client reads /api/me on boot, sees a
      // canonical playerId that differs from its stored one, and adopts it.
      res.redirect('/?login=ok')
    })()
  })

  app.post('/auth/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie).pg_session
    if (token) destroySession(token)
    res.setHeader('Set-Cookie', 'pg_session=; HttpOnly; Path=/; Max-Age=0')
    res.json({ ok: true })
  })
}

// Always registered, even with Google unconfigured: the client asks on every
// boot and a 404 would be indistinguishable from a network failure.
app.get('/api/me', (req, res) => {
  const account = sessionAccount(req)
  res.json({
    loginAvailable: googleConfigured,
    account: account ? meFor(account) : null,
  })
})

// Catalogue plus your own wallet in ONE request, so the shop page renders
// from a single fetch. The catalogue half is public: a signed-out visitor can
// window-shop and see what placing well is worth.
app.get('/api/shop', (req, res) => {
  const account = sessionAccount(req)
  res.json({
    items: SHOP_ITEMS,
    avatars: AVATARS,
    charges: account ? getCharges(account.playerId) : {},
    account: account ? meFor(account) : null,
  })
})

// Buying is the one thing anonymous players cannot do -- there is nowhere
// durable to put a purchase made by a browser that may clear its storage
// tomorrow. Coins still ACCRUE anonymously and come along on first sign-in.
app.post('/api/shop/buy', express.json(), (req, res) => {
  const account = sessionAccount(req)
  if (!account) {
    res.status(401).json({ ok: false, error: 'Sign in to spend coins.' })
    return
  }

  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : ''
  const result = buyItem(account.playerId, itemId)
  if (!result.ok) {
    res.status(400).json(result)
    return
  }
  res.json({ ok: true, account: meFor(account) })
})

// Ownership is re-checked server-side. The shop page hiding a button is a
// courtesy; a hand-rolled POST is not.
app.post('/api/shop/equip', express.json(), (req, res) => {
  const account = sessionAccount(req)
  if (!account) {
    res.status(401).json({ ok: false, error: 'Sign in first.' })
    return
  }

  const kind = req.body?.kind
  if (kind !== 'theme' && kind !== 'cardback' && kind !== 'avatar') {
    res.status(400).json({ ok: false, error: 'Unknown slot.' })
    return
  }

  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : null
  const result = equipItem(account.playerId, kind, itemId)
  if (!result.ok) {
    res.status(400).json(result)
    return
  }
  res.json({ ok: true, account: meFor(account) })
})

// ---- Public table browser --------------------------------------------------------

// Cross-table, not table-scoped, so it's REST for the same reason the
// leaderboard is -- protocol.ts stays the source of truth for what a live
// table sends to the people already at it, and this is a stranger asking
// what's out there.
//
// Opt-in only: Room.publicListing() returns null unless the host explicitly
// listed the table, and also for tables that are mid-game, empty or full,
// since none of those are joinable anyway. That means the busiest possible
// response is a handful of rows, so there's no pagination here.
//
// The payload carries no player ids and no game state -- just a room code
// (which is already the shareable invite), the host's display name, and how
// many seats are taken.
app.get('/api/tables', (_req, res) => {
  const tables = [...rooms.values()]
    .map((room) => room.publicListing())
    .filter((listing) => listing != null)
    // Freshest first: a table someone just opened is the one most likely to
    // still be waiting for players.
    .sort((a, b) => b!.lastActivity - a!.lastActivity)
  res.json(tables)
})

// ---- Admin status --------------------------------------------------------------

// Off by default: with ADMIN_TOKEN unset the route doesn't exist at all,
// rather than existing and rejecting every request -- the difference matters
// on a public host with no other auth in front of it. The token travels as a
// query param for a plain-browser-friendly URL; this endpoint carries no
// player PII beyond display names already visible to anyone at the table, so
// that tradeoff is acceptable here.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN
if (ADMIN_TOKEN) {
  app.get('/admin/status', (req, res) => {
    if (req.query.token !== ADMIN_TOKEN) {
      res.status(404).end()
      return
    }
    res.json({
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      roomCount: rooms.size,
      rooms: [...rooms.values()].map((room) => room.summary()),
    })
  })
}

// ---- Static client ------------------------------------------------------------

const clientDir = path.resolve(__dirname, '../client')

// Socket.IO intercepts /socket.io before Express sees it and does its own
// framing, so this only ever touches the static client -- where it matters:
// the bundle is ~3x smaller over the wire gzipped.
app.use(compression())

app.use(
  express.static(clientDir, {
    setHeaders(res, filePath) {
      // Vite content-hashes everything under /assets, so those URLs can never
      // point at different bytes -- cache them forever. index.html must NOT be
      // cached, or a returning player keeps loading a stale bundle after a
      // deploy and reconnects into a protocol they no longer speak.
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      } else {
        res.setHeader('Cache-Control', 'no-cache')
      }
    },
  }),
)

app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(path.join(clientDir, 'index.html'))
})

server.listen(PORT, () => {
  console.log(`The Prediction Game server listening on http://localhost:${PORT}`)
})
