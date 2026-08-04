// End-to-end test for the restart vote: the table abandoning a game in progress
// so that whoever is waiting as a spectator gets a chair.
//
// Run it against a running server (npm start / npm run dev):
//   node scripts/restart-vote-test.mjs
//
// Three players start a game, a fourth arrives mid-game (and is therefore
// spectating), then two of the three vote to restart. What has to happen:
//
//   * the tally reaches everyone, spectator included
//   * a majority ends the game IMMEDIATELY -- no standings, no playing the
//     round out. Nothing anywhere has a turn timer, so if the phase managers
//     didn't cancel, the loop would sit on somebody's turn forever.
//   * the table lands back in the LOBBY with the watcher seated
//
// PORT= hits a second server instance when :3001 is busy.
import { io } from 'socket.io-client'

const URL = `http://localhost:${process.env.PORT ?? 3001}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let roomCode = null
const players = []
let failures = 0
const check = (ok, message) => {
  console.log(`  ${ok ? '✓' : '✗'} ${message}`)
  if (!ok) failures++
}

function makePlayer(name, index) {
  const socket = io(URL, { transports: ['websocket'] })
  const p = {
    name,
    socket,
    id: null,
    hand: [],
    inGame: false,
    bid: null,
    votes: null,
    sawGameEnded: false,
    lobbyRoster: null,
  }

  socket.on('connect', () =>
    socket.emit('join', { name, roomCode: index === 0 ? null : roomCode, playerId: null }),
  )
  socket.on('joined', (d) => {
    p.id = d.playerId
    p.spectating = d.spectating
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
      (c) => d.leadSuit == null || c.suit === d.leadSuit || !p.hand.some((h) => h.suit === d.leadSuit),
    )
    const card = legal[0] ?? p.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 20)
  })
  socket.on('restartVote', (d) => {
    p.votes = d
  })
  socket.on('gameEnded', () => {
    p.sawGameEnded = true
  })
  socket.on('lobbyUpdate', (d) => {
    p.lobbyRoster = d.roster.map((r) => r.name)
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
await sleep(9000)
check(
  players.every((p) => p.inGame),
  'the game is running for all three',
)

// The whole point of the feature: somebody turns up and can't get a seat.
console.log('\n>>> a fourth player arrives mid-game')
const spec = makePlayer('Dan', 3)
await sleep(2500)
check(spec.spectating === true, 'the late arrival is spectating, not seated')
check(players[0].votes?.waiting === 1, 'the table is told one person is waiting for a chair')

console.log('\n>>> Alice votes to restart')
players[0].socket.emit('voteRestart', true)
await sleep(1200)
check(players[1].votes?.votes.length === 1, 'the tally reaches the other players')
check(players[1].votes?.needed === 2, 'two of three seats carry it')
check(spec.votes?.votes.length === 1, 'and the watcher can see it building')
check(!players[0].sawGameEnded, 'one vote does NOT end the game')

console.log('\n>>> Alice changes her mind')
players[0].socket.emit('voteRestart', false)
await sleep(800)
check(players[1].votes?.votes.length === 0, 'the vote can be withdrawn')

console.log('\n>>> Alice and Bob both vote')
players[0].socket.emit('voteRestart', true)
await sleep(400)
players[1].socket.emit('voteRestart', true)
// Generous: long enough to cover the between-cards pause a vote may land in,
// nowhere near long enough to have played the round out.
await sleep(6000)

check(
  players.every((p) => !p.sawGameEnded),
  'no standings: the game was abandoned, not finished',
)
check(
  players.every((p) => p.lobbyRoster != null),
  'everyone is back in the lobby',
)
check(
  players[0].lobbyRoster?.includes('Dan') === true,
  'and the player who was waiting now has a chair',
)
check(players[0].lobbyRoster?.length === 4, `the lobby holds all four (${players[0].lobbyRoster})`)

console.log(failures === 0 ? '\nPASS' : `\nFAIL — ${failures} problem(s)`)
for (const p of players) p.socket.disconnect()
spec.socket.disconnect()
process.exit(failures === 0 ? 0 : 1)
