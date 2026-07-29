// Headless playtest: drives N bot clients through a full game against a
// running server, then reports the final standings and every rule rejection
// the server sent back. The fastest way to exercise a rules change end to end.
//
//   npm run dev            # or npm start, in another terminal
//   node scripts/playtest.mjs chaos 4
//
// Args: <classic|chaos> <playerCount>. A 10-player game takes ~10 minutes of
// wall clock -- most of it the 5s post-bid Double window, once per bidder.
import { io } from 'socket.io-client'

const URL = 'http://localhost:3001'
const MODE = process.argv[2] ?? 'chaos'
const PLAYERS = Number(process.argv[3] ?? 3)

const log = (...args) => console.log(...args)
let roomCode = null
let finished = false
const errors = []
const announcements = []

function makeBot(name, index) {
  const socket = io(URL, { transports: ['websocket'] })
  const bot = { name, socket, hand: [], id: null, roleState: null, abilityTried: false }

  socket.on('connect', () => {
    socket.emit('join', { name, roomCode: index === 0 ? null : roomCode, playerId: null })
  })

  socket.on('joined', (data) => {
    bot.id = data.playerId
    if (index === 0) roomCode = data.roomCode
  })

  socket.on('joinError', (m) => errors.push(`${name} joinError: ${m}`))
  socket.on('disconnect', (reason, detail) => log(`!! ${name} DISCONNECTED: ${reason} ${detail?.description ?? ''}`))
  socket.on('connect_error', (e) => log(`!! ${name} connect_error: ${e.message}`))
  socket.on('actionError', (m) => errors.push(`${name}: ${m}`))

  socket.on('lobbyUpdate', (data) => {
    bot.lobby = data
  })

  socket.on('dealHand', (data) => {
    bot.hand = data.hand
  })

  socket.on('gameState', (data) => {
    if (data.phase === 'RoundStart') {
      bot.bid = null
      bot.abilityTried = false
      bot.turnOrder = data.turnOrder
      bot.cardsDealt = data.cardsDealt
      if (index === 0) log(`  round ${data.roundNumber}: ${data.cardsDealt} cards, ${data.trumpSuit}`)
    }
    if (data.phase === 'Bidding' && data.currentTurnId === bot.id && bot.bid == null) {
      const sum = Object.values(data.bids).reduce((a, b) => a + b, 0)
      const isLast = bot.turnOrder[bot.turnOrder.length - 1] === bot.id
      let want = Math.min(1, data.cardsDealt)
      // The last bidder can't make the bids sum to the trick count.
      if (isLast && sum + want === data.cardsDealt) want = want === 0 ? 1 : 0
      bot.bid = want
      setTimeout(() => socket.emit('submitBid', want), 20)
    }
    if (data.phase === 'Bidding') bot.lastBidState = data
  })

  socket.on('doubleWindow', () => {
    if (Math.random() < 0.25) socket.emit('declareDouble')
  })

  socket.on('trickUpdate', (data) => {
    bot.lastTrick = data
    if (data.currentTurnId !== bot.id) return
    const legal = bot.hand.filter(
      (c) =>
        data.leadSuit == null ||
        c.suit === data.leadSuit ||
        c.suit === 'Joker' ||
        !bot.hand.some((h) => h.suit === data.leadSuit),
    )
    const card = legal[0] ?? bot.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 20)
  })

  socket.on('roleState', (data) => {
    bot.roleState = data
    // Fire the ability once per round, aimed at whoever isn't us.
    if (data.active && data.abilityId && !data.used && !bot.abilityTried) {
      bot.abilityTried = true
      setTimeout(() => {
        const others = (bot.lobby?.roster ?? []).filter((r) => r.id !== bot.id).map((r) => r.id)
        socket.emit('useAbility', {
          targetId: others[0],
          targetId2: others[1],
          direction: Math.random() < 0.5 ? 1 : -1,
        })
      }, 300 + Math.random() * 900)
    }
  })

  socket.on('roleAnnounce', (d) => announcements.push(d.message))
  socket.on('scoreUpdate', (data) => {
    if (index !== 0) return
    log(
      `    scored: ${data.results
        .map((r) => `${r.id.slice(0, 4)} bid ${r.bid}/won ${r.tricksWon} = ${r.roundScore}`)
        .join(' | ')}`,
    )
  })
  socket.on('gameEnded', (data) => {
    if (index !== 0) return
    log('\nFINAL:')
    for (const s of data.standings) {
      log(`  ${s.name}: ${s.totalScore}${s.roleName ? `  [${s.roleEmoji} ${s.roleName}]` : ''}`)
    }
    finished = true
  })

  return bot
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const bots = []
bots.push(makeBot('Ada', 0))
await sleep(500)
for (let i = 1; i < PLAYERS; i++) {
  bots.push(makeBot(`Bot${i}`, i))
  await sleep(300)
}
await sleep(500)

log(`room ${roomCode}, mode ${MODE}, ${PLAYERS} players`)
bots[0].socket.emit('setMode', MODE)
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
      `  ${b.name} id=${b.id?.slice(0, 4)} bid=${b.bid} hand=${b.hand.length} ` +
        `bidTurn=${b.lastBidState?.currentTurnId?.slice(0, 4)} ` +
        `bids=${JSON.stringify(b.lastBidState?.bids)} ` +
        `trickTurn=${b.lastTrick?.currentTurnId?.slice(0, 4)} plays=${b.lastTrick?.plays?.length}`,
    )
  }
}

log(`\nannouncements: ${announcements.length}`)
for (const a of announcements.slice(0, 12)) log('  ' + a)
if (errors.length) {
  log(`\nerrors (${errors.length}):`)
  for (const e of errors.slice(0, 20)) log('  ' + e)
}
log(finished ? '\nOK: game completed' : '\nFAIL: game did not finish')
for (const b of bots) b.socket.close()
process.exit(finished ? 0 : 1)
