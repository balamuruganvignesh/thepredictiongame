// Fills an existing table with bots so you can play (or screenshot) a real
// game solo. Open a table in the browser, then:
//
//   node scripts/joinbots.mjs ABCD 3
//
// The bots ready up and play a simple legal game; you stay the host.
import { io } from 'socket.io-client'

const CODE = process.argv[2]
const COUNT = Number(process.argv[3] ?? 2)

for (let i = 0; i < COUNT; i++) {
  const name = `Bot${i + 1}`
  const socket = io('http://localhost:3001', { transports: ['websocket'] })
  const bot = { id: null, hand: [], turnOrder: [], bid: null }

  socket.on('connect', () => socket.emit('join', { name, roomCode: CODE, playerId: null }))
  socket.on('joined', (d) => {
    bot.id = d.playerId
    setTimeout(() => socket.emit('toggleReady', true), 200)
  })
  socket.on('joinError', (m) => console.log(name, 'joinError', m))
  socket.on('dealHand', (d) => (bot.hand = d.hand))
  socket.on('gameState', (data) => {
    if (data.phase === 'RoundStart') {
      bot.bid = null
      bot.turnOrder = data.turnOrder
    }
    if (data.phase === 'Bidding' && data.currentTurnId === bot.id && bot.bid == null) {
      const sum = Object.values(data.bids).reduce((a, b) => a + b, 0)
      const isLast = bot.turnOrder[bot.turnOrder.length - 1] === bot.id
      let want = Math.min(1, data.cardsDealt)
      if (isLast && sum + want === data.cardsDealt) want = want === 0 ? 1 : 0
      bot.bid = want
      setTimeout(() => socket.emit('submitBid', want), 900)
    }
  })
  socket.on('trickUpdate', (data) => {
    if (data.currentTurnId !== bot.id) return
    const legal = bot.hand.filter(
      (c) =>
        data.leadSuit == null ||
        c.suit === data.leadSuit ||
        c.suit === 'Joker' ||
        !bot.hand.some((h) => h.suit === data.leadSuit),
    )
    const card = legal[0] ?? bot.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 900)
  })
  socket.on('chat', (m) => console.log('chat:', m.name || '*', m.text))
}

console.log(`bots joining ${CODE}`)
setTimeout(() => process.exit(0), 15 * 60 * 1000)
