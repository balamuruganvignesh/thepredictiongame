// Headless Hearts playtest: drives N bot clients through a full game against a
// running server, then reports the standings and every rule rejection.
//
//   npm run dev                                   # in another terminal
//   npx tsx scripts/hearts-playtest.ts 4 50
//
// Args: <playerCount> <targetScore>. Written in TypeScript on purpose: the bots
// choose their cards with the SAME shared isLegalHeartsPlay the browser uses, so
// a rejection here means the client and server disagree about legality -- and
// with no turn timers, that disagreement hangs a real round forever. Zero
// rejections is the pass condition.

import { io } from 'socket.io-client'
import type { Card } from '../src/shared/cards'
import { displayName } from '../src/shared/cards'
import { PASS_COUNT, isLegalHeartsPlay, isQueenOfSpades } from '../src/shared/heartsRules'

// PORT lets this run against a second server instance when :3001 is already
// taken by a dev server you'd rather not disturb.
const URL = `http://localhost:${process.env.PORT ?? 3001}`
const PLAYERS = Number(process.argv[2] ?? 4)
const TARGET = Number(process.argv[3] ?? 50)

const log = (...args: unknown[]) => console.log(...args)
const errors: string[] = []
const announcements: string[] = []
let roomCode: string | null = null
let finished = false

type Bot = {
  name: string
  id: string | null
  hand: Card[]
  heartsBroken: boolean
  isFirstTrick: boolean
  mustLeadCard: Card | null
  lastTrick: { currentTurnId: string | null; leadSuit: string | null } | null
  refused: Set<string>
  socket: ReturnType<typeof io>
}

const key = (card: Card) => `${card.suit}-${card.rank}`

/** The cards a bot is happiest to be rid of, for the pass. */
function passPicks(hand: Card[]): Card[] {
  const danger = (card: Card) =>
    isQueenOfSpades(card)
      ? 1000
      : card.suit === 'Spades' && card.rank > 12
        ? 500 + card.rank
        : card.suit === 'Hearts'
          ? 100 + card.rank
          : card.rank
  return [...hand].sort((a, b) => danger(b) - danger(a)).slice(0, PASS_COUNT)
}

function makeBot(name: string, index: number): Bot {
  const socket = io(URL, { transports: ['websocket'] })
  const bot: Bot = {
    name,
    id: null,
    hand: [],
    heartsBroken: false,
    isFirstTrick: true,
    mustLeadCard: null,
    lastTrick: null,
    refused: new Set(),
    socket,
  }

  /** Every card the shared rules say this bot may play right now. */
  const legalNow = (leadSuit: string | null) =>
    bot.hand.filter((card) =>
      isLegalHeartsPlay(card, bot.hand, {
        leadSuit,
        heartsBroken: bot.heartsBroken,
        isFirstTrick: bot.isFirstTrick,
        mustLeadCard: leadSuit == null ? bot.mustLeadCard : null,
      }),
    )

  const playSomething = (leadSuit: string | null) => {
    const legal = legalNow(leadSuit)
    const card = legal.find((c) => !bot.refused.has(key(c))) ?? legal[0] ?? bot.hand[0]
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
    // A refused play has to be retried with something else, or this bot stops
    // and takes the whole round down with it.
    if (!/play|suit|hearts|club|penalty/i.test(m)) return
    if (!bot.lastTrick || bot.lastTrick.currentTurnId !== bot.id) return
    const legal = legalNow(bot.lastTrick.leadSuit)
    const next = legal.find((c) => !bot.refused.has(key(c)))
    if (next) bot.refused.add(key(next))
    playSomething(bot.lastTrick.leadSuit)
  })

  socket.on('dealHand', (data: { hand: Card[] }) => {
    bot.hand = data.hand
  })

  socket.on('heartsRoundStart', (data: { roundNumber: number; cardsEach: number; direction: string }) => {
    bot.refused = new Set()
    bot.heartsBroken = false
    bot.isFirstTrick = true
    bot.mustLeadCard = null
    if (index === 0) {
      log(`  round ${data.roundNumber}: ${data.cardsEach} cards each, pass ${data.direction}`)
    }
  })

  socket.on('passPrompt', (data: { count: number }) => {
    if (data.count === 0) return
    setTimeout(() => socket.emit('passCards', passPicks(bot.hand)), 30)
  })

  socket.on(
    'heartsState',
    (data: { heartsBroken: boolean; isFirstTrick: boolean; mustLeadCard: Card | null }) => {
      bot.heartsBroken = data.heartsBroken
      bot.isFirstTrick = data.isFirstTrick
      bot.mustLeadCard = data.mustLeadCard
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

  socket.on('roleAnnounce', (d: { message: string }) => announcements.push(d.message))

  socket.on(
    'heartsScoreUpdate',
    (data: {
      roundNumber: number
      results: { id: string; hearts: number; hadQueen: boolean; shotMoon: boolean; roundScore: number; totalScore: number }[]
    }) => {
      if (index !== 0) return
      log(
        `    scored: ${data.results
          .map(
            (r) =>
              `${r.id.slice(0, 4)} ${r.hearts}♥${r.hadQueen ? '+Q' : ''}` +
              `${r.shotMoon ? ' MOON' : ''} = +${r.roundScore} (${r.totalScore})`,
          )
          .join(' | ')}`,
      )
      const total = data.results.reduce((sum, r) => sum + r.roundScore, 0)
      // Every round puts exactly 26 points on the table -- unless somebody shot
      // the moon, which hands 26 to each of the OTHERS instead.
      const expected = data.results.some((r) => r.shotMoon) ? 26 * (data.results.length - 1) : 26
      if (total !== expected) {
        errors.push(`round ${data.roundNumber} distributed ${total} points, expected ${expected}`)
      }
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

log(`room ${roomCode}, hearts, ${PLAYERS} players, playing to ${TARGET}`)
bots[0].socket.emit('setGameType', 'hearts')
await sleep(200)
bots[0].socket.emit('setTargetScore', TARGET)
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
      `  ${b.name} id=${b.id?.slice(0, 4)} hand=${b.hand.length} ` +
        `turn=${b.lastTrick?.currentTurnId?.slice(0, 4)} lead=${b.lastTrick?.leadSuit} ` +
        `broken=${b.heartsBroken} first=${b.isFirstTrick} ` +
        `mustLead=${b.mustLeadCard ? displayName(b.mustLeadCard) : '—'}`,
    )
  }
}

log(`\nannouncements: ${announcements.length}`)
for (const [kind, n] of [
  ...announcements.reduce(
    (map, a) => map.set(a.slice(0, 28), (map.get(a.slice(0, 28)) ?? 0) + 1),
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
