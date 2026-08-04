// Regression test for the two ways a table used to get emptied mid-game:
//
//   1. a SPECTATOR joining a running game
//   2. a seated player's wifi dropping and RECONNECTING
//
// Both call Room.broadcastLobby(), and `lobbyUpdate` goes to the whole room --
// the client reads it as "we're in the lobby now", resets its view and drops
// the round. So either one used to throw EVERY player out of the game.
// Room.broadcastLobby() now refuses to fire unless gameState is 'Lobby'.
//
// Run it against a running server (npm start / npm run dev):
//   node scripts/spectate-test.mjs
//
// It asserts nobody sees a lobbyUpdate once they're in a game. To watch it
// catch the bug, delete that guard in room.ts and re-run -- it reports one
// kick per seated player.
import { io } from 'socket.io-client'

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let roomCode = null
const players = []

function makePlayer(name, index) {
  const socket = io(URL, { transports: ['websocket'] })
  const p = { name, socket, id: null, hand: [], sawLobbyMidGame: 0, inGame: false, bid: null }

  socket.on('connect', () =>
    socket.emit('join', { name, roomCode: index === 0 ? null : roomCode, playerId: null }),
  )
  socket.on('joined', (d) => {
    p.id = d.playerId
    if (index === 0) roomCode = d.roomCode
  })
  socket.on('dealHand', (d) => {
    p.hand = d.hand
  })
  socket.on('gameState', (d) => {
    if (d.phase === 'RoundStart') {
      p.inGame = true
      p.bid = null
      p.turnOrder = d.turnOrder
      p.cardsDealt = d.cardsDealt
    }
    if (d.phase === 'Bidding' && d.currentTurnId === p.id && p.bid == null) {
      const isLast = p.turnOrder?.[p.turnOrder.length - 1] === p.id
      let want = Math.min(1, d.cardsDealt)
      if (isLast && d.bidSum + want === d.cardsDealt) want = want === 0 ? 1 : 0
      p.bid = want
      setTimeout(() => socket.emit('submitBid', want), 20)
    }
  })
  socket.on('trickUpdate', (d) => {
    if (d.currentTurnId !== p.id) return
    const legal = p.hand.filter(
      (c) =>
        d.leadSuit == null ||
        c.suit === d.leadSuit ||
        !p.hand.some((h) => h.suit === d.leadSuit),
    )
    const card = legal[0] ?? p.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 20)
  })

  // THE ASSERTION: once the game is running, a lobbyUpdate means the client
  // just got thrown back to the lobby screen.
  socket.on('lobbyUpdate', () => {
    if (p.inGame) p.sawLobbyMidGame += 1
  })

  return p
}

players.push(makePlayer('Alice', 0))
await sleep(600)
players.push(makePlayer('Bob', 1))
await sleep(400)
players.push(makePlayer('Cara', 2))
await sleep(600)

console.log(`table ${roomCode}`)
players[1].socket.emit('toggleReady', true)
players[2].socket.emit('toggleReady', true)
await sleep(400)
players[0].socket.emit('startGame')

// Let the game get properly under way.
await sleep(9000)
console.log('game running; players inGame =', players.map((p) => p.inGame).join(','))

// --- the spectator arrives mid-game ---
console.log('>>> spectator joining')
const spec = io(URL, { transports: ['websocket'] })
let specSpectating = null
spec.on('connect', () => spec.emit('join', { name: 'Nosy', roomCode, playerId: null }))
spec.on('joined', (d) => {
  specSpectating = d.spectating
})
let specSawSnapshot = false
spec.on('snapshot', (d) => {
  specSawSnapshot = true
  specSpectatingSnap = d.spectating
})
let specSpectatingSnap = null

await sleep(6000)

console.log('\n--- RESULT ---')
console.log('spectator joined as spectating =', specSpectating)
console.log('spectator got snapshot =', specSawSnapshot, 'snapshot.spectating =', specSpectatingSnap)
for (const p of players) {
  console.log(`  ${p.name}: kicked-to-lobby events while in game = ${p.sawLobbyMidGame}`)
}
const kicked = players.reduce((n, p) => n + p.sawLobbyMidGame, 0)
console.log(kicked === 0 ? '\nPASS: nobody was kicked out' : `\nFAIL: ${kicked} kick events`)

// Also reconnect a seated player mid-game -- the original wifi-drop report.
console.log('\n>>> simulating a wifi drop + reconnect for Bob')
const bobId = players[1].id
players[1].socket.disconnect()
await sleep(1500)
const bobAgain = io(URL, { transports: ['websocket'] })
bobAgain.on('connect', () =>
  bobAgain.emit('join', { name: 'Bob', roomCode, playerId: bobId }),
)
await sleep(5000)

const kickedAfter = players.reduce((n, p) => n + p.sawLobbyMidGame, 0)
console.log('kick events after reconnect =', kickedAfter)
console.log(kickedAfter === 0 ? 'PASS: reconnect kicked nobody' : 'FAIL: reconnect kicked players')

for (const p of players) p.socket.disconnect()
spec.disconnect()
bobAgain.disconnect()
process.exit(0)
