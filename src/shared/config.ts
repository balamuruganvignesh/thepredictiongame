// Central tunable configuration. Shared between server and client so both
// agree on the rules.

export type MissPenaltyMode = 'scaled' | 'flat'

export const Config = {
  minPlayers: 2,
  maxPlayers: 10,

  // Cards dealt per round. 5-4-3-2-1-1-2-3-4-5 = 10 rounds total.
  cardSequence: [5, 4, 3, 2, 1, 1, 2, 3, 4, 5],

  // Trump suit cycles through this list, one per round, wrapping around.
  trumpRotation: ['Spades', 'Diamonds', 'Clubs', 'Hearts', 'NoTrump'],

  // House rule: restrict "Double" to only be declared on a bid of 0.
  doubleOnlyOnZeroBid: false,

  // After placing a bid, a player has this long to declare Double before the
  // next player bids. Once it expires the chance is gone for the round.
  doubleWindowSeconds: 5,

  // "scaled": score = -(abs(bid - tricksWon))
  // "flat": score = flatMissPenalty, regardless of how far off the bid was
  missPenaltyMode: 'scaled' as MissPenaltyMode,
  flatMissPenalty: -10,

  // Note: there are deliberately no turn timers. A player is never skipped for
  // thinking too long; the server only auto-plays for a seat that has actually
  // disconnected, so a round can't hang on an empty chair.

  // Pacing between phases.
  trickResolvePause: 1.5, // after a trick resolves, before the next lead
  roundEndPause: 4, // scoreboard reading time between rounds
  gameEndPause: 12, // final standings display before returning to lobby

  // Web-only: a seat that has been gone this long during the lobby loses its
  // reservation, so a refresh reconnects but a leaver frees the chair.
  reconnectGraceSeconds: 45,
} as const

export const TOTAL_ROUNDS = Config.cardSequence.length

export function trumpForRound(roundNumber: number): string {
  return Config.trumpRotation[(roundNumber - 1) % Config.trumpRotation.length]
}
