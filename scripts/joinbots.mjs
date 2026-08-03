// Fills an existing table with bots so you can play (or screenshot) a real
// game solo. Open a table in the browser, then:
//
//   node scripts/joinbots.mjs ABCD 3
//   node scripts/joinbots.mjs ABCD 3 https://thepredictiongame.fly.dev
//
// The bots ready up and play a simple legal game; you stay the host. In chaos
// mode they also USE their abilities -- without that you'd sit through ten
// rounds and never see a single role do anything.
import { io } from 'socket.io-client'

const CODE = process.argv[2]
const COUNT = Number(process.argv[3] ?? 2)
const URL = process.argv[4] ?? 'http://localhost:3001'

const ROLE_IDS = [
  'detective',
  'joker',
  'gambler',
  'judge',
  'guardian',
  'time_traveler',
  'angel',
  'mirrorer',
]
const SUITS = ['Spades', 'Diamonds', 'Clubs', 'Hearts']
const pick = (list) => list[Math.floor(Math.random() * list.length)]

for (let i = 0; i < COUNT; i++) {
  const name = `Bot${i + 1}`
  const socket = io(URL, { transports: ['websocket'] })
  const bot = {
    id: null,
    hand: [],
    turnOrder: [],
    bid: null,
    roster: [],
    roleState: null,
    tried: null,
    attempt: 0,
    // Cards the server refused for the turn we're on. A Rewind bars the card
    // you just played, and picking legal[0] again would pick that exact card
    // forever -- the round has no turn timer, so that hangs the table.
    refused: new Set(),
  }

  // Fires this round's ability at whoever isn't us. Keyed on the ability id, not
  // a flag, because Alternate Universe REPLACES the ability without spending
  // the turn -- a boolean would leave the replacement unused.
  //
  // Called from three places because timing decides what's even legal: most
  // abilities want the play phase, and Rewind only works mid-trick with a card
  // already on the table.
  const tryAbility = () => {
    const state = bot.roleState
    if (!state?.active || !state.abilityId || state.used) return
    if (bot.tried === state.abilityId + bot.attempt) return
    bot.tried = state.abilityId + bot.attempt
    setTimeout(() => {
      const others = bot.roster.filter((r) => r.id !== bot.id).map((r) => r.id)
      if (others.length === 0) return
      const card = pick(bot.hand)
      // Every picker in one payload; the server ignores what this ability
      // doesn't ask for.
      socket.emit('useAbility', {
        targetId: others[0],
        targetId2: others[1],
        direction: Math.random() < 0.5 ? 1 : -1,
        suit: pick(SUITS),
        peek: Math.random() < 0.5 ? 'high' : 'low',
        scope: Math.random() < 0.5 ? 'one' : 'all',
        roleId: pick(ROLE_IDS),
        cardKey: card ? `${card.suit}-${card.rank}` : undefined,
      })
    }, 700 + Math.random() * 1200)
  }

  socket.on('connect', () => socket.emit('join', { name, roomCode: CODE, playerId: null }))
  socket.on('joined', (d) => {
    bot.id = d.playerId
    setTimeout(() => socket.emit('toggleReady', true), 200)
  })
  socket.on('joinError', (m) => console.log(name, 'joinError', m))
  socket.on('lobbyUpdate', (d) => (bot.roster = d.roster))
  socket.on('dealHand', (d) => (bot.hand = d.hand))

  socket.on('gameState', (data) => {
    if (data.phase === 'RoundStart') {
      bot.bid = null
      bot.turnOrder = data.turnOrder
      bot.tried = null
      bot.attempt = 0
    }
    if (data.phase === 'Playing') {
      bot.attempt++
      tryAbility()
    }
    if (data.phase === 'Bidding' && data.currentTurnId === bot.id && bot.bid == null) {
      // data.bidSum, never a sum of data.bids: those can carry a Judge's
      // Imposter disguise, and bidding off the disguised total picks a number
      // the server rejects -- which hangs this bot forever, since it never
      // retries.
      const sum = data.bidSum
      const isLast = bot.turnOrder[bot.turnOrder.length - 1] === bot.id
      let want = Math.min(1, data.cardsDealt)
      if (isLast && sum + want === data.cardsDealt) want = want === 0 ? 1 : 0
      bot.bid = want
      setTimeout(() => socket.emit('submitBid', want), 900)
    }
  })

  const playATurn = () => {
    const data = bot.lastTrick
    if (!data || data.currentTurnId !== bot.id) return
    const legal = bot.hand.filter(
      (c) =>
        data.leadSuit == null ||
        c.suit === data.leadSuit ||
        c.suit === 'Joker' ||
        !bot.hand.some((h) => h.suit === data.leadSuit),
    )
    const key = (c) => `${c.suit}-${c.rank}`
    const card = legal.find((c) => !bot.refused.has(key(c))) ?? legal[0] ?? bot.hand[0]
    if (card) setTimeout(() => socket.emit('playCard', card), 900)
  }

  socket.on('trickUpdate', (data) => {
    bot.lastTrick = data
    // Mid-trick with a card on the table: the only moment a Rewind can land.
    if (data.plays.length > 0 && data.currentTurnId != null) {
      bot.attempt++
      tryAbility()
    }
    if (data.currentTurnId !== bot.id) {
      bot.refused.clear()
      return
    }
    playATurn()
  })

  socket.on('roleState', (data) => {
    bot.roleState = data
    tryAbility()
  })

  // A Time Traveler reopened this bot's bid. Answering keeps Reverse Time
  // visible in a real game; a rewrite isn't bound by the last-bidder rule.
  socket.on('rebidPrompt', (data) => {
    setTimeout(
      () => socket.emit('submitRebid', Math.floor(Math.random() * (data.cardsDealt + 1))),
      1200,
    )
  })

  socket.on('actionError', (m) => {
    console.log(`${name}: ${m}`)
    // A refused PLAY has to be retried with a different card, or this bot
    // simply stops and takes the whole table with it.
    if (!/play|follow suit|rewound/i.test(m)) return
    const data = bot.lastTrick
    if (!data || data.currentTurnId !== bot.id) return
    const legal = bot.hand.filter(
      (c) =>
        data.leadSuit == null ||
        c.suit === data.leadSuit ||
        c.suit === 'Joker' ||
        !bot.hand.some((h) => h.suit === data.leadSuit),
    )
    const key = (c) => `${c.suit}-${c.rank}`
    const tried = legal.find((c) => !bot.refused.has(key(c)))
    if (tried) bot.refused.add(key(tried))
    playATurn()
  })
  socket.on('chat', (m) => console.log('chat:', m.name || '*', m.text))
}

console.log(`bots joining ${CODE} at ${URL}`)
setTimeout(() => process.exit(0), 15 * 60 * 1000)
