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
  totalScore: number
  lastRoundScore: number | null
  /** ms timestamp of the disconnect, for the lobby's reconnect grace period. */
  disconnectedAt: number | null
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
