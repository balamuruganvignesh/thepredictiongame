// The wire protocol: every server<->client message the game sends.
//
// Client -> Server: join, toggleReady, startGame, setMode, submitBid,
//                   declareDouble, playCard, useAbility, requestState
// Server -> Client: joined, joinError, lobbyUpdate, gameState, dealHand,
//                   trickUpdate, trickResolved, roundEnded, scoreUpdate,
//                   gameEnded, actionError, doubleWindow, gameLog, roleState,
//                   abilityResult, roleAnnounce, roleSync, snapshot

import type { Card, Suit } from './cards'

export type PlayerId = string
export type GameMode = 'classic' | 'chaos'
export type Phase = 'RoundStart' | 'Bidding' | 'Playing'

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
    }
  | { phase: 'Playing'; roundNumber: number }

export type DealHand = { hand: Card[]; roundNumber?: number; trumpSuit?: string }

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

export type GameEnded = { standings: Standing[] }

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
}

export type UseAbilityPayload = {
  targetId?: PlayerId
  targetId2?: PlayerId
  direction?: 1 | -1
  suit?: Suit
}

/**
 * The Detective's Illusion: card keys in YOUR hand to render as if they were
 * unplayable. Purely cosmetic -- the server never consults this when checking
 * a play, so every greyed card is still perfectly legal. An empty list clears
 * the effect.
 */
export type Illusion = { cards: string[] }

// ---- Reconnect --------------------------------------------------------------

/**
 * Everything a client needs to re-render a game already in progress. A page
 * refresh mid-round is routine, so the server can replay its whole view.
 */
export type Snapshot = {
  inGame: boolean
  roster: RosterEntry[]
  mode: GameMode
  roundNumber: number
  cardsDealt: number
  trumpSuit: string
  turnOrder: PlayerId[]
  phase: Phase
  bids: Record<PlayerId, number>
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
  /** Recent chat, so a refresh doesn't wipe the conversation. */
  chat: ChatMessage[]
}

export type Joined = { playerId: PlayerId; roomCode: string; name: string }

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
  snapshot: (data: Snapshot) => void
}

export interface ClientToServerEvents {
  join: (data: { roomCode: string | null; name: string; playerId: string | null }) => void
  toggleReady: (ready: boolean) => void
  startGame: () => void
  setMode: (mode: GameMode) => void
  submitBid: (bid: number) => void
  declareDouble: () => void
  playCard: (card: Card) => void
  useAbility: (payload: UseAbilityPayload) => void
  requestState: () => void
  chat: (text: string) => void
}
