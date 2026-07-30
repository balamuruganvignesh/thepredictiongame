// Client-side orchestrator: owns all display state and translates incoming
// socket events into it. The server remains the single source of truth for
// everything that affects scoring or legality.

import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { Card } from '@shared/cards'
import type {
  ChatMessage,
  GameMode,
  GameStateUpdate,
  LobbyUpdate,
  PlayEntry,
  RoleState,
  RoleSync,
  ScoreUpdate,
  Snapshot,
  Standing,
  TrickResolved,
  TrickUpdate,
  UseAbilityPayload,
} from '@shared/protocol'
import { rememberName, rememberPlayerId, socket, storedPlayerId } from './socket'

export type FeedCard = { id: number; message: string; secret: boolean; createdAt: number }

export type View = 'join' | 'lobby' | 'game' | 'gameover'

export type Store = {
  connected: boolean
  joinError: string | null
  meId: string | null
  myName: string
  roomCode: string | null
  view: View
  lobby: LobbyUpdate | null
  /** Watching a game that was already running: no hand, no turn, no abilities. */
  spectating: boolean

  names: Record<string, string>
  /** THE display order for every player list, locked in at round 1. */
  order: string[]
  turnOrder: string[]

  roundNumber: number
  cardsDealt: number
  trumpSuit: string
  phase: 'bidding' | 'playing' | null

  bids: Record<string, number>
  /** TRUE total of bids placed this round; see protocol's bidSum. */
  bidSum: number
  tricksWon: Record<string, number>
  totals: Record<string, number>
  history: Record<number, Record<string, number>>

  currentTurnId: string | null
  leadSuit: string | null
  hand: Card[]
  /**
   * Card keys the Detective's Illusion has made LOOK unplayable. Cosmetic
   * only -- every one of them is still perfectly legal to play.
   */
  illusionCards: string[]
  plays: PlayEntry[]
  trickNumber: number
  totalTricks: number
  trickWinnerId: string | null

  standings: Standing[] | null
  roleState: RoleState | null
  /** Bumped every time a fresh round intro should replay the reveal banner. */
  roleBannerKey: number
  /** The most recent private ability result, kept for the role modal. */
  lastAbilityResult: string | null

  /** Epoch ms the post-bid Double window closes, or null when it isn't open. */
  doubleDeadline: number | null
  doubled: boolean

  chat: ChatMessage[]
  /** Messages that have arrived since the chat panel was last open. */
  unreadChat: number
  feed: FeedCard[]
  toast: string | null
  nextId: number
}

const initialStore: Store = {
  connected: false,
  joinError: null,
  meId: null,
  myName: '',
  roomCode: null,
  view: 'join',
  lobby: null,
  spectating: false,
  names: {},
  order: [],
  turnOrder: [],
  roundNumber: 0,
  cardsDealt: 0,
  trumpSuit: '',
  phase: null,
  bids: {},
  bidSum: 0,
  tricksWon: {},
  totals: {},
  history: {},
  currentTurnId: null,
  leadSuit: null,
  hand: [],
  illusionCards: [],
  plays: [],
  trickNumber: 0,
  totalTricks: 0,
  trickWinnerId: null,
  standings: null,
  roleState: null,
  roleBannerKey: 0,
  lastAbilityResult: null,
  doubleDeadline: null,
  doubled: false,
  chat: [],
  unreadChat: 0,
  feed: [],
  toast: null,
  nextId: 1,
}

type Action =
  | { type: 'connected'; value: boolean }
  | { type: 'joined'; playerId: string; roomCode: string; name: string; spectating: boolean }
  | { type: 'joinError'; message: string }
  | { type: 'lobby'; data: LobbyUpdate }
  | { type: 'roundStart'; data: Extract<GameStateUpdate, { phase: 'RoundStart' }> }
  | { type: 'bidding'; data: Extract<GameStateUpdate, { phase: 'Bidding' }> }
  | { type: 'playing' }
  | { type: 'hand'; hand: Card[] }
  | { type: 'illusion'; cards: string[] }
  | { type: 'trickUpdate'; data: TrickUpdate }
  | { type: 'trickResolved'; data: TrickResolved }
  | { type: 'score'; data: ScoreUpdate }
  | { type: 'roundEnded' }
  | { type: 'gameEnded'; standings: Standing[] }
  | { type: 'roleState'; data: RoleState }
  | { type: 'roleSync'; data: RoleSync }
  | { type: 'announce'; message: string }
  | { type: 'abilityResult'; message: string }
  | { type: 'doubleWindow'; seconds: number }
  | { type: 'doubleCommitted' }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chatHistory'; messages: ChatMessage[] }
  | { type: 'chatRead' }
  | { type: 'toast'; message: string | null }
  | { type: 'dropFeed'; id: number }
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'leave' }

