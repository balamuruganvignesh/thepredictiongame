// The wire protocol: every server<->client message the game sends.
//
// Client -> Server: join, toggleReady, startGame, setMode, setGameType,
//                   setTargetScore, setHoleCount, setTournamentGames, submitBid,
//                   submitRebid, declareDouble, playCard, passCards, useAbility,
//                   requestState, voteRestart, golfRevealInitial, golfDraw,
//                   golfResolve, setBlackjackMode, setBlackjackRounds,
//                   blackjackAction, setSpadesTargetScore, submitSpadesBid
// Server -> Client: joined, joinError, lobbyUpdate, gameState, dealHand,
//                   trickUpdate, trickResolved, roundEnded, scoreUpdate,
//                   gameEnded, actionError, doubleWindow, gameLog, roleState,
//                   abilityResult, roleAnnounce, abilityEffect, roleSync,
//                   rebidPrompt, snapshot, heartsRoundStart, passPrompt,
//                   passResult, heartsState, heartsScoreUpdate, restartVote,
//                   golfRoundStart, golfState, golfDrawResult, golfScoreUpdate,
//                   blackjackRoundStart, blackjackState, blackjackScoreUpdate,
//                   spadesRoundStart, spadesState, spadesScoreUpdate
//
// Five games share this protocol. Everything about the table -- joining, the
// roster, chat, spectators, the trick area, reconnect -- is common; the
// bidding events belong to the Prediction Game, the hearts* / pass* events to
// Hearts, the golf* events to Golf, the blackjack* events to Blackjack, and
// the spades* events to Spades -- no game ever emits another's.

import type { Card, Suit } from './cards'
import type { PassDirection } from './heartsRules'
import type { SpadesBid } from './spadesRules'

export type PlayerId = string
export type GameMode = 'classic' | 'chaos'
/** Which game this table is playing. Chaos is a Prediction Game mode only. */
export type GameType = 'prediction' | 'hearts' | 'golf' | 'blackjack' | 'spades'
/** Blackjack only: a shared dealer hand, or players ranked against each other with no dealer. */
export type BlackjackMode = 'dealer' | 'players'
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
  /** Hearts only: the score that ends the game. Ignored by the other games. */
  targetScore: number
  /** Golf only: how many holes the game runs. Ignored by the other games. */
  holeCount: number
  /** Blackjack only: vs a shared dealer, or ranked against each other. */
  blackjackMode: BlackjackMode
  /** Blackjack only: how many rounds the game runs. Ignored by the other games. */
  blackjackRounds: number
  /** Spades only: the score that ends the game. Ignored by the other games. */
  spadesTargetScore: number
  /** Names of anyone watching a game in progress, waiting for a chair. */
  spectators: string[]
  /**
   * Host-picked rotation of games to play back to back with combined scoring.
   * Null/absent means a normal single-game table. At least 2 games, in the
   * one canonical order every game list uses (see Room.setTournamentGames).
   */
  tournamentGames?: GameType[] | null
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
  /** Roles held at this table recently, most recent (this game) first -- up to 3, chaos mode only. */
  roleHistory?: { roleName: string; roleEmoji: string }[]
}

export type GameEnded = {
  standings: Standing[]
  /**
   * Hearts is a golf score: the standings arrive sorted ASCENDING and the
   * lowest total is the winner. The Prediction Game is the other way round.
   */
  lowestWins: boolean
  /**
   * True only on the FINAL gameEnded of a tournament, carrying combined
   * rank-based points across every leg instead of one game's own score.
   * Each individual leg still fires its own gameEnded with this unset, so
   * players see that leg's real standings before moving on.
   */
  tournament?: boolean
}

export type DoubleWindow = { seconds: number }

/**
 * A spectator's read-only view of one seat's hand. `null` means "not watching
 * anyone" -- sent when the spectator stops watching, or the watched seat is no
 * longer valid (e.g. it became a real seat of theirs at the next lobby).
 */
export type WatchedHand = { seatId: PlayerId; name: string; hand: Card[] } | null

// ---- Restart vote -----------------------------------------------------------

