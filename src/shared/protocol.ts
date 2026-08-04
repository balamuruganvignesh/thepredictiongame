// The wire protocol: every server<->client message the game sends.
//
// Client -> Server: join, toggleReady, startGame, setMode, setGameType,
//                   setTargetScore, submitBid, submitRebid, declareDouble,
//                   playCard, passCards, useAbility, requestState
// Server -> Client: joined, joinError, lobbyUpdate, gameState, dealHand,
//                   trickUpdate, trickResolved, roundEnded, scoreUpdate,
//                   gameEnded, actionError, doubleWindow, gameLog, roleState,
//                   abilityResult, roleAnnounce, roleSync, rebidPrompt,
//                   snapshot, heartsRoundStart, passPrompt, passResult,
//                   heartsState, heartsScoreUpdate
//
// Two games share this protocol. Everything about the table -- joining, the
// roster, chat, spectators, the trick area, reconnect -- is common; the
// bidding events belong to the Prediction Game and the hearts* / pass* events
// to Hearts, and neither game ever emits the other's.

import type { Card, Suit } from './cards'
import type { PassDirection } from './heartsRules'

export type PlayerId = string
export type GameMode = 'classic' | 'chaos'
/** Which game this table is playing. Chaos is a Prediction Game mode only. */
export type GameType = 'prediction' | 'hearts'
export type Phase = 'RoundStart' | 'Bidding' | 'Playing' | 'Passing'

// ---- Lobby ------------------------------------------------------------------

export type RosterEntry = {
  id: PlayerId
  name: string
  ready: boolean
  connected: boolean
  isHost: boolean
}

export type LobbyUpdate = {
  roomCode: string
  roster: RosterEntry[]
  minPlayers: number
  maxPlayers: number
  hostId: PlayerId | null
  canStart: boolean
  mode: GameMode
  /** Which game the host has the table set to. */
  gameType: GameType
  /** Hearts only: the score that ends the game. Ignored by the other game. */
  targetScore: number
  /** Names of anyone watching a game in progress, waiting for a chair. */
  spectators: string[]
}

// ---- Game state -------------------------------------------------------------

export type GameStateUpdate =
  | {
      phase: 'RoundStart'
      roundNumber: number
      cardsDealt: number
      trumpSuit: string
      dealerId: PlayerId
      turnOrder: PlayerId[]
    }
  | {
      phase: 'Bidding'
      currentTurnId: PlayerId | null
      bids: Record<PlayerId, number>
      cardsDealt: number
      /**
       * The TRUE total of every bid placed so far. Sent separately because
       * `bids` may carry a Judge's Imposter disguise, and the last bidder's
       * forbidden bid is derived from the real sum -- deriving it from the
       * displayed numbers would forbid the wrong chip and get the player's
       * bid rejected by the server.
       */
      bidSum: number
    }
  | { phase: 'Playing'; roundNumber: number }

export type DealHand = {
  hand: Card[]
  roundNumber?: number
  trumpSuit?: string
  /**
   * A card in this hand that CANNOT be played right now -- a Time Traveler's
   * Rewind bars the card you just played, and you have to choose differently.
   *
   * Three states on purpose: a cardKey sets the bar, `null` clears it, and
   * OMITTING it leaves whatever the client has alone. Hands get re-sent for
   * reasons unrelated to the bar (a Joker swap, Time Branches), and those must
   * not quietly unbar a card the server is still refusing.
   */
  barred?: string | null
}

export type PlayEntry = { id: PlayerId; card: Card }

export type TrickUpdate = {
  currentTurnId: PlayerId | null
  plays: PlayEntry[]
  leadSuit: string | null
  trickNumber: number
  totalTricks: number
}

export type TrickResolved = {
  plays: PlayEntry[]
  winnerId: PlayerId
  trickNumber: number
  totalTricks: number
  /** false when chaos mode voided the win (Gravekeeper). */
  counted: boolean
}

export type RoundResult = {
  id: PlayerId
  bid: number
  tricksWon: number
  doubled: boolean
  roundScore: number
  totalScore: number
}

export type ScoreUpdate = { roundNumber: number; results: RoundResult[] }

export type Standing = {
  id: PlayerId
  name: string
  totalScore: number
  roleName?: string
  roleEmoji?: string
}

