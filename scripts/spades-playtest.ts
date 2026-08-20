// Headless Spades playtest: drives 4 bot clients through a full game against
// a running server, then reports every hand's result and every rule
// rejection.
//
//   npm run dev                       # in another terminal
//   npx tsx scripts/spades-playtest.ts
//
// Always 4 players -- Spades is fixed at exactly 4, unlike every other game
// here. Written in TypeScript on purpose: the bots choose their cards with
// the SAME shared isLegalSpadesPlay the browser uses, so a rejection here
// means the client and server disagree about legality -- and with no turn
// timers, that disagreement hangs a real hand forever. Zero rejections is
// the pass condition. Target score is forced to 200 (the lowest option) so
// this finishes in a handful of hands instead of a full-length game.
//
// Bots play toward their team's bid, not just the lowest legal card: once
// their team has already taken enough tricks to make its bid, they switch to
// dumping low (avoiding bags); until then they play high, trying to win.
// Purely legality-driven bots (always lowest) tend to swing wildly on bags
// and take a very long time to reach even the lowest target score.

import { io } from 'socket.io-client'
import type { Card } from '../src/shared/cards'
import { legalSpadesPlays, type SpadesBid } from '../src/shared/spadesRules'

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const PLAYERS = 4

const log = (...args: unknown[]) => console.log(...args)
const errors: string[] = []
let roomCode: string | null = null
let finished = false

const key = (card: Card) => `${card.suit}-${card.rank}`

/** Count obvious winners (top spades, other aces) -- never bids Nil. */
function chooseBid(hand: Card[]): number {
  const strongSpades = hand.filter((c) => c.suit === 'Spades' && c.rank >= 12).length
  const otherAces = hand.filter((c) => c.suit !== 'Spades' && c.rank === 14).length
  return Math.min(13, strongSpades + otherAces)
}

type Bot = {
  name: string
  id: string | null
  hand: Card[]
  spadesBroken: boolean
  biddingTurnId: string | null
  hasBid: boolean
  lastTrick: { currentTurnId: string | null; leadSuit: string | null } | null
  refused: Set<string>
  /** id -> team, from this hand's spadesRoundStart. */
  teams: Record<string, 0 | 1>
  /** id -> bid, from the latest spadesState. */
  bids: Partial<Record<string, SpadesBid>>
  /** id -> tricks won so far THIS hand, from trickResolved. */
  tricksWon: Record<string, number>
  socket: ReturnType<typeof io>
}

