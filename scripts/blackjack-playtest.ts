// Headless Blackjack playtest: drives N bot clients through a full game
// against a running server, in either sub-mode, then reports the standings
// and every rule rejection.
//
//   npm run dev                                    # in another terminal
//   npx tsx scripts/blackjack-playtest.ts 4 dealer
//   npx tsx scripts/blackjack-playtest.ts 4 players
//
// Args: <playerCount> <dealer|players>. Written in TypeScript on purpose: a
// rejection here means the client and server disagree about a legal action --
// and with no turn timers, that disagreement hangs a real round forever. Zero
// rejections is the pass condition.

import { io } from 'socket.io-client'
import type { Card } from '../src/shared/cards'

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const PLAYERS = Number(process.argv[2] ?? 4)
const MODE = process.argv[3] === 'players' ? 'players' : 'dealer'

type BlackjackAction = 'hit' | 'stand' | 'double'
type BlackjackHandPublic = {
  cards: Card[]
  total: number
  soft: boolean
  busted: boolean
  blackjack: boolean
  doubled: boolean
  done: boolean
}
type BlackjackState = {
  hands: Record<string, BlackjackHandPublic>
  dealerHand: (Card | null)[] | null
  dealerTotal: number | null
  dealerBusted: boolean
  currentTurnId: string | null
  mode: 'dealer' | 'players'
}

const log = (...args: unknown[]) => console.log(...args)
const errors: string[] = []
let roomCode: string | null = null
let finished = false

type Bot = {
  name: string
  id: string | null
  hand: BlackjackHandPublic | null
  socket: ReturnType<typeof io>
}

/** Double on a strong first two cards; otherwise hit under 17, stand at 17+ -- the same threshold the dealer plays to. */
function chooseAction(hand: BlackjackHandPublic): BlackjackAction {
  if (hand.cards.length === 2 && !hand.doubled && (hand.total === 10 || hand.total === 11)) {
    return 'double'
  }
  return hand.total < 17 ? 'hit' : 'stand'
}

function makeBot(name: string, index: number): Bot {
  const socket = io(URL, { transports: ['websocket'] })
  const bot: Bot = { name, id: null, hand: null, socket }

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

  socket.on('blackjackRoundStart', (data: { roundNumber: number }) => {
    bot.hand = null
    if (index === 0) log(`  round ${data.roundNumber}`)
  })

  socket.on('blackjackState', (data: BlackjackState) => {
    if (bot.id && data.hands[bot.id]) bot.hand = data.hands[bot.id]
    if (data.currentTurnId !== bot.id || !bot.hand) return
    const action = chooseAction(bot.hand)
    setTimeout(() => socket.emit('blackjackAction', action), 20)
  })

  socket.on(
    'blackjackScoreUpdate',
    (data: {
      roundNumber: number
      results: { id: string; roundScore: number; totalScore: number }[]
    }) => {
      if (index !== 0) return
      log(
        `    scored: ${data.results
          .map(
            (r) =>
              `${r.id.slice(0, 4)} ${r.roundScore >= 0 ? '+' : ''}${r.roundScore} (${r.totalScore})`,
          )
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

log(`room ${roomCode}, blackjack (${MODE}), ${PLAYERS} players`)
bots[0].socket.emit('setGameType', 'blackjack')
await sleep(150)
bots[0].socket.emit('setBlackjackMode', MODE)
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
      `  ${b.name} id=${b.id?.slice(0, 4)} hand=${
        b.hand ? `${b.hand.total}${b.hand.soft ? 's' : ''}` : '-'
      }`,
    )
  }
}

if (errors.length) {
  log(`\nerrors (${errors.length}):`)
  for (const e of errors.slice(0, 20)) log('  ' + e)
}
log(finished && errors.length === 0 ? '\nOK: game completed, no rejections' : '\nFAIL')
for (const b of bots) b.socket.close()
process.exit(finished && errors.length === 0 ? 0 : 1)
