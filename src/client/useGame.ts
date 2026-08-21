// Client-side orchestrator: owns all display state and translates incoming
// socket events into it. The server remains the single source of truth for
// everything that affects scoring or legality.

import { useEffect, useMemo, useReducer, useRef } from 'react'
import type { Card } from '@shared/cards'
import { BlackjackConfig, GolfConfig, SpadesConfig } from '@shared/config'
import type { SpadesBid } from '@shared/spadesRules'
import type {
  AbilityEffect,
  BlackjackAction as BlackjackActionKind,
  BlackjackHandPublic,
  BlackjackMode,
  BlackjackRoundStart,
  BlackjackScoreUpdate,
  BlackjackState,
  ChatMessage,
  EmoteBurst,
  GameMode,
  GameStateUpdate,
  GameType,
  GolfDrawResult,
  GolfDrawSource,
  GolfResolveAction,
  GolfRoundStart,
  GolfScoreUpdate,
  GolfState,
  HeartsRoundStart,
  HeartsScoreUpdate,
  HeartsState,
  LobbyUpdate,
  PassPrompt,
  PassResult,
  PlayEntry,
  RebidPrompt,
  ReplayData,
  RestartVote,
  RoleState,
  RoleSync,
  ScoreUpdate,
  Snapshot,
  SpadesRoundStart,
  SpadesScoreUpdate,
  SpadesState,
  Standing,
  TrickResolved,
  TrickUpdate,
  UseAbilityPayload,
  WatchedHand,
} from '@shared/protocol'
import { displayName } from '@shared/cards'
import type { PassDirection } from '@shared/heartsRules'
import { rememberName, rememberPlayerId, socket, storedPlayerId } from './socket'
import { playAbilityEffect, playCardPlay, playRoundEnd, playTrickWin } from './sound'

export type FeedCard = { id: number; message: string; secret: boolean; createdAt: number }

export type View = 'join' | 'lobby' | 'game' | 'gameover'

/**
 * The Hearts slice of the store. Only meaningful while `gameType === 'hearts'`;
 * the Prediction Game never reads it and never writes it.
 */
export type HeartsStore = {
  targetScore: number
  direction: PassDirection
  /** Who your three cards go to, or null on a no-pass round. */
  passToId: string | null
  /** The pass modal is up: you still owe three cards. */
  passPending: boolean
  heartsBroken: boolean
  isFirstTrick: boolean
  /** Penalty points taken so far THIS round, per player. */
  penalties: Record<string, number>
  /** The card that must open the round, while it's still unplayed. */
  mustLeadCard: Card | null
  /** The three cards that came your way, for the round-start toast. */
  received: Card[]
}

const emptyHearts: HeartsStore = {
  targetScore: 100,
  direction: 'none',
  passToId: null,
  passPending: false,
  heartsBroken: false,
  isFirstTrick: true,
  penalties: {},
  mustLeadCard: null,
  received: [],
}

/**
 * The Golf slice. Only meaningful while `gameType === 'golf'`. Unlike every
 * other game's private `hand`, `grids` is fully public -- nobody sees their
 * own face-down cards either, so this is the same shape everyone at the
 * table receives.
 */
export type GolfStore = {
  holeNumber: number
  totalHoles: number
  grids: Record<string, (Card | null)[]>
  discardTop: Card | null
  stockCount: number
  currentTurnId: string | null
  /** The current-turn seat has drawn and is choosing swap vs. discard-and-flip. */
  awaitingResolve: boolean
  finalLap: boolean
  finalLapTriggeredBy: string | null
  /** A card YOU drew and haven't placed yet -- the one private moment in Golf. */
  pendingDraw: { card: Card; source: GolfDrawSource } | null
}

const emptyGolf: GolfStore = {
  holeNumber: 0,
  totalHoles: GolfConfig.defaultHoleCount,
  grids: {},
  discardTop: null,
  stockCount: 0,
  currentTurnId: null,
  awaitingResolve: false,
  finalLap: false,
  finalLapTriggeredBy: null,
  pendingDraw: null,
}

/**
 * The Blackjack slice. Only meaningful while `gameType === 'blackjack'`.
 * Unlike every other game's private `hand`, `hands` is fully public -- cards
 * are dealt and stay face up, the way blackjack is actually played. The one
 * hidden card in the whole game is the dealer's hole card, a `null` slot in
 * `dealerHand` until the dealer plays.
 */
