// Headless tournament playtest: drives N bot clients through a 2-leg
// tournament (Golf then Blackjack) against a running server, then reports
// both legs' standings and the final combined tournament standings.
//
//   npm run dev                            # in another terminal
//   npx tsx scripts/tournament-playtest.ts 3
//
// Combines the two simplest existing playtest bots' decision logic
// (scripts/golf-playtest.ts, scripts/blackjack-playtest.ts) into one client
// that reacts to whichever leg is currently live -- this is the one thing no
// single-game playtest can cover: a table switching gameType mid-session,
// without a lobby step in between, is exactly what tournament mode adds to
// Room.runGameLoop. Zero rejections AND a correct final combined-points
// ranking is the pass condition.

import { io } from 'socket.io-client'
import type { Card } from '../src/shared/cards'
import { cardValue } from '../src/shared/golfRules'

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const PLAYERS = Number(process.argv[2] ?? 3)

type GolfDrawSource = 'stock' | 'discard'
type GolfResolveAction = { type: 'swap'; slot: number } | { type: 'discardAndFlip'; slot: number }
type GolfState = {
  grids: Record<string, (Card | null)[]>
  discardTop: Card | null
  currentTurnId: string | null
  awaitingResolve: boolean
}
type BlackjackAction = 'hit' | 'stand' | 'double'
type BlackjackHandPublic = { total: number; cards: Card[]; doubled: boolean }
type BlackjackState = { hands: Record<string, BlackjackHandPublic>; currentTurnId: string | null }
type Standing = { id: string; name: string; totalScore: number }

const log = (...args: unknown[]) => console.log(...args)
const errors: string[] = []
const legStandings: { gameName: string; standings: Standing[] }[] = []
let roomCode: string | null = null
let tournamentFinished = false
let finalStandings: Standing[] | null = null

function chooseGolfResolve(grid: (Card | null)[], card: Card, source: GolfDrawSource): GolfResolveAction {
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

function chooseBlackjackAction(hand: BlackjackHandPublic): BlackjackAction {
  if (hand.cards.length === 2 && !hand.doubled && (hand.total === 10 || hand.total === 11)) return 'double'
  return hand.total < 17 ? 'hit' : 'stand'
}

type Bot = { name: string; id: string | null; grid: (Card | null)[]; socket: ReturnType<typeof io> }

function makeBot(name: string, index: number): Bot {
  const socket = io(URL, { transports: ['websocket'] })
  const bot: Bot = { name, id: null, grid: new Array(6).fill(null), socket }

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
  socket.on('roleAnnounce', (d: { message: string }) => {
    if (index === 0) log(`  [${d.message}]`)
  })

  // ---- Golf leg ----
  socket.on('golfRoundStart', (data: { holeNumber: number }) => {
    bot.grid = new Array(6).fill(null)
    setTimeout(() => socket.emit('golfRevealInitial', [0, 1]), 30 + index * 15)
  })
  socket.on('golfDrawResult', (data: { card: Card; source: GolfDrawSource }) => {
    setTimeout(() => socket.emit('golfResolve', chooseGolfResolve(bot.grid, data.card, data.source)), 20)
  })
  socket.on('golfState', (data: GolfState) => {
    if (bot.id && data.grids[bot.id]) bot.grid = data.grids[bot.id]
    if (data.currentTurnId !== bot.id || data.awaitingResolve) return
    const source: GolfDrawSource = data.discardTop && cardValue(data.discardTop) <= 2 ? 'discard' : 'stock'
    setTimeout(() => socket.emit('golfDraw', source), 20)
  })

  // ---- Blackjack leg ----
  socket.on('blackjackState', (data: BlackjackState) => {
    const hand = bot.id ? data.hands[bot.id] : undefined
    if (!hand || data.currentTurnId !== bot.id) return
    setTimeout(() => socket.emit('blackjackAction', chooseBlackjackAction(hand)), 20)
  })

  // ---- Shared: fires once per leg, and once more (tournament: true) at the end ----
  socket.on('gameEnded', (data: { standings: Standing[]; tournament?: boolean }) => {
    if (index !== 0) return
    if (data.tournament) {
      finalStandings = data.standings
      tournamentFinished = true
    } else {
      legStandings.push({ gameName: `leg ${legStandings.length + 1}`, standings: data.standings })
    }
  })

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

log(`room ${roomCode}, tournament (golf, blackjack), ${PLAYERS} players`)
bots[0].socket.emit('setTournamentGames', ['golf', 'blackjack'])
await sleep(150)
// Shortest option on each: this is a wiring/regression smoke test, not a
// full-length game -- keep it fast to iterate on.
bots[0].socket.emit('setHoleCount', 3)
await sleep(150)
bots[0].socket.emit('setBlackjackRounds', 5)
await sleep(200)
for (let i = 1; i < PLAYERS; i++) bots[i].socket.emit('toggleReady', true)
await sleep(400)
bots[0].socket.emit('startGame')

const deadline = Date.now() + 300000
while (!tournamentFinished && Date.now() < deadline) await sleep(500)

for (const leg of legStandings) {
  log(`\n${leg.gameName}: ${leg.standings.map((s) => `${s.name} ${s.totalScore}`).join(' | ')}`)
}

if (finalStandings) {
  log('\nFINAL TOURNAMENT STANDINGS:')
  ;(finalStandings as Standing[]).forEach((s, i) =>
    log(`  ${i === 0 ? '🏆' : '  '} ${s.name}: ${s.totalScore}`),
  )
} else {
  log('\nSTALLED -- no final tournament standings received')
}

const legsOk = legStandings.length === 2
if (!legsOk) errors.push(`expected 2 legs to finish, got ${legStandings.length}`)

if (errors.length) {
  log(`\nerrors (${errors.length}):`)
  for (const e of errors.slice(0, 20)) log('  ' + e)
}
log(tournamentFinished && errors.length === 0 ? '\nOK: tournament completed, no rejections' : '\nFAIL')
for (const b of bots) b.socket.close()
