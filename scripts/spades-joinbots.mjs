// Fills an existing Spades table with bots so you can play (or screenshot) a
// real game solo. Open a Spades table in the browser, then:
//
//   node scripts/spades-joinbots.mjs ABCD 3
//   node scripts/spades-joinbots.mjs ABCD 3 https://thepredictiongame.fly.dev
//
// The bots ready up, bid a simple heuristic (never Nil), and play a legal
// card each turn. You stay the host. Spades seats exactly 4, so pass at most
// 3 bots to leave yourself a chair.
import { io } from 'socket.io-client'

const CODE = process.argv[2]
const COUNT = Number(process.argv[3] ?? 3)
const URL = process.argv[4] ?? 'http://localhost:3001'

for (let i = 0; i < COUNT; i++) {
  const name = `Bot${i + 1}`
  const socket = io(URL, { transports: ['websocket'] })
  const bot = {
    id: null,
    hand: [],
    spadesBroken: false,
    lastTrick: null,
    refused: new Set(),
  }

  const legalNow = (leadSuit) => {
    if (leadSuit == null) {
      if (bot.hand.some((c) => c.suit !== 'Spades')) {
        return bot.spadesBroken ? bot.hand : bot.hand.filter((c) => c.suit !== 'Spades')
      }
      return bot.hand
    }
    const followers = bot.hand.filter((c) => c.suit === leadSuit)
    return followers.length > 0 ? followers : bot.hand
  }

  const key = (c) => `${c.suit}-${c.rank}`

  const playATurn = () => {
    const data = bot.lastTrick
    if (!data || data.currentTurnId !== bot.id) return
    const legal = legalNow(data.leadSuit)
    const sorted = [...legal].sort((a, b) => a.rank - b.rank)
    const card = sorted.find((c) => !bot.refused.has(key(c))) ?? sorted[0] ?? bot.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 700)
  }

  socket.on('connect', () => socket.emit('join', { name, roomCode: CODE, playerId: null }))
  socket.on('joined', (d) => {
    bot.id = d.playerId
    setTimeout(() => socket.emit('toggleReady', true), 200)
  })
  socket.on('joinError', (m) => console.log(name, 'joinError', m))
  socket.on('actionError', (m) => {
    console.log(name, 'actionError', m)
    if (!bot.lastTrick || bot.lastTrick.currentTurnId !== bot.id) return
    const legal = legalNow(bot.lastTrick.leadSuit)
    const next = legal.find((c) => !bot.refused.has(key(c)))
    if (next) bot.refused.add(key(next))
    playATurn()
  })

  socket.on('dealHand', (d) => (bot.hand = d.hand))

  socket.on('spadesRoundStart', () => {
    bot.refused.clear()
    bot.spadesBroken = false
  })

  socket.on('spadesState', (data) => {
    bot.spadesBroken = data.spadesBroken
    if (data.biddingTurnId === bot.id && (bot.id == null || data.bids[bot.id] == null)) {
      const strongSpades = bot.hand.filter((c) => c.suit === 'Spades' && c.rank >= 12).length
      const otherAces = bot.hand.filter((c) => c.suit !== 'Spades' && c.rank === 14).length
      const bid = Math.min(13, strongSpades + otherAces)
      setTimeout(() => socket.emit('submitSpadesBid', bid), 900)
    }
  })

  socket.on('trickUpdate', (data) => {
    bot.lastTrick = data
    if (data.currentTurnId !== bot.id) {
      bot.refused.clear()
      return
    }
    playATurn()
  })
}