export type GameEnded = {
  standings: Standing[]
  /**
   * Hearts is a golf score: the standings arrive sorted ASCENDING and the
   * lowest total is the winner. The Prediction Game is the other way round.
   */
  lowestWins: boolean
}

export type DoubleWindow = { seconds: number }

// ---- Chat -------------------------------------------------------------------

export type ChatMessage = {
  id: number
  /** null for system lines ("Ada joined the table"). */
  from: PlayerId | null
  name: string
  text: string
}

export const MAX_CHAT_LENGTH = 300

// ---- Chaos mode -------------------------------------------------------------

export type RoleState = {
  active: boolean
  roleId: string | null
  abilityId: string | null
  used: boolean
  handSwapUsed: boolean
  /** Round intro triggers the client's role banner + ability slot roll. */
  roundIntro: boolean
}

export type AbilityResult = { message: string }
export type RoleAnnounce = { message: string }
export type RoleSync = {
  bids?: Record<PlayerId, number>
  tricks?: Record<PlayerId, number>
  /**
   * The TRUE total of every bid placed, resent whenever an ability changed a
   * REAL bid. Load-bearing during the bidding phase: a Time Traveler's Reverse
   * Time can rewrite an earlier bid while people are still bidding, and the
   * last bidder's forbidden chip comes off this number. Leave it stale and the
   * UI forbids the wrong chip, the server rejects the bid the UI allowed, and
   * with no turn timers the round hangs there forever.
   */
  bidSum?: number
}

export type UseAbilityPayload = {
  targetId?: PlayerId
  targetId2?: PlayerId
  direction?: 1 | -1
  suit?: Suit
  /** Read the Table: which end of the hand to read. */
  peek?: 'high' | 'low'
  /**
   * Illusion: blanket ONE player's whole hand, or put one dead-looking card in
   * EVERY other hand. With 'one' the payload also carries a targetId.
   */
  scope?: 'one' | 'all'
  /** Alternate Universe: whose ability set to draw a new ability from. */
  roleId?: string
  /** Time Branches: the card in YOUR hand to put back, as a cardKey. */
  cardKey?: string
}

/**
 * The Time Traveler's Reverse Time reopened your bid: pick a new one. Unlike
 * the opening bid this is NOT a turn -- the round carries on around you, and
 * dismissing the prompt simply keeps the bid you already had. Every number from 0
 * to cardsDealt is offered: a rewrite isn't bound by the last-bidder sum rule.
 */
export type RebidPrompt = { cardsDealt: number; currentBid: number }

/**
 * The Detective's Illusion: card keys in YOUR hand to render as if they were
 * unplayable. Purely cosmetic -- the server never consults this when checking
 * a play, so every greyed card is still perfectly legal. An empty list clears
 * the effect.
 */
export type Illusion = { cards: string[] }

// ---- Hearts -----------------------------------------------------------------
//
// Deliberately its own set of events rather than bids-with-different-meanings:
// the two games share the table, the chat and the trick area, and nothing else.

export type HeartsRoundStart = {
  roundNumber: number
  cardsEach: number
  direction: PassDirection
  /** Who your three cards go to, or null on a no-pass round. */
  passToId: PlayerId | null
  targetScore: number
  turnOrder: PlayerId[]
}

/** Your turn to choose three cards. Everyone gets this at once. */
export type PassPrompt = {
  direction: PassDirection
  passToId: PlayerId | null
  count: number
}

/** The three cards that came the other way, once every seat has chosen. */
export type PassResult = { cards: Card[]; fromId: PlayerId | null }

export type HeartsState = {
  heartsBroken: boolean
  isFirstTrick: boolean
  /** Penalty points each player has taken SO FAR this round. */
  penalties: Record<PlayerId, number>
  /**
   * The one card that may open the round (the 2 of Clubs, or the lowest club
   * left after an uneven deal). null once the opening lead has been played.
   */
  mustLeadCard: Card | null
}

export type HeartsRoundLineWire = {
  id: PlayerId
  hearts: number
  hadQueen: boolean
  shotMoon: boolean
  roundScore: number
  totalScore: number
}

export type HeartsScoreUpdate = { roundNumber: number; results: HeartsRoundLineWire[] }

/** The Hearts half of a reconnect snapshot; null while playing the other game. */
export type HeartsSnapshot = {
  targetScore: number
  direction: PassDirection
  passToId: PlayerId | null
  /** Still owing three cards: the pass modal comes back up on a refresh. */
  passPending: boolean
  heartsBroken: boolean
  isFirstTrick: boolean
  penalties: Record<PlayerId, number>
  mustLeadCard: Card | null
}

