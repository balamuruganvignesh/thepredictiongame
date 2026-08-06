// Headless Golf playtest: drives N bot clients through a full 9-hole game
// against a running server, then reports the standings and every rule
// rejection.
//
//   npm run dev                            # in another terminal
//   npx tsx scripts/golf-playtest.ts 4
//
// Args: <playerCount>. Written in TypeScript on purpose: the bots decide their
// draw/resolve choices with the SAME shared cardValue the browser will use, so
// a rejection here means the client and server disagree -- and with no turn
// timers, that disagreement hangs a real hole forever. Zero rejections is the
// pass condition.

import { io } from 'socket.io-client'
import type { Card } from '../src/shared/cards'
import { cardValue } from '../src/shared/golfRules'

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const PLAYERS = Number(process.argv[2] ?? 4)

type GolfDrawSource = 'stock' | 'discard'
type GolfResolveAction =
  | { type: 'swap'; slot: number }
  | { type: 'discardAndFlip'; slot: number }
type GolfState = {
  grids: Record<string, (Card | null)[]>
  discardTop: Card | null
  stockCount: number
  currentTurnId: string | null
  awaitingResolve: boolean
  finalLap: boolean
  finalLapTriggeredBy: string | null
}

const log = (...args: unknown[]) => console.log(...args)
const errors: string[] = []
const announcements: string[] = []
let roomCode: string | null = null
let finished = false

type Bot = {
  name: string
  id: string | null
  grid: (Card | null)[]
  discardTop: Card | null
  socket: ReturnType<typeof io>
}

/** Swap in the drawn card if it beats the worst known slot; otherwise learn
 * something with a stock draw, or, forced, swap it in anyway. */
function chooseResolve(
  grid: (Card | null)[],
  card: Card,
  source: GolfDrawSource,
): GolfResolveAction {
  let worstSlot = -1
  let worstValue = -Infinity
  grid.forEach((c, i) => {
    if (!c) return
    const value = cardValue(c)
    if (value > worstValue) {
      worstValue = value
      worstSlot = i
    }
  })
  const drawnValue = cardValue(card)
  if (worstSlot >= 0 && drawnValue < worstValue) return { type: 'swap', slot: worstSlot }
  if (source === 'stock') {
    const hidden = grid.findIndex((c) => c === null)
    if (hidden >= 0) return { type: 'discardAndFlip', slot: hidden }
  }
  return { type: 'swap', slot: worstSlot >= 0 ? worstSlot : 0 }
}

/** Take a visibly good discard; otherwise draw blind. */
function chooseDraw(discardTop: Card | null): GolfDrawSource {
  if (discardTop && cardValue(discardTop) <= 2) return 'discard'
  return 'stock'
}

function makeBot(name: string, index: number): Bot {
  const socket = io(URL, { transports: ['websocket'] })
  const bot: Bot = {
    name,
    id: null,
    grid: new Array(6).fill(null),
    discardTop: null,
    socket,
  }

  socket.on('connect', () => {
    socket.emit('join', { name, roomCode: index === 0 ? null : roomCode, playerId: null })
  })
  socket.on('joined', (data: { playerId: string; roomCode: string }) => {
    bot.id = data.playerId
    if (index === 0) roomCode = data.roomCode
  })
  socket.on('joinError', (m: string) => errors.push(`${name} joinError: ${m}`))
  socket.on('connect_error', (e: Error) => log(`!! ${name} connect_error: ${e.message}`))
  socket.on('actionError', (m: string) => errors.push(`${name}: ${m}`))

  socket.on('golfRoundStart', (data: { holeNumber: number }) => {
    bot.grid = new Array(6).fill(null)
    bot.discardTop = null
    if (index === 0) log(`  hole ${data.holeNumber}`)
    setTimeout(() => socket.emit('golfRevealInitial', [0, 1]), 30 + index * 15)
  })

  socket.on('golfDrawResult', (data: { card: Card; source: GolfDrawSource }) => {
    const action = chooseResolve(bot.grid, data.card, data.source)
    setTimeout(() => socket.emit('golfResolve', action), 20)
  })

  socket.on('golfState', (data: GolfState) => {
    if (bot.id && data.grids[bot.id]) bot.grid = data.grids[bot.id]
    bot.discardTop = data.discardTop
    if (data.currentTurnId !== bot.id || data.awaitingResolve) return
    const source = chooseDraw(bot.discardTop)
    setTimeout(() => socket.emit('golfDraw', source), 20)
  })

  socket.on('roleAnnounce', (d: { message: string }) => announcements.push(d.message))

  socket.on(
    'golfScoreUpdate',
    (data: { holeNumber: number; results: { id: string; gridScore: number; totalScore: number }[] }) => {
      if (index !== 0) return
      log(
        `    scored: ${data.results
          .map((r) => `${r.id.slice(0, 4)} +${r.gridScore} (${r.totalScore})`)
          .join(' | ')}`,
      )
    },
  )

  socket.on(
    'gameEnded',
    (data: { standings: { name: string; totalScore: number }[]; lowestWins: boolean }) => {
      if (index !== 0) return
      log(`\nFINAL (${data.lowestWins ? 'lowest wins' : 'highest wins'}):`)
      data.standings.forEach((s, i) => log(`  ${i === 0 ? '🏆' : '  '} ${s.name}: ${s.totalScore}`))
      finished = true
    },
  )

  return bot
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const bots: Bot[] = []
bots.push(makeBot('Ada', 0))
await sleep(500)
for (let i = 1; i < PLAYERS; i++) {
  bots.push(makeBot(`Bot${i}`, i))
  await sleep(300)
}
await sleep(500)

log(`room ${roomCode}, golf, ${PLAYERS} players`)
bots[0].socket.emit('setGameType', 'golf')
await sleep(200)
for (let i = 1; i < PLAYERS; i++) bots[i].socket.emit('toggleReady', true)
await sleep(400)
bots[0].socket.emit('startGame')

const deadline = Date.now() + 900000
while (!finished && Date.now() < deadline) await sleep(500)

if (!finished) {
  log('\nSTALLED. per-bot view:')
  for (const b of bots) {
    log(
      `  ${b.name} id=${b.id?.slice(0, 4)} grid=${b.grid.map((c) => (c ? `${c.suit[0]}${c.rank}` : '-')).join(',')} ` +
        `discardTop=${b.discardTop ? `${b.discardTop.suit[0]}${b.discardTop.rank}` : '—'}`,
    )
  }
}

log(`\nannouncements: ${announcements.length}`)
for (const [kind, n] of [
  ...announcements.reduce(
    (map, a) => map.set(a, (map.get(a) ?? 0) + 1),
    new Map<string, number>(),
  ),
].sort((a, b) => b[1] - a[1])) {
  log(`  ${String(n).padStart(3)}x ${kind}`)
}

if (errors.length) {
  log(`\nerrors (${errors.length}):`)
  for (const e of errors.slice(0, 20)) log('  ' + e)
}
log(finished && errors.length === 0 ? '\nOK: game completed, no rejections' : '\nFAIL')
for (const b of bots) b.socket.close()
process.exit(finished && errors.length === 0 ? 0 : 1)
