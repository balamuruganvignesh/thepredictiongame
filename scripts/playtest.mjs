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

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const MODE = process.argv[2] ?? 'chaos'
const PLAYERS = Number(process.argv[3] ?? 3)

const log = (...args) => console.log(...args)
let roomCode = null
let finished = false
const errors = []
const announcements = []

function makeBot(name, index) {
  const socket = io(URL, { transports: ['websocket'] })
  const bot = { name, socket, hand: [], id: null, roleState: null, abilityTried: null, abilityAttempt: 0 }

  // Fire this round's ability, aimed at whoever isn't us. Keyed on the ability
  // ID rather than a flag, because the Time Traveler's Alternate Universe
  // REPLACES the ability without spending the turn -- a boolean would leave the
  // replacement unused and never exercise it.
  //
  // Called from three places on purpose. Firing only on roleState lands every
  // attempt in the BIDDING phase, where Rewind ("no cards on the table") and
  // Reverse Time ("they haven't bid yet") can only ever be rejected -- so the
  // play phase and mid-trick moments get a go too.
  function tryAbility() {
    const state = bot.roleState
    if (!state?.active || !state.abilityId || state.used) return
    if (bot.abilityTried === state.abilityId + bot.abilityAttempt) return
    bot.abilityTried = state.abilityId + bot.abilityAttempt
    setTimeout(() => {
      const others = (bot.lobby?.roster ?? []).filter((r) => r.id !== bot.id).map((r) => r.id)
      const suits = ['Spades', 'Diamonds', 'Clubs', 'Hearts']
      const roleIds = ['detective', 'joker', 'gambler', 'judge', 'guardian', 'time_traveler', 'angel', 'mirrorer']
      const card = bot.hand[Math.floor(Math.random() * bot.hand.length)]
      // Every picker in one payload: the server ignores the fields the current
      // ability doesn't ask for.
      socket.emit('useAbility', {
        targetId: others[0],
        targetId2: others[1],
        direction: Math.random() < 0.5 ? 1 : -1,
        suit: suits[Math.floor(Math.random() * suits.length)],
        peek: Math.random() < 0.5 ? 'high' : 'low',
        scope: Math.random() < 0.5 ? 'one' : 'all',
        roleId: roleIds[Math.floor(Math.random() * roleIds.length)],
        cardKey: card ? `${card.suit}-${card.rank}` : undefined,
      })
    }, 60 + Math.random() * 300)
  }

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
  socket.on('actionError', (m) => {
    errors.push(`${name}: ${m}`)
    // A refused PLAY must be retried with a different card, or this bot stops
    // and takes the round with it.
    if (!/play|follow suit|rewound/i.test(m)) return
    const data = bot.lastTrick
    if (!data || data.currentTurnId !== bot.id) return
    bot.refused = bot.refused ?? new Set()
    const legal = bot.hand.filter(
      (c) =>
        data.leadSuit == null ||
        c.suit === data.leadSuit ||
        c.suit === 'Joker' ||
        !bot.hand.some((h) => h.suit === data.leadSuit),
    )
    const key = (c) => `${c.suit}-${c.rank}`
    const next = legal.find((c) => !bot.refused.has(key(c)))
    if (next) bot.refused.add(key(next))
    const retry = legal.find((c) => !bot.refused.has(key(c)))
    if (retry) setTimeout(() => socket.emit('playCard', retry), 20)
  })

  socket.on('lobbyUpdate', (data) => {
    bot.lobby = data
  })

  socket.on('dealHand', (data) => {
    bot.hand = data.hand
  })

  socket.on('gameState', (data) => {
    if (data.phase === 'RoundStart') {
      bot.bid = null
      bot.abilityTried = null
      bot.abilityAttempt = 0
      bot.turnOrder = data.turnOrder
      bot.cardsDealt = data.cardsDealt
      if (index === 0) log(`  round ${data.roundNumber}: ${data.cardsDealt} cards, ${data.trumpSuit}`)
    }
    if (data.phase === 'Playing') {
      bot.abilityAttempt++
      tryAbility()
    }
    if (data.phase === 'Bidding' && data.currentTurnId === bot.id && bot.bid == null) {
      // Use the server's true total: data.bids can carry an Imposter disguise,
      // and summing that would pick a bid the server rejects (which would hang
      // this bot forever, since it never retries).
      const sum = data.bidSum
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
    if (data.currentTurnId !== bot.id) bot.refused = new Set()
    // Mid-trick, with a card already on the table: the only moment a Rewind can
    // actually land, so give the ability another go here.
    if (data.plays.length > 0 && data.currentTurnId != null) {
      bot.abilityAttempt++
      tryAbility()
    }
    if (data.currentTurnId !== bot.id) return
    const legal = bot.hand.filter(
      (c) =>
        data.leadSuit == null ||
        c.suit === data.leadSuit ||
        c.suit === 'Joker' ||
        !bot.hand.some((h) => h.suit === data.leadSuit),
    )
    // Skip anything the server already refused this turn: a Rewind bars the
    // card you just played, and re-picking legal[0] would pick that same card
    // forever -- with no turn timers, that hangs the whole table.
    const key = (c) => `${c.suit}-${c.rank}`
    const card = legal.find((c) => !bot.refused?.has(key(c))) ?? legal[0] ?? bot.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 20)
  })

  socket.on('roleState', (data) => {
    bot.roleState = data
    tryAbility()
  })

  // A Time Traveler reopened this bot's bid. Answering keeps Reverse Time
  // exercised end to end; a rewrite isn't bound by the last-bidder rule, so
  // any number in range is legal here.
  socket.on('rebidPrompt', (data) => {
    setTimeout(
      () => socket.emit('submitRebid', Math.floor(Math.random() * (data.cardsDealt + 1))),
      120,
    )
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

// Grouped by their leading emoji + SHOUTED headline rather than listed raw:
// with 100+ announcements a flat list is unreadable, and what you actually
// want to know is WHICH abilities fired at all this game.
log(`\nannouncements: ${announcements.length}`)
const byKind = new Map()
for (const a of announcements) {
  const kind = a.match(/^(\S+\s+[A-Z][A-Za-z' ]*)/)?.[1].trim() ?? a.slice(0, 28)
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
}
for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
  log(`  ${String(n).padStart(3)}x ${kind}`)
}
if (errors.length) {
  log(`\nerrors (${errors.length}):`)
  for (const e of errors.slice(0, 20)) log('  ' + e)
}
log(finished ? '\nOK: game completed' : '\nFAIL: game did not finish')
for (const b of bots) b.socket.close()
process.exit(finished ? 0 : 1)