const SUIT_GLYPH: Record<string, string> = {
  Spades: '♠',
  Hearts: '♥',
  Diamonds: '♦',
  Clubs: '♣',
}

export function trumpGlyph(trumpSuit: string | null | undefined): string {
  if (!trumpSuit) return ''
  if (trumpSuit === 'NoTrump') return 'NT'
  return SUIT_GLYPH[trumpSuit] ?? trumpSuit
}

function reducer(state: Store, action: Action): Store {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: action.value }

    case 'joined':
      rememberPlayerId(action.playerId)
      rememberName(action.name)
      return {
        ...state,
        meId: action.playerId,
        myName: action.name,
        roomCode: action.roomCode,
        spectating: action.spectating,
        joinError: null,
        view: state.view === 'join' ? 'lobby' : state.view,
      }

    case 'joinError':
      return { ...state, joinError: action.message }

    case 'lobby': {
      const names: Record<string, string> = {}
      const totals: Record<string, number> = {}
      for (const entry of action.data.roster) {
        names[entry.id] = entry.name
        totals[entry.id] = 0
      }
      return {
        ...state,
        lobby: action.data,
        names,
        totals,
        history: {},
        order: [],
        standings: null,
        roleState: null,
        view: 'lobby',
      }
    }

    case 'roundStart': {
      const { data } = action
      const order =
        data.roundNumber === 1 || state.order.length === 0 ? [...data.turnOrder] : state.order

      return {
        ...state,
        view: 'game',
        standings: null,
        roundNumber: data.roundNumber,
        cardsDealt: data.cardsDealt,
        totalTricks: data.cardsDealt,
        trumpSuit: data.trumpSuit,
        turnOrder: data.turnOrder,
        order,
        history: data.roundNumber === 1 ? {} : state.history,
        bids: {},
        bidSum: 0,
        tricksWon: {},
        currentTurnId: null,
        leadSuit: null,
        hand: [],
        illusionCards: [],
        plays: [],
        trickNumber: 0,
        trickWinnerId: null,
        phase: 'bidding',
        doubled: false,
        doubleDeadline: null,
        lastAbilityResult: null,
      }
    }

    case 'bidding':
      return {
        ...state,
        phase: 'bidding',
        currentTurnId: action.data.currentTurnId,
        bids: { ...state.bids, ...action.data.bids },
        bidSum: action.data.bidSum,
        cardsDealt: action.data.cardsDealt,
      }

    case 'playing':
      return { ...state, phase: 'playing', doubleDeadline: null }

    case 'hand':
      return { ...state, hand: action.hand }

    case 'illusion':
      return { ...state, illusionCards: action.cards }

    case 'trickUpdate':
      return {
        ...state,
        currentTurnId: action.data.currentTurnId,
        leadSuit: action.data.leadSuit,
        trickNumber: action.data.trickNumber,
        totalTricks: action.data.totalTricks,
        plays: action.data.plays,
        trickWinnerId: null,
      }

    case 'trickResolved': {
      const { data } = action
      const tricksWon = { ...state.tricksWon }
      // counted === false means chaos mode voided the win (Gravekeeper).
      if (data.counted) tricksWon[data.winnerId] = (tricksWon[data.winnerId] ?? 0) + 1

      return {
        ...state,
        tricksWon,
        currentTurnId: null,
        plays: data.plays,
        trickNumber: data.trickNumber,
        totalTricks: data.totalTricks,
        trickWinnerId: data.winnerId,
      }
    }

    case 'score': {
      const { data } = action
      const totals = { ...state.totals }
      const tricksWon = { ...state.tricksWon }
      const bids = { ...state.bids }
      const roundScores: Record<string, number> = {}

      for (const result of data.results) {
        totals[result.id] = result.totalScore
        tricksWon[result.id] = result.tricksWon
        bids[result.id] = result.bid
        roundScores[result.id] = result.roundScore
      }

      return {
        ...state,
        totals,
        tricksWon,
        bids,
        history: { ...state.history, [data.roundNumber]: roundScores },
      }
    }

    case 'roundEnded':
      return { ...state, phase: null, plays: [], trickWinnerId: null, doubleDeadline: null }

    case 'gameEnded':
      return {
        ...state,
        view: 'gameover',
        standings: action.standings,
        phase: null,
        roleState: null,
      }

    case 'roleState': {
      // A fresh round intro replays the reveal banner + ability slot roll.
      const bump = action.data.roundIntro ? state.roleBannerKey + 1 : state.roleBannerKey
      return { ...state, roleState: action.data, roleBannerKey: bump }
    }

    case 'roleSync': {
      // Server-pushed corrections after bid/trick tampering (swaps, verdicts,
      // disguises, stolen tricks).
      const next = { ...state }
      if (action.data.bids) next.bids = { ...state.bids, ...action.data.bids }
      if (action.data.tricks) next.tricksWon = { ...state.tricksWon, ...action.data.tricks }
      return next
    }

    case 'announce':
      return {
        ...state,
        nextId: state.nextId + 1,
        feed: [
          ...state.feed,
          { id: state.nextId, message: action.message, secret: false, createdAt: Date.now() },
        ],
      }

    case 'abilityResult':
      return {
        ...state,
        nextId: state.nextId + 1,
        lastAbilityResult: action.message,
        feed: [
          ...state.feed,
          { id: state.nextId, message: action.message, secret: true, createdAt: Date.now() },
        ],
      }

    case 'dropFeed':
      return { ...state, feed: state.feed.filter((card) => card.id !== action.id) }

    case 'doubleWindow':
      return state.doubled
        ? state
        : { ...state, doubleDeadline: Date.now() + action.seconds * 1000 }

    case 'doubleCommitted':
      return { ...state, doubled: true, doubleDeadline: null }

    case 'chat': {
      // Your own messages (and the history replay) never count as unread.
      const mine = action.message.from === state.meId
      return {
        ...state,
        chat: [...state.chat, action.message].slice(-200),
        unreadChat: mine ? state.unreadChat : state.unreadChat + 1,
      }
    }

    case 'chatHistory':
      return { ...state, chat: action.messages, unreadChat: 0 }

    case 'chatRead':
      return { ...state, unreadChat: 0 }

    case 'toast':
      return { ...state, toast: action.message }

    case 'snapshot': {
      const { data } = action
      const names: Record<string, string> = {}
      for (const entry of data.roster) names[entry.id] = entry.name
      return {
        ...state,
        view: 'game',
        names,
        order: data.turnOrder,
        turnOrder: data.turnOrder,
        roundNumber: data.roundNumber,
        cardsDealt: data.cardsDealt,
        totalTricks: data.cardsDealt,
        trumpSuit: data.trumpSuit,
        phase: data.phase === 'Playing' ? 'playing' : 'bidding',
        bids: data.bids,
        bidSum: data.bidSum,
        tricksWon: data.tricksWon,
        totals: data.totals,
        history: data.history,
        currentTurnId: data.currentTurnId,
        leadSuit: data.leadSuit,
        hand: data.hand,
        illusionCards: data.illusion,
        plays: data.plays,
        trickNumber: data.trickNumber,
        trickWinnerId: null,
        roleState: data.roleState,
        chat: data.chat,
        spectating: data.spectating,
        standings: null,
      }
    }

    case 'leave':
      return { ...initialStore, connected: state.connected, myName: state.myName }

    default:
      return state
  }
}

