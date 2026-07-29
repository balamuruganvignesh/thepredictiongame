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
  totalScore: number
  lastRoundScore: number | null
  /** ms timestamp of the disconnect, for the lobby's reconnect grace period. */
  disconnectedAt: number | null
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