export type BlackjackStore = {
  roundNumber: number
  totalRounds: number
  mode: BlackjackMode
  hands: Record<string, BlackjackHandPublic>
  dealerHand: (Card | null)[] | null
  dealerTotal: number | null
  dealerBusted: boolean
  currentTurnId: string | null
}

const emptyBlackjack: BlackjackStore = {
  roundNumber: 0,
  totalRounds: BlackjackConfig.defaultRounds,
  mode: 'dealer',
  hands: {},
  dealerHand: null,
  dealerTotal: null,
  dealerBusted: false,
  currentTurnId: null,
}

/**
 * The Spades slice. Only meaningful while `gameType === 'spades'`. Trick
 * play itself (currentTurnId/leadSuit/plays/trickNumber) reuses the SAME
 * top-level Store fields Prediction and Hearts already share -- this only
 * holds what's genuinely Spades-specific: bidding, teams, bags.
 */
export type SpadesStore = {
  handNumber: number
  targetScore: number
  /** seatId -> team, fixed for the whole game. */
  teams: Record<string, 0 | 1>
  phase: 'bidding' | 'playing'
  biddingTurnId: string | null
  bids: Partial<Record<string, SpadesBid>>
  spadesBroken: boolean
  /** [team 0's bags, team 1's bags]. */
  bags: [number, number]
}

const emptySpades: SpadesStore = {
  handNumber: 0,
  targetScore: SpadesConfig.defaultTargetScore,
  teams: {},
  phase: 'bidding',
  biddingTurnId: null,
  bids: {},
  spadesBroken: false,
  bags: [0, 0],
}