function makeBot(name: string, index: number): Bot {
  const socket = io(URL, { transports: ['websocket'] })
  const bot: Bot = {
    name,
    id: null,
    hand: [],
    spadesBroken: false,
    biddingTurnId: null,
    hasBid: false,
    lastTrick: null,
    refused: new Set(),
    teams: {},
    bids: {},
    tricksWon: {},
    socket,
  }

  const legalNow = (leadSuit: string | null) =>
    legalSpadesPlays(bot.hand, { leadSuit, spadesBroken: bot.spadesBroken })

  /** Team bid so far (nil counts as 0), and tricks the team has already taken this hand. */
  const teamProgress = () => {
    if (!bot.id) return { bid: 0, tricks: 0 }
    const team = bot.teams[bot.id]
    const teammates = Object.keys(bot.teams).filter((id) => bot.teams[id] === team)
    const bid = teammates.reduce((sum, id) => {
      const b = bot.bids[id]
      return sum + (b === 'nil' || b == null ? 0 : b)
    }, 0)
    const tricks = teammates.reduce((sum, id) => sum + (bot.tricksWon[id] ?? 0), 0)
    return { bid, tricks }
  }

  const playSomething = (leadSuit: string | null) => {
    const legal = legalNow(leadSuit)
    const { bid, tricks } = teamProgress()
    // Team hasn't made its bid yet: play high, trying to win this trick.
    // Bid already made: dump low, trying NOT to win (avoid bags).
    const sorted = [...legal].sort((a, b) => (tricks < bid ? b.rank - a.rank : a.rank - b.rank))
    const card = sorted.find((c) => !bot.refused.has(key(c))) ?? sorted[0] ?? bot.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 20)
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

  socket.on('actionError', (m: string) => {
    errors.push(`${name}: ${m}`)
    if (!/play|suit|spade/i.test(m)) return
    if (!bot.lastTrick || bot.lastTrick.currentTurnId !== bot.id) return
    const legal = legalNow(bot.lastTrick.leadSuit)
    const next = legal.find((c) => !bot.refused.has(key(c)))
    if (next) bot.refused.add(key(next))
    playSomething(bot.lastTrick.leadSuit)
  })

  socket.on('dealHand', (data: { hand: Card[] }) => {
    bot.hand = data.hand
  })

  socket.on('spadesRoundStart', (data: { handNumber: number; teams: Record<string, 0 | 1> }) => {
    bot.refused = new Set()
    bot.spadesBroken = false
    bot.hasBid = false
    bot.teams = data.teams
    bot.tricksWon = {}
    if (index === 0) log(`  hand ${data.handNumber}`)
  })

  socket.on(
    'spadesState',
    (data: {
      biddingTurnId: string | null
      bids: Partial<Record<string, SpadesBid>>
      spadesBroken: boolean
    }) => {
      bot.spadesBroken = data.spadesBroken
      bot.biddingTurnId = data.biddingTurnId
      bot.bids = data.bids
      bot.hasBid = bot.id != null && data.bids[bot.id] != null
      if (data.biddingTurnId === bot.id && !bot.hasBid) {
        setTimeout(() => socket.emit('submitSpadesBid', chooseBid(bot.hand)), 30)
      }
    },
  )

  socket.on('trickUpdate', (data: { currentTurnId: string | null; leadSuit: string | null }) => {
    bot.lastTrick = data
    if (data.currentTurnId !== bot.id) {
      bot.refused = new Set()
      return
    }
    playSomething(data.leadSuit)
  })

  socket.on('trickResolved', (data: { winnerId: string }) => {
    bot.tricksWon[data.winnerId] = (bot.tricksWon[data.winnerId] ?? 0) + 1
  })

  socket.on('roleAnnounce', (d: { message: string }) => {
    if (index === 0) log(`  [${d.message}]`)
  })

  socket.on(
    'spadesScoreUpdate',
    (data: {
      handNumber: number
      teams: {
        team: number
        bid: number
        tricks: number
        madeBid: boolean
        bagPenalty: number
        roundScore: number
        totalScore: number
      }[]
    }) => {
      if (index !== 0) return
      log(
        `    scored: ${data.teams
          .map(
            (t) =>
              `team ${t.team} bid ${t.bid} took ${t.tricks} (${t.madeBid ? 'made' : 'set'})` +
              `${t.bagPenalty !== 0 ? ` bag${t.bagPenalty}` : ''} = +${t.roundScore} (${t.totalScore})`,
          )
          .join(' | ')}`,
      )
    },
  )

  socket.on('gameEnded', (data: { standings: { name: string; totalScore: number }[]; tournament?: boolean }) => {
    if (index !== 0 || data.tournament) return
    log(`\nFINAL:`)
    data.standings.forEach((s, i) => log(`  ${i === 0 ? '🏆' : '  '} ${s.name}: ${s.totalScore}`))
    finished = true
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

log(`room ${roomCode}, spades, ${PLAYERS} players`)
bots[0].socket.emit('setGameType', 'spades')
await sleep(150)
bots[0].socket.emit('setSpadesTargetScore', 200)
await sleep(150)
for (let i = 1; i < PLAYERS; i++) bots[i].socket.emit('toggleReady', true)
await sleep(400)
bots[0].socket.emit('startGame')

const deadline = Date.now() + 1200000
while (!finished && Date.now() < deadline) await sleep(500)

if (!finished) {
  log('\nSTALLED. per-bot view:')
  for (const b of bots) {
    log(`  ${b.name} id=${b.id?.slice(0, 4)} hand=${b.hand.length} cards`)
  }
}

if (errors.length) {
  log(`\nerrors (${errors.length}):`)
  for (const e of errors.slice(0, 20)) log('  ' + e)
}
log(finished && errors.length === 0 ? '\nOK: game completed, no rejections' : '\nFAIL')
for (const b of bots) b.socket.close()