/**
 * The table voting to abandon the game in progress and go back to the lobby --
 * how anyone waiting as a spectator gets a chair without the game having to be
 * played out. Sent to everyone (spectators included, so they can see it coming)
 * whenever a vote is cast, withdrawn, or invalidated by someone dropping.
 */
export type RestartVote = {
  /** Who is currently voting to restart. */
  votes: PlayerId[]
  /** Votes needed to pass: a majority of the connected seats. */
  needed: number
  /** How many people are waiting for a chair, i.e. what the vote is FOR. */
  waiting: number
}

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
/**
 * A choreographed visual to play on top of an ability's text line. Kept as
 * its own event rather than folded into RoleAnnounce/AbilityResult so wiring
 * one up is purely additive -- one extra broadcast call, never a change to
 * the text-message contract those two already have consumers for.
 *
 * `trade` animates a point-to-point flight between two seats and is only
 * safe where BOTH identities are already public in the same announcement
 * (e.g. Bid Chaos names both swapped players). `impact` is a source-less
 * landing effect on the target only -- what most abilities must use, since
 * announce() deliberately never names the acting player and a visible
 * flight FROM their seat would deanonymize a secret role.
 */
export type AbilityEffect = {
  kind: 'trade' | 'impact'
  icon: string
  sourceId?: PlayerId
  targetId: PlayerId
}
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

// ---- Golf ---------------------------------------------------------------
//
// Deliberately its own set of events, like Hearts. The one thing that makes
// Golf different from every other game here: nobody sees their own face-down
// cards either -- a player only knows what's been flipped face-up, exactly
// like everyone watching them. So almost all of Golf's live state is public
// and fits in one broadcast (`golfState`); the single private moment is the
// card you just drew, before you decide what to do with it.

export type GolfRoundStart = {
  holeNumber: number
  totalHoles: number
  turnOrder: PlayerId[]
  dealerId: PlayerId
}

export type GolfDrawSource = 'stock' | 'discard'

export type GolfResolveAction =
  | { type: 'swap'; slot: number }
  /** Only legal when the held card came from the stock pile. */
  | { type: 'discardAndFlip'; slot: number }

/**
 * The live public table: every seat's grid (a face-down slot is `null` for
 * EVERYONE, including its own owner), the piles, and whose turn it is.
 */
export type GolfState = {
  grids: Record<PlayerId, (Card | null)[]>
  discardTop: Card | null
  stockCount: number
  currentTurnId: PlayerId | null
  /** The current-turn seat has drawn and is choosing swap vs. discard-and-flip. */
  awaitingResolve: boolean
  finalLap: boolean
  /** Whoever flipped their grid all face-up and triggered the last lap. */
  finalLapTriggeredBy: PlayerId | null
}

/** Sent only to the seat who just drew -- the one private moment in Golf. */
export type GolfDrawResult = { card: Card; source: GolfDrawSource }

export type GolfHoleResult = { id: PlayerId; gridScore: number; totalScore: number }
export type GolfScoreUpdate = { holeNumber: number; results: GolfHoleResult[] }

/** The Golf half of a reconnect snapshot; null while playing another game. */
export type GolfSnapshot = {
  holeNumber: number
  totalHoles: number
  grids: Record<PlayerId, (Card | null)[]>
  discardTop: Card | null
  stockCount: number
  currentTurnId: PlayerId | null
  awaitingResolve: boolean
  finalLap: boolean
  finalLapTriggeredBy: PlayerId | null
  /** A card this viewer drew and hasn't resolved yet, so a refresh keeps it. */
  pendingDraw: GolfDrawResult | null
}

// ---- Blackjack ----------------------------------------------------------
//
// Deliberately its own set of events, like Hearts and Golf. Unlike either of
// them, hands are dealt and stay face up -- the way blackjack is actually
// played -- so every seat's cards are public the moment they're dealt. The
// one hidden card in the whole game is the dealer's hole card in vs-Dealer
// mode, kept out of `dealerHand` (as a `null` slot) until the dealer plays.

export type BlackjackRoundStart = {
  roundNumber: number
  totalRounds: number
  mode: BlackjackMode
  turnOrder: PlayerId[]
}