export type Store = {
  connected: boolean
  joinError: string | null
  meId: string | null
  myName: string
  roomCode: string | null
  view: View
  lobby: LobbyUpdate | null
  /** Which game this table is playing. Everything below branches off it. */
  gameType: GameType
  hearts: HeartsStore
  golf: GolfStore
  blackjack: BlackjackStore
  spades: SpadesStore
  /** Hearts standings read the other way up: fewest penalty points wins. */
  lowestWins: boolean
  /** True only on the FINAL standings of a tournament -- combined points, not one game's score. */
  tournamentEnded: boolean
  /** Watching a game that was already running: no hand, no turn, no abilities. */
  spectating: boolean
  /** Spectator-only: the seat they've chosen to peek at, read-only. */
  watchedSeat: WatchedHand

  names: Record<string, string>
  /** THE display order for every player list, locked in at round 1. */
  order: string[]
  turnOrder: string[]

  roundNumber: number
  cardsDealt: number
  trumpSuit: string
  phase: 'bidding' | 'passing' | 'playing' | null

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
  /**
   * A Time Traveler's Reverse Time reopened your bid. NOT a turn -- the round
   * carries on around it, and dismissing it just keeps the bid you had.
   */
  rebid: RebidPrompt | null
  /**
   * A card a Rewind is barring you from replaying. Unlike an Illusion this is
   * REAL -- the server refuses it -- so the hand renders it as unplayable.
   */
  barredCard: string | null
  plays: PlayEntry[]
  trickNumber: number
  totalTricks: number
  trickWinnerId: string | null

  standings: Standing[] | null
  roleState: RoleState | null
  /** Bumped every time a fresh round intro should replay the reveal banner. */
  roleBannerKey: number
  /**
   * EVERY private line this round, oldest first: what you did to the table and
   * what the table did to you. A list rather than "the latest one" because both
   * kinds arrive on the same channel — being handed points by an Angel used to
   * overwrite the hand-reading you spent your own ability on.
   */
  abilityLog: string[]
  /**
   * Choreographed visuals queued from `abilityEffect`, keyed so a stale
   * `onDismiss` from a fast-fired duplicate never clears the wrong instance.
   * `EffectLayer` owns removing its own entries once their animation ends.
   */
  activeEffects: (AbilityEffect & { key: number })[]

  /** Epoch ms the post-bid Double window closes, or null when it isn't open. */
  doubleDeadline: number | null
  doubled: boolean

  /**
   * The live vote to abandon the game and reopen the lobby. `needed` is a
   * majority of the connected seats and `waiting` is how many people are stuck
   * spectating -- the reason to call one.
   */
  restart: RestartVote

  /**
   * Reactions currently floating over the table. Keyed like activeEffects so
   * a stale dismissal can never clear the wrong one; EmoteLayer owns removing
   * its own entries once their animation ends.
   */
  emotes: (EmoteBurst & { key: number })[]

  /**
   * Every trick this game has played, fetched on demand. Null until the
   * viewer is opened -- it's a chunky payload nobody needs unless they ask,
   * and it changes constantly while a round is running.
   */
  replay: ReplayData | null

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
  gameType: 'prediction',
  hearts: emptyHearts,
  golf: emptyGolf,
  blackjack: emptyBlackjack,
  spades: emptySpades,
  lowestWins: false,
  tournamentEnded: false,
  spectating: false,
  watchedSeat: null,
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
  rebid: null,
  barredCard: null,
  plays: [],
  trickNumber: 0,
  totalTricks: 0,
  trickWinnerId: null,
  standings: null,
  roleState: null,
  roleBannerKey: 0,
  abilityLog: [],
  activeEffects: [],
  doubleDeadline: null,
  doubled: false,
  restart: { votes: [], needed: 0, waiting: 0 },
  emotes: [],
  replay: null,
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
  | { type: 'restartVote'; data: RestartVote }
  | { type: 'lobby'; data: LobbyUpdate }
  | { type: 'roundStart'; data: Extract<GameStateUpdate, { phase: 'RoundStart' }> }
  | { type: 'bidding'; data: Extract<GameStateUpdate, { phase: 'Bidding' }> }
  | { type: 'playing' }
  | { type: 'hand'; hand: Card[]; barred?: string | null }
  | { type: 'illusion'; cards: string[] }
  | { type: 'rebidPrompt'; data: RebidPrompt | null }
  | { type: 'trickUpdate'; data: TrickUpdate }
  | { type: 'trickResolved'; data: TrickResolved }
  | { type: 'score'; data: ScoreUpdate }
  | { type: 'roundEnded' }
  | { type: 'gameEnded'; standings: Standing[]; lowestWins: boolean; tournament?: boolean }
  | { type: 'heartsRoundStart'; data: HeartsRoundStart }
  | { type: 'passPrompt'; data: PassPrompt }
  | { type: 'passResult'; data: PassResult }
  | { type: 'passSubmitted' }
  | { type: 'heartsState'; data: HeartsState }
  | { type: 'heartsScore'; data: HeartsScoreUpdate }
  | { type: 'golfRoundStart'; data: GolfRoundStart }
  | { type: 'golfState'; data: GolfState }
  | { type: 'golfDrawResult'; data: GolfDrawResult }
  | { type: 'golfResolveSubmitted' }
  | { type: 'golfScore'; data: GolfScoreUpdate }
  | { type: 'blackjackRoundStart'; data: BlackjackRoundStart }
  | { type: 'blackjackState'; data: BlackjackState }
  | { type: 'blackjackScore'; data: BlackjackScoreUpdate }
  | { type: 'spadesRoundStart'; data: SpadesRoundStart }
  | { type: 'spadesState'; data: SpadesState }
  | { type: 'spadesScore'; data: SpadesScoreUpdate }
  | { type: 'roleState'; data: RoleState }
  | { type: 'roleSync'; data: RoleSync }
  | { type: 'announce'; message: string }
  | { type: 'abilityResult'; message: string }
  | { type: 'abilityEffect'; effect: AbilityEffect }
  | { type: 'dismissEffect'; key: number }
  | { type: 'doubleWindow'; seconds: number }
  | { type: 'doubleCommitted' }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chatHistory'; messages: ChatMessage[] }
  | { type: 'chatRead' }
  | { type: 'toast'; message: string | null }
  | { type: 'dropFeed'; id: number }
  | { type: 'snapshot'; data: Snapshot }
  | { type: 'watchedHand'; data: WatchedHand }
  | { type: 'replay'; data: ReplayData | null }
  | { type: 'emote'; data: EmoteBurst }
  | { type: 'dismissEmote'; key: number }
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
        gameType: action.data.gameType,
        hearts: { ...emptyHearts, targetScore: action.data.targetScore },
        golf: { ...emptyGolf, totalHoles: action.data.holeCount },
        blackjack: {
          ...emptyBlackjack,
          mode: action.data.blackjackMode,
          totalRounds: action.data.blackjackRounds,
        },
        spades: { ...emptySpades, targetScore: action.data.spadesTargetScore },
        names,
        totals,
        history: {},
        order: [],
        standings: null,
        roleState: null,
        restart: { votes: [], needed: 0, waiting: 0 },
        watchedSeat: null,
        view: 'lobby',
      }
    }

    case 'restartVote':
      return { ...state, restart: action.data }

    case 'roundStart': {
      const { data } = action
      const order =
        data.roundNumber === 1 || state.order.length === 0 ? [...data.turnOrder] : state.order

      return {
        ...state,
        view: 'game',
        // Only ever wrong once a table can switch games without a lobby
        // step in between (a tournament leg) -- every other round-start case
        // already sets its own gameType explicitly, this one just never
        // needed to before tournaments existed.
        gameType: 'prediction',
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
        rebid: null,
        barredCard: null,
        plays: [],
        trickNumber: 0,
        trickWinnerId: null,
        phase: 'bidding',
        doubled: false,
        doubleDeadline: null,
        // A new deal, a clean private log.
        abilityLog: [],
        emotes: [],
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
      return {
        ...state,
        hand: action.hand,
        // Omitted means "leave it alone": hands are re-sent for reasons that
        // have nothing to do with the bar (a Joker swap, Time Branches), and
        // those must not unbar a card the server is still refusing.
        barredCard: action.barred === undefined ? state.barredCard : action.barred,
      }

    case 'illusion':
      return { ...state, illusionCards: action.cards }

    case 'rebidPrompt':
      return { ...state, rebid: action.data }

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
        lowestWins: action.lowestWins,
        tournamentEnded: action.tournament === true,
        phase: null,
        roleState: null,
      }

    // ---- Hearts -------------------------------------------------------------

    case 'heartsRoundStart': {
      const { data } = action
      const order = data.roundNumber === 1 || state.order.length === 0 ? [...data.turnOrder] : state.order
      return {
        ...state,
        view: 'game',
        gameType: 'hearts',
        standings: null,
        roundNumber: data.roundNumber,
        cardsDealt: data.cardsEach,
        totalTricks: data.cardsEach,
        trumpSuit: '',
        turnOrder: data.turnOrder,
        order,
        history: data.roundNumber === 1 ? {} : state.history,
        tricksWon: {},
        currentTurnId: null,
        leadSuit: null,
        hand: [],
        plays: [],
        trickNumber: 0,
        trickWinnerId: null,
        phase: 'passing',
        hearts: {
          ...emptyHearts,
          targetScore: data.targetScore,
          direction: data.direction,
        },
      }
    }

    case 'passPrompt':
      return {
        ...state,
        phase: 'passing',
        hearts: {
          ...state.hearts,
          direction: action.data.direction,
          passToId: action.data.passToId,
          // count 0 is the no-pass round: nothing to choose, no modal.
          passPending: action.data.count > 0,
        },
      }

    case 'passSubmitted':
      return { ...state, hearts: { ...state.hearts, passPending: false } }

    case 'passResult':
      return {
        ...state,
        hearts: { ...state.hearts, passPending: false, received: action.data.cards },
        // Private, like an ability result: only you know what you were handed.
        ...(action.data.cards.length > 0
          ? {
              nextId: state.nextId + 1,
              feed: [
                ...state.feed,
                {
                  id: state.nextId,
                  message: `you were passed ${action.data.cards.map(displayName).join('  ')}`,
                  secret: true,
                  createdAt: Date.now(),
                },
              ],
            }
          : {}),
      }

    case 'heartsState':
      return {
        ...state,
        hearts: {
          ...state.hearts,
          heartsBroken: action.data.heartsBroken,
          isFirstTrick: action.data.isFirstTrick,
          penalties: action.data.penalties,
          mustLeadCard: action.data.mustLeadCard,
        },
      }

    case 'heartsScore': {
      const { data } = action
      const totals = { ...state.totals }
      const roundScores: Record<string, number> = {}
      for (const line of data.results) {
        totals[line.id] = line.totalScore
        roundScores[line.id] = line.roundScore
      }
      return {
        ...state,
        totals,
        history: { ...state.history, [data.roundNumber]: roundScores },
      }
    }

    // ---- Golf ---------------------------------------------------------------

    case 'golfRoundStart': {
      const { data } = action
      const order =
        data.holeNumber === 1 || state.order.length === 0 ? [...data.turnOrder] : state.order
      return {
        ...state,
        view: 'game',
        gameType: 'golf',
        standings: null,
        roundNumber: data.holeNumber,
        turnOrder: data.turnOrder,
        order,
        history: data.holeNumber === 1 ? {} : state.history,
        phase: 'passing',
        golf: { ...emptyGolf, holeNumber: data.holeNumber, totalHoles: data.totalHoles },
      }
    }

    case 'golfState':
      return {
        ...state,
        golf: {
          ...state.golf,
          grids: action.data.grids,
          discardTop: action.data.discardTop,
          stockCount: action.data.stockCount,
          currentTurnId: action.data.currentTurnId,
          awaitingResolve: action.data.awaitingResolve,
          finalLap: action.data.finalLap,
          finalLapTriggeredBy: action.data.finalLapTriggeredBy,
        },
      }

    case 'golfDrawResult':
      return { ...state, golf: { ...state.golf, pendingDraw: action.data } }

    case 'golfResolveSubmitted':
      return { ...state, golf: { ...state.golf, pendingDraw: null } }

    case 'golfScore': {
      const { data } = action
      const totals = { ...state.totals }
      const roundScores: Record<string, number> = {}
      for (const line of data.results) {
        totals[line.id] = line.totalScore
        roundScores[line.id] = line.gridScore
      }
      return {
        ...state,
        totals,
        history: { ...state.history, [data.holeNumber]: roundScores },
      }
    }

    // ---- Blackjack ------------------------------------------------------------

    case 'blackjackRoundStart': {
      const { data } = action
      const order =
        data.roundNumber === 1 || state.order.length === 0 ? [...data.turnOrder] : state.order
      return {
        ...state,
        view: 'game',
        gameType: 'blackjack',
        standings: null,
        roundNumber: data.roundNumber,
        turnOrder: data.turnOrder,
        order,
        history: data.roundNumber === 1 ? {} : state.history,
        phase: 'playing',
        blackjack: {
          ...emptyBlackjack,
          roundNumber: data.roundNumber,
          totalRounds: data.totalRounds,
          mode: data.mode,
        },
      }
    }

    case 'blackjackState':
      return {
        ...state,
        blackjack: {
          ...state.blackjack,
          hands: action.data.hands,
          dealerHand: action.data.dealerHand,
          dealerTotal: action.data.dealerTotal,
          dealerBusted: action.data.dealerBusted,
          currentTurnId: action.data.currentTurnId,
          mode: action.data.mode,
        },
      }

    case 'blackjackScore': {
      const { data } = action
      const totals = { ...state.totals }
      const roundScores: Record<string, number> = {}
      for (const line of data.results) {
        totals[line.id] = line.totalScore
        roundScores[line.id] = line.roundScore
      }
      return {
        ...state,
        totals,
        history: { ...state.history, [data.roundNumber]: roundScores },
      }
    }

    case 'spadesRoundStart': {
      const { data } = action
      const order =
        data.handNumber === 1 || state.order.length === 0 ? [...data.turnOrder] : state.order
      return {
        ...state,
        view: 'game',
        gameType: 'spades',
        standings: null,
        roundNumber: data.handNumber,
        cardsDealt: 13,
        totalTricks: 13,
        trumpSuit: 'Spades',
        turnOrder: data.turnOrder,
        order,
        history: data.handNumber === 1 ? {} : state.history,
        tricksWon: {},
        currentTurnId: null,
        leadSuit: null,
        hand: [],
        plays: [],
        trickNumber: 0,
        trickWinnerId: null,
        phase: 'bidding',
        spades: {
          ...emptySpades,
          handNumber: data.handNumber,
          targetScore: data.targetScore,
          teams: data.teams,
        },
      }
    }

    case 'spadesState':
      return {
        ...state,
        spades: {
          ...state.spades,
          phase: action.data.phase,
          biddingTurnId: action.data.biddingTurnId,
          bids: action.data.bids,
          spadesBroken: action.data.spadesBroken,
          bags: action.data.bags,
        },
      }

    case 'spadesScore': {
      const { data } = action
      const totals = { ...state.totals }
      const roundScores: Record<string, number> = {}
      for (const team of data.teams) {
        for (const player of team.players) {
          totals[player.id] = team.totalScore
          roundScores[player.id] = team.roundScore
        }
      }
      return {
        ...state,
        totals,
        history: { ...state.history, [data.handNumber]: roundScores },
      }
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
      // Never derived from the bids above: those may carry a Judge's disguise.
      if (action.data.bidSum != null) next.bidSum = action.data.bidSum
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
        // APPENDED, never replaced: your own ability's result and whatever
        // somebody else quietly did to you both arrive here, and the panel has
        // to show all of it.
        abilityLog: [...state.abilityLog, action.message],
        feed: [
          ...state.feed,
          { id: state.nextId, message: action.message, secret: true, createdAt: Date.now() },
        ],
      }

    case 'abilityEffect':
      return {
        ...state,
        nextId: state.nextId + 1,
        activeEffects: [...state.activeEffects, { ...action.effect, key: state.nextId }],
      }

    case 'dismissEffect':
      return { ...state, activeEffects: state.activeEffects.filter((e) => e.key !== action.key) }

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
        gameType: data.gameType,
        hearts: data.hearts
          ? {
              ...emptyHearts,
              targetScore: data.hearts.targetScore,
              direction: data.hearts.direction,
              passToId: data.hearts.passToId,
              passPending: data.hearts.passPending,
              heartsBroken: data.hearts.heartsBroken,
              isFirstTrick: data.hearts.isFirstTrick,
              penalties: data.hearts.penalties,
              mustLeadCard: data.hearts.mustLeadCard,
            }
          : emptyHearts,
        golf: data.golf
          ? {
              holeNumber: data.golf.holeNumber,
              totalHoles: data.golf.totalHoles,
              grids: data.golf.grids,
              discardTop: data.golf.discardTop,
              stockCount: data.golf.stockCount,
              currentTurnId: data.golf.currentTurnId,
              awaitingResolve: data.golf.awaitingResolve,
              finalLap: data.golf.finalLap,
              finalLapTriggeredBy: data.golf.finalLapTriggeredBy,
              pendingDraw: data.golf.pendingDraw,
            }
          : emptyGolf,
        blackjack: data.blackjack
          ? {
              roundNumber: data.blackjack.roundNumber,
              totalRounds: data.blackjack.totalRounds,
              mode: data.blackjack.mode,
              hands: data.blackjack.hands,
              dealerHand: data.blackjack.dealerHand,
              dealerTotal: data.blackjack.dealerTotal,
              dealerBusted: data.blackjack.dealerBusted,
              currentTurnId: data.blackjack.currentTurnId,
            }
          : emptyBlackjack,
        spades: data.spades
          ? {
              handNumber: data.spades.handNumber,
              targetScore: data.spades.targetScore,
              teams: data.spades.teams,
              phase: data.spades.phase,
              biddingTurnId: data.spades.biddingTurnId,
              bids: data.spades.bids,
              spadesBroken: data.spades.spadesBroken,
              bags: data.spades.bags,
            }
          : emptySpades,
        phase:
          data.phase === 'Playing' ? 'playing' : data.phase === 'Passing' ? 'passing' : 'bidding',
        bids: data.bids,
        bidSum: data.bidSum,
        tricksWon: data.tricksWon,
        totals: data.totals,
        history: data.history,
        currentTurnId: data.currentTurnId,
        leadSuit: data.leadSuit,
        hand: data.hand,
        illusionCards: data.illusion,
        rebid: data.rebid,
        barredCard: data.barred,
        plays: data.plays,
        trickNumber: data.trickNumber,
        trickWinnerId: null,
        roleState: data.roleState,
        chat: data.chat,
        restart: data.restart,
        spectating: data.spectating,
        standings: null,
      }
    }

    case 'watchedHand':
      return { ...state, watchedSeat: action.data }

    case 'replay':
      return { ...state, replay: action.data }

    case 'emote':
      return {
        ...state,
        nextId: state.nextId + 1,
        emotes: [...state.emotes, { ...action.data, key: state.nextId }],
      }

    case 'dismissEmote':
      return { ...state, emotes: state.emotes.filter((e) => e.key !== action.key) }

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

  // How many cards `trickUpdate` last reported in the live trick, so a card
  // sound fires only for a genuinely NEW play, not the empty-plays broadcast
  // that opens every trick or the shrink a Rewind causes mid-trick.
  const lastPlaysLengthRef = useRef(0)

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

    socket.on('dealHand', (data) =>
      dispatch({ type: 'hand', hand: data.hand, barred: data.barred }),
    )
    socket.on('illusion', (data) => dispatch({ type: 'illusion', cards: data.cards }))
    socket.on('rebidPrompt', (data) => dispatch({ type: 'rebidPrompt', data }))
    socket.on('trickUpdate', (data) => {
      if (data.plays.length > lastPlaysLengthRef.current) playCardPlay()
      lastPlaysLengthRef.current = data.plays.length
      dispatch({ type: 'trickUpdate', data })
    })
    socket.on('trickResolved', (data) => {
      dispatch({ type: 'trickResolved', data })
      playTrickWin()
    })
    socket.on('scoreUpdate', (data) => dispatch({ type: 'score', data }))
    socket.on('roundEnded', () => {
      dispatch({ type: 'roundEnded' })
      playRoundEnd()
    })
    socket.on('gameEnded', (data) =>
      dispatch({
        type: 'gameEnded',
        standings: data.standings,
        lowestWins: data.lowestWins,
        tournament: data.tournament,
      }),
    )

    socket.on('heartsRoundStart', (data) => dispatch({ type: 'heartsRoundStart', data }))
    socket.on('passPrompt', (data) => dispatch({ type: 'passPrompt', data }))
    socket.on('passResult', (data) => dispatch({ type: 'passResult', data }))
    socket.on('heartsState', (data) => dispatch({ type: 'heartsState', data }))
    socket.on('heartsScoreUpdate', (data) => dispatch({ type: 'heartsScore', data }))
    socket.on('golfRoundStart', (data) => dispatch({ type: 'golfRoundStart', data }))
    socket.on('golfState', (data) => dispatch({ type: 'golfState', data }))
    socket.on('golfDrawResult', (data) => dispatch({ type: 'golfDrawResult', data }))
    socket.on('golfScoreUpdate', (data) => dispatch({ type: 'golfScore', data }))
    socket.on('blackjackRoundStart', (data) => dispatch({ type: 'blackjackRoundStart', data }))
    socket.on('blackjackState', (data) => dispatch({ type: 'blackjackState', data }))
    socket.on('blackjackScoreUpdate', (data) => dispatch({ type: 'blackjackScore', data }))
    socket.on('spadesRoundStart', (data) => dispatch({ type: 'spadesRoundStart', data }))
    socket.on('spadesState', (data) => dispatch({ type: 'spadesState', data }))
    socket.on('spadesScoreUpdate', (data) => dispatch({ type: 'spadesScore', data }))
    socket.on('snapshot', (data) => dispatch({ type: 'snapshot', data }))
    socket.on('restartVote', (data) => dispatch({ type: 'restartVote', data }))
    socket.on('watchedHand', (data) => dispatch({ type: 'watchedHand', data }))
    socket.on('replayData', (data) => dispatch({ type: 'replay', data }))
    socket.on('emoteBurst', (data) => dispatch({ type: 'emote', data }))

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
    socket.on('abilityEffect', (data) => {
      dispatch({ type: 'abilityEffect', effect: data })
      playAbilityEffect(data)
    })

    return () => {
      socket.removeAllListeners()
    }
  }, [])

  // Dev-only escape hatch for smoke-testing EffectLayer without a server-side
  // ability wired up to emit one yet.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return
    ;(window as unknown as { __fireEffect?: (effect: AbilityEffect) => void }).__fireEffect = (
      effect,
    ) => {
      dispatch({ type: 'abilityEffect', effect })
      playAbilityEffect(effect)
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
      /** `gameType` only means anything when opening a new table. */
      join(name: string, roomCode: string | null, gameType?: GameType) {
        rememberName(name)
        socket.emit('join', { name, roomCode, playerId: storedPlayerId(), gameType })
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
      setGameType(gameType: GameType) {
        socket.emit('setGameType', gameType)
      },
      setTargetScore(score: number) {
        socket.emit('setTargetScore', score)
      },
      setHoleCount(holes: number) {
        socket.emit('setHoleCount', holes)
      },
      setTournamentGames(games: GameType[]) {
        socket.emit('setTournamentGames', games)
      },
      /** Host only, lobby only: list this table in the public browser. */
      setPublic(isPublic: boolean) {
        socket.emit('setPublic', isPublic)
      },
      setBlackjackMode(mode: BlackjackMode) {
        socket.emit('setBlackjackMode', mode)
      },
      setBlackjackRounds(rounds: number) {
        socket.emit('setBlackjackRounds', rounds)
      },
      setSpadesTargetScore(score: number) {
        socket.emit('setSpadesTargetScore', score)
      },
      submitSpadesBid(bid: SpadesBid) {
        socket.emit('submitSpadesBid', bid)
      },
      /**
       * Hearts: give three cards away. Closed optimistically -- the server
       * answers with passResult only once EVERYONE has chosen, and leaving the
       * modal up until then would look like the click didn't land.
       */
      passCards(cards: Card[]) {
        dispatch({ type: 'passSubmitted' })
        socket.emit('passCards', cards)
      },
      submitBid(bid: number) {
        socket.emit('submitBid', bid)
      },
      submitRebid(bid: number) {
        // Closed optimistically: nothing on the server is waiting on this, so
        // leaving the modal up until a broadcast lands would just feel stuck.
        dispatch({ type: 'rebidPrompt', data: null })
        socket.emit('submitRebid', bid)
      },
      /** Walk away from the do-over and keep the bid you already had. */
      dismissRebid() {
        dispatch({ type: 'rebidPrompt', data: null })
      },
      declareDouble() {
        dispatch({ type: 'doubleCommitted' })
        socket.emit('declareDouble')
      },
      playCard(card: Card) {
        socket.emit('playCard', card)
      },
      /** Golf: your two starting flips. */
      revealInitial(slots: [number, number]) {
        socket.emit('golfRevealInitial', slots)
      },
      /** Golf: draw from the stock or take the discard pile's top card. */
      golfDraw(source: GolfDrawSource) {
        socket.emit('golfDraw', source)
      },
      /** Golf: what to do with the card you just drew. */
      golfResolve(resolveAction: GolfResolveAction) {
        dispatch({ type: 'golfResolveSubmitted' })
        socket.emit('golfResolve', resolveAction)
      },
      /** Blackjack: hit, stand, or double on your turn. */
      blackjackAction(action: BlackjackActionKind) {
        socket.emit('blackjackAction', action)
      },
      useAbility(payload: UseAbilityPayload) {
        socket.emit('useAbility', payload)
      },
      /**
       * Vote to abandon the game in progress and reopen the lobby, so anyone
       * spectating gets a chair. A toggle: sending false takes the vote back.
       * No optimistic update -- the tally comes back from the server, which is
       * also the only thing that knows when the vote has passed.
       */
      voteRestart(vote: boolean) {
        socket.emit('voteRestart', vote)
      },
      sendChat(text: string) {
        socket.emit('chat', text)
      },
      markChatRead() {
        dispatch({ type: 'chatRead' })
      },
      dismissEffect(key: number) {
        dispatch({ type: 'dismissEffect', key })
      },
      /** Spectator-only: pick a seat to watch read-only, or null to stop. */
      watchSeat(seatId: string | null) {
        socket.emit('watchSeat', seatId)
      },
      /** React to what just happened. Seats only; the server rate-limits. */
      sendEmote(emoteId: string) {
        socket.emit('emote', emoteId)
      },
      dismissEmote(key: number) {
        dispatch({ type: 'dismissEmote', key })
      },
      /** Fetch every trick played this game, for the replay viewer. */
      requestReplay() {
        socket.emit('requestReplay')
      },
      /** Drop the fetched replay, so reopening the viewer asks for a fresh one. */
      closeReplay() {
        dispatch({ type: 'replay', data: null })
      },
    }),
    [],
  )

  return { store, actions }
}

export type GameActions = ReturnType<typeof useGame>['actions']
