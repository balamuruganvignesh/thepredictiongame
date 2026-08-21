import type { Card } from '@shared/cards'

/**
 * A chair at the table. Bound to a socket id that can come and go, since a
 * player refreshing the page has to land back in the same chair.
 */
export type Seat = {
  id: string
  socketId: string | null
  name: string
  seatIndex: number
  ready: boolean
  connected: boolean
  hand: Card[]
  bid: number | null
  hasDoubled: boolean
  tricksWon: number
  /** Hearts: every card in every trick this seat has won this round. */
  collected: Card[]
  /** Hearts: the three cards chosen for the pass, until the pass resolves. */
  passSelection: Card[] | null
  /** Golf: this seat's 6-card grid, row-major (0-2 top row, 3-5 bottom row). */
  golfGrid: Card[]
  /** Golf: which of the 6 grid slots are face-up. Nobody -- not even the owner -- sees the rest. */
  golfRevealed: boolean[]
  /** Blackjack: this seat's hand for the current round. Always dealt face up. */
  blackjackHand: Card[]
  /** Blackjack: stood, busted, doubled-and-drew, or dealt a natural -- no more actions this round. */
  blackjackDone: boolean
  /** Blackjack: doubled down this round, so the round's point swing is x2. */
  blackjackDoubled: boolean
  /** Spades: this seat's bid for the current hand -- 0-13, 'nil', or null before bidding. */
  spadesBid: number | 'nil' | null
  /** Spades: this seat's TEAM's running bag count (0-9), mirrored on both partners. */
  spadesBags: number
  totalScore: number
  lastRoundScore: number | null
  /** ms timestamp of the disconnect, for the lobby's reconnect grace period. */
  disconnectedAt: number | null
  /**
   * Shop items this player owns, resolved ONCE at join and carried here.
   * Room must not hit SQLite per reaction -- an emote is a hot path and a
   * synchronous read on every one of them would block the whole process,
   * which hosts every table.
   */
  ownedItems: string[]
  /** Preset id from shared/avatars.ts, resolved at join. */
  avatar: string | null
  /** A Google account picture, resolved server-side at join. */
  avatarUrl: string | null
}

/**
 * Someone watching a game that was already running when they arrived. Not a
 * chair: no hand, no turn, no abilities. They hold an id so a refresh keeps
 * them watching, and they're converted into a real Seat when the table
 * reopens between games.
 */
export type Spectator = {
  id: string
  socketId: string
  name: string
  /** Carried across when seatSpectators() turns them into a real chair. */
  ownedItems: string[]
  avatar: string | null
  avatarUrl: string | null
}

export const sleep = (seconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000))

/** Fisher-Yates, in place. */
export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

export const randomInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1))