export type BlackjackAction = 'hit' | 'stand' | 'double'

/** One seat's hand as the whole table can see it. */
export type BlackjackHandPublic = {
  cards: Card[]
  total: number
  soft: boolean
  busted: boolean
  /** A natural 21 on the first two cards. */
  blackjack: boolean
  doubled: boolean
  /** Stood, busted, doubled-and-drew, or dealt a natural -- no more actions this round. */
  done: boolean
}

export type BlackjackState = {
  hands: Record<PlayerId, BlackjackHandPublic>
  /** vs-Dealer mode only; null in vs-Players mode (no dealer at all). */
  dealerHand: (Card | null)[] | null
  dealerTotal: number | null
  dealerBusted: boolean
  currentTurnId: PlayerId | null
  mode: BlackjackMode
}

export type BlackjackHandResult = { id: PlayerId; roundScore: number; totalScore: number }
export type BlackjackScoreUpdate = { roundNumber: number; results: BlackjackHandResult[] }

/** The Blackjack half of a reconnect snapshot; null while playing another game. */
export type BlackjackSnapshot = {
  roundNumber: number
  totalRounds: number
  mode: BlackjackMode
  hands: Record<PlayerId, BlackjackHandPublic>
  dealerHand: (Card | null)[] | null
  dealerTotal: number | null
  dealerBusted: boolean
  currentTurnId: PlayerId | null
}

// ---- Spades -------------------------------------------------------------------
//
// Deliberately its own set of events, like Hearts/Golf/Blackjack -- except
// trick play itself reuses the fully generic `playCard`/`trickUpdate`/
// `trickResolved` the Prediction Game and Hearts already share (follow-suit,
// one card per turn, a resolved winner) rather than reinventing them a third
// time. Only what's genuinely Spades-specific -- bidding (with Nil), team
// scoring, bags -- gets its own events.

export type SpadesRoundStart = {
  handNumber: number
  turnOrder: PlayerId[]
  dealerId: PlayerId
  /** Fixed for the whole game, re-sent every hand only for a clean reconnect. */
  teams: Record<PlayerId, 0 | 1>
  targetScore: number
}

/**
 * Live state for the whole hand, bidding AND playing -- trick-by-trick detail
 * during play comes from the shared `trickUpdate` event instead, the same
 * split Golf's `golfState` uses between its own two sub-phases.
 */
export type SpadesState = {
  phase: 'bidding' | 'playing'
  /** Whoever's turn it is to bid; null once all 4 have (trickUpdate takes over). */
  biddingTurnId: PlayerId | null
  bids: Partial<Record<PlayerId, SpadesBid>>
  spadesBroken: boolean
  /** [team 0's bags, team 1's bags], each 0-9 -- a 10th resets to 0 and costs 100. */
  bags: [number, number]
}

export type SpadesHandPlayerLine = {
  id: PlayerId
  bid: SpadesBid
  tricksWon: number
  nilResult: 'made' | 'failed' | null
}

export type SpadesHandTeamLine = {
  team: 0 | 1
  bid: number
  tricks: number
  madeBid: boolean
  overtricks: number
  bagPenalty: number
  /** What this hand added to the team's total (handScore + bagPenalty). */
  roundScore: number
  totalScore: number
  players: SpadesHandPlayerLine[]
}

export type SpadesScoreUpdate = { handNumber: number; teams: SpadesHandTeamLine[] }

