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
  // Beat between one card hitting the table and the next player's turn opening,
  // so a trick can actually be watched rather than snapping past. Nobody holds
  // the turn during it -- the hand is simply not clickable yet -- so it is a
  // pause, never a skip.
  playPause: 3,
  trickResolvePause: 1.5, // after a trick resolves, before the next lead
  roundEndPause: 4, // scoreboard reading time between rounds
  gameEndPause: 12, // final standings display before returning to lobby

  // Web-only: a seat that has been gone this long during the lobby loses its
  // reservation, so a refresh reconnects but a leaver frees the chair.
  reconnectGraceSeconds: 45,
} as const

/**
 * Hearts. A separate table size from the Prediction Game: the deck is dealt out
 * whole, so past seven players a hand is barely long enough for the penalty
 * cards to move around.
 */
export const HeartsConfig = {
  minPlayers: 3,
  maxPlayers: 7,

  // The game ends after the round in which somebody crosses this; lowest total
  // wins. Host-selectable in the lobby.
  targetScoreOptions: [50, 100, 200],
  defaultTargetScore: 100,

  // Safety net only. A game that somehow never reaches the target still ends.
  maxRounds: 40,

  // Pacing, matching the Prediction Game's feel.
  passPause: 2, // after the pass lands, before the first lead
  trickResolvePause: 1.5,
  roundEndPause: 5, // one extra second: there's more to read on a hearts sheet
} as const

export type HeartsTargetScore = (typeof HeartsConfig.targetScoreOptions)[number]

/**
 * Golf. Fixed round count like the Prediction Game (nine holes, not "until
 * someone crosses a target" like Hearts) -- lowest cumulative score when the
 * ninth hole ends wins.
 */
export const GolfConfig = {
  minPlayers: 2,
  maxPlayers: 6,

  totalHoles: 9,

  // Pacing.
  revealPause: 2, // after everyone's initial two cards are up, before turns start
  turnPause: 1, // beat after a swap/flip lands, so it can be read
  holeEndPause: 4, // scoreboard reading time between holes
} as const

export const TOTAL_ROUNDS = Config.cardSequence.length

export function trumpForRound(roundNumber: number): string {
  return Config.trumpRotation[(roundNumber - 1) % Config.trumpRotation.length]
}