export function useGame() {
  const [store, dispatch] = useReducer(reducer, initialStore)

  // Which table this client belongs to, readable from the socket callbacks
  // without making them depend on the reducer state.
  const seatRef = useRef<{ roomCode: string | null; name: string }>({ roomCode: null, name: '' })
  seatRef.current = { roomCode: store.roomCode, name: store.myName }

  useEffect(() => {
    socket.on('connect', () => {
      dispatch({ type: 'connected', value: true })
      // Socket.IO reconnects on its own after a blip, but the server binds a
      // seat to a SOCKET -- so without re-joining here the player is orphaned
      // at their own table and the server auto-plays their hand. The stored
      // player id is what puts them back in the same chair.
      const { roomCode, name } = seatRef.current
      if (roomCode) {
        socket.emit('join', { name, roomCode, playerId: storedPlayerId() })
        socket.emit('requestState')
      }
    })
    socket.on('disconnect', () => dispatch({ type: 'connected', value: false }))

    socket.on('joined', (data) =>
      dispatch({
        type: 'joined',
        playerId: data.playerId,
        roomCode: data.roomCode,
        name: data.name,
        spectating: data.spectating,
      }),
    )
    socket.on('joinError', (message) => dispatch({ type: 'joinError', message }))
    socket.on('lobbyUpdate', (data) => dispatch({ type: 'lobby', data }))

    socket.on('gameState', (data) => {
      if (data.phase === 'RoundStart') dispatch({ type: 'roundStart', data })
      else if (data.phase === 'Bidding') dispatch({ type: 'bidding', data })
      else dispatch({ type: 'playing' })
    })

    socket.on('dealHand', (data) => dispatch({ type: 'hand', hand: data.hand }))
    socket.on('illusion', (data) => dispatch({ type: 'illusion', cards: data.cards }))
    socket.on('trickUpdate', (data) => dispatch({ type: 'trickUpdate', data }))
    socket.on('trickResolved', (data) => dispatch({ type: 'trickResolved', data }))
    socket.on('scoreUpdate', (data) => dispatch({ type: 'score', data }))
    socket.on('roundEnded', () => dispatch({ type: 'roundEnded' }))
    socket.on('gameEnded', (data) => dispatch({ type: 'gameEnded', standings: data.standings }))
    socket.on('snapshot', (data) => dispatch({ type: 'snapshot', data }))

    socket.on('actionError', (message) => dispatch({ type: 'toast', message }))
    socket.on('doubleWindow', (data) => dispatch({ type: 'doubleWindow', seconds: data.seconds }))

    socket.on('chat', (message) => dispatch({ type: 'chat', message }))
    socket.on('chatHistory', (messages) => dispatch({ type: 'chatHistory', messages }))

    socket.on('roleState', (data) => dispatch({ type: 'roleState', data }))
    socket.on('roleSync', (data) => dispatch({ type: 'roleSync', data }))
    socket.on('roleAnnounce', (data) => dispatch({ type: 'announce', message: data.message }))
    socket.on('abilityResult', (data) =>
      dispatch({ type: 'abilityResult', message: data.message }),
    )

    return () => {
      socket.removeAllListeners()
    }
  }, [])

  // Toasts and feed cards expire on their own.
  useEffect(() => {
    if (!store.toast) return
    const timer = setTimeout(() => dispatch({ type: 'toast', message: null }), 3200)
    return () => clearTimeout(timer)
  }, [store.toast])

  useEffect(() => {
    if (store.feed.length === 0) return
    // Remaining time is computed from each card's own createdAt: a new
    // announcement re-runs this effect, and without that the older cards would
    // have their timers restarted and linger.
    const now = Date.now()
    const timers = store.feed.map((card) => {
      const ttl = card.secret ? 9000 : 6000
      return setTimeout(
        () => dispatch({ type: 'dropFeed', id: card.id }),
        Math.max(0, card.createdAt + ttl - now),
      )
    })
    return () => timers.forEach(clearTimeout)
  }, [store.feed])

  const actions = useMemo(
    () => ({
      join(name: string, roomCode: string | null) {
        rememberName(name)
        socket.emit('join', { name, roomCode, playerId: storedPlayerId() })
      },
      toggleReady(ready: boolean) {
        socket.emit('toggleReady', ready)
      },
      startGame() {
        socket.emit('startGame')
      },
      setMode(mode: GameMode) {
        socket.emit('setMode', mode)
      },
      submitBid(bid: number) {
        socket.emit('submitBid', bid)
      },
      declareDouble() {
        dispatch({ type: 'doubleCommitted' })
        socket.emit('declareDouble')
      },
      playCard(card: Card) {
        socket.emit('playCard', card)
      },
      useAbility(payload: UseAbilityPayload) {
        socket.emit('useAbility', payload)
      },
      sendChat(text: string) {
        socket.emit('chat', text)
      },
      markChatRead() {
        dispatch({ type: 'chatRead' })
      },
    }),
    [],
  )

  return { store, actions }
}

export type GameActions = ReturnType<typeof useGame>['actions']