// ---- Reconnect --------------------------------------------------------------

/**
 * Everything a client needs to re-render a game already in progress. A page
 * refresh mid-round is routine, so the server can replay its whole view.
 */
export type Snapshot = {
  inGame: boolean
  roster: RosterEntry[]
  mode: GameMode
  gameType: GameType
  /** Everything Hearts-specific; null when the table is playing the other game. */
  hearts: HeartsSnapshot | null
  roundNumber: number
  cardsDealt: number
  trumpSuit: string
  turnOrder: PlayerId[]
  phase: Phase
  bids: Record<PlayerId, number>
  /** TRUE total of bids placed so far -- see the Bidding update's bidSum. */
  bidSum: number
  tricksWon: Record<PlayerId, number>
  totals: Record<PlayerId, number>
  history: Record<number, Record<PlayerId, number>>
  currentTurnId: PlayerId | null
  leadSuit: string | null
  plays: PlayEntry[]
  trickNumber: number
  hand: Card[]
  roleState: RoleState | null
  /** Any Illusion currently cast on this player's hand. */
  illusion: string[]
  /** A Reverse Time prompt still waiting on this player, so a refresh keeps it. */
  rebid: RebidPrompt | null
  /** A card a Rewind is currently barring this player from replaying. */
  barred: string | null
  /** Recent chat, so a refresh doesn't wipe the conversation. */
  chat: ChatMessage[]
  /** Watching rather than playing: no hand, no turn, no abilities. */
  spectating: boolean
}

export type Joined = {
  playerId: PlayerId
  roomCode: string
  name: string
  /**
   * True when the table was mid-game on arrival: you're watching, not seated.
   * You get a chair automatically when the game ends and the table reopens.
   */
  spectating: boolean
}

// ---- Event maps -------------------------------------------------------------

export interface ServerToClientEvents {
  joined: (data: Joined) => void
  joinError: (message: string) => void
  lobbyUpdate: (data: LobbyUpdate) => void
  gameState: (data: GameStateUpdate) => void
  dealHand: (data: DealHand) => void
  trickUpdate: (data: TrickUpdate) => void
  trickResolved: (data: TrickResolved) => void
  roundEnded: (data: { roundNumber: number }) => void
  scoreUpdate: (data: ScoreUpdate) => void
  gameEnded: (data: GameEnded) => void
  actionError: (message: string) => void
  doubleWindow: (data: DoubleWindow) => void
  chat: (data: ChatMessage) => void
  chatHistory: (data: ChatMessage[]) => void
  roleState: (data: RoleState) => void
  abilityResult: (data: AbilityResult) => void
  roleAnnounce: (data: RoleAnnounce) => void
  roleSync: (data: RoleSync) => void
  illusion: (data: Illusion) => void
  rebidPrompt: (data: RebidPrompt) => void
  snapshot: (data: Snapshot) => void
  heartsRoundStart: (data: HeartsRoundStart) => void
  passPrompt: (data: PassPrompt) => void
  passResult: (data: PassResult) => void
  heartsState: (data: HeartsState) => void
  heartsScoreUpdate: (data: HeartsScoreUpdate) => void
}

export interface ClientToServerEvents {
  join: (data: {
    roomCode: string | null
    name: string
    playerId: string | null
    /**
     * Which game a NEW table opens on. Ignored when joining an existing table:
     * the game is a property of the table, and the host changes it in the lobby.
     */
    gameType?: GameType
  }) => void
  toggleReady: (ready: boolean) => void
  startGame: () => void
  setMode: (mode: GameMode) => void
  /** Host only, lobby only: switch the table between the two games. */
  setGameType: (gameType: GameType) => void
  /** Host only, lobby only: the score that ends a Hearts game. */
  setTargetScore: (score: number) => void
  /** Hearts: the three cards you're giving away. */
  passCards: (cards: Card[]) => void
  submitBid: (bid: number) => void
  /** Answering a Reverse Time prompt. Not a turn -- nothing waits on it. */
  submitRebid: (bid: number) => void
  declareDouble: () => void
  playCard: (card: Card) => void
  useAbility: (payload: UseAbilityPayload) => void
  requestState: () => void
  chat: (text: string) => void
}