/** The Spades half of a reconnect snapshot; null while playing another game. */
export type SpadesSnapshot = {
  handNumber: number
  targetScore: number
  teams: Record<PlayerId, 0 | 1>
  phase: 'bidding' | 'playing'
  biddingTurnId: PlayerId | null
  bids: Partial<Record<PlayerId, SpadesBid>>
  spadesBroken: boolean
  bags: [number, number]
  currentTurnId: PlayerId | null
  leadSuit: string | null
  plays: PlayEntry[]
  trickNumber: number
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
  /** Everything Hearts-specific; null when the table is playing another game. */
  hearts: HeartsSnapshot | null
  /** Everything Golf-specific; null when the table is playing another game. */
  golf: GolfSnapshot | null
  /** Everything Blackjack-specific; null when the table is playing another game. */
  blackjack: BlackjackSnapshot | null
  /** Everything Spades-specific; null when the table is playing another game. */
  spades: SpadesSnapshot | null
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
  /** The restart vote as it stands, so a refresh doesn't lose sight of it. */
  restart: RestartVote
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
  abilityEffect: (data: AbilityEffect) => void
  roleSync: (data: RoleSync) => void
  illusion: (data: Illusion) => void
  rebidPrompt: (data: RebidPrompt) => void
  snapshot: (data: Snapshot) => void
  heartsRoundStart: (data: HeartsRoundStart) => void
  passPrompt: (data: PassPrompt) => void
  passResult: (data: PassResult) => void
  heartsState: (data: HeartsState) => void
  heartsScoreUpdate: (data: HeartsScoreUpdate) => void
  golfRoundStart: (data: GolfRoundStart) => void
  golfState: (data: GolfState) => void
  golfDrawResult: (data: GolfDrawResult) => void
  golfScoreUpdate: (data: GolfScoreUpdate) => void
  blackjackRoundStart: (data: BlackjackRoundStart) => void
  blackjackState: (data: BlackjackState) => void
  blackjackScoreUpdate: (data: BlackjackScoreUpdate) => void
  spadesRoundStart: (data: SpadesRoundStart) => void
  spadesState: (data: SpadesState) => void
  spadesScoreUpdate: (data: SpadesScoreUpdate) => void
  restartVote: (data: RestartVote) => void
  /** Spectator-only: the hand of whichever seat they're currently watching. */
  watchedHand: (data: WatchedHand) => void
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
  /** Host only, lobby only: how many holes a Golf game runs. */
  setHoleCount: (holes: number) => void
  /**
   * Host only, lobby only: which games to rotate through as one tournament.
   * Fewer than 2 (after de-duping/validating) clears tournament mode, back
   * to a normal single-game table on whatever setGameType last picked.
   */
  setTournamentGames: (games: GameType[]) => void
  /** Hearts: the three cards you're giving away. */
  passCards: (cards: Card[]) => void
  submitBid: (bid: number) => void
  /** Answering a Reverse Time prompt. Not a turn -- nothing waits on it. */
  submitRebid: (bid: number) => void
  declareDouble: () => void
  playCard: (card: Card) => void
  useAbility: (payload: UseAbilityPayload) => void
  /** Golf: your two starting flips. */
  golfRevealInitial: (slots: [number, number]) => void
  /** Golf: draw from the stock or take the discard pile's top card. */
  golfDraw: (source: GolfDrawSource) => void
  /** Golf: what to do with the card you just drew. */
  golfResolve: (action: GolfResolveAction) => void
  /** Host only, lobby only: switch Blackjack between vs-Dealer and vs-Players. */
  setBlackjackMode: (mode: BlackjackMode) => void
  /** Host only, lobby only: how many rounds a Blackjack game runs. */
  setBlackjackRounds: (rounds: number) => void
  /** Blackjack: hit, stand, or double on your turn. */
  blackjackAction: (action: BlackjackAction) => void
  /** Host only, lobby only: the score that ends a Spades game. */
  setSpadesTargetScore: (score: number) => void
  /** Spades: your bid for the hand -- 0-13, or 'nil'. */
  submitSpadesBid: (bid: SpadesBid) => void
  requestState: () => void
  chat: (text: string) => void
  /**
   * Vote to abandon the game in progress and reopen the lobby (typically so
   * spectators can be seated). A toggle: sending it again withdraws the vote.
   * Any seated player may call it; it passes on a majority of connected seats.
   */
  voteRestart: (vote: boolean) => void
  /**
   * Spectator-only: watch a seated player's hand read-only. `seatId: null`
   * stops watching. Any other event silently ignores this from a spectator --
   * they hold no Seat, so nothing else in the protocol reaches them anyway.
   */
  watchSeat: (seatId: string | null) => void
}
