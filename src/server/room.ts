// One table: the roster, the lobby (ready/start), the state machine, and one
// round end-to-end. All of it is instance state rather than module state,
// because a single process hosts many tables at once.

import type { Server as SocketServer } from 'socket.io'
import {
  BlackjackConfig,
  Config,
  GolfConfig,
  HeartsConfig,
  SpadesConfig,
  TOTAL_ROUNDS,
  trumpForRound,
} from '@shared/config'
import type { Card } from '@shared/cards'
import type {
  BlackjackMode,
  BlackjackSnapshot,
  ChatMessage,
  ClientToServerEvents,
  GameMode,
  GameType,
  GolfResolveAction,
  GolfSnapshot,
  HeartsSnapshot,
  RestartVote,
  ReplayRound,
  RoleAnnounce,
  RosterEntry,
  ServerToClientEvents,
  Snapshot,
  SpadesSnapshot,
  Standing,
  TrickResolved,
  UseAbilityPayload,
} from '@shared/protocol'
import { MAX_CHAT_LENGTH } from '@shared/protocol'
import { passDirection, passTargetIndex } from '@shared/heartsRules'
import { GRID_SIZE } from '@shared/golfRules'
import type { SpadesBid } from '@shared/spadesRules'
import { teamOfSeatPosition } from '@shared/spadesRules'
import type { Seat, Spectator } from './types'
import { sleep } from './types'
import type { EngineIO } from './engine/io'
import { dealHands } from './engine/deck'
import { RoleManager } from './engine/roles'
import { BiddingManager } from './engine/bidding'
import { TrickManager } from './engine/tricks'
import { scoreRound } from './engine/scoring'
import { dealHearts } from './engine/hearts/deck'
import { PassManager } from './engine/hearts/passing'
import { HeartsTrickManager } from './engine/hearts/play'
import { scoreHeartsRoundForSeats } from './engine/hearts/scoring'
import { dealGolfGrids } from './engine/golf/deck'
import { GolfRevealManager } from './engine/golf/reveal'
import { GolfTurnManager } from './engine/golf/turns'
import { scoreGolfHole } from './engine/golf/scoring'
import { dealBlackjackRound } from './engine/blackjack/deck'
import { BlackjackTurnManager } from './engine/blackjack/turns'
import { scoreBlackjackRound } from './engine/blackjack/scoring'
import { SpadesBiddingManager } from './engine/spades/bidding'
import { SpadesTrickManager } from './engine/spades/tricks'
import { scoreSpadesHandForSeats } from './engine/spades/scoring'
import { postGameEndedToDiscord, postGameAbandonedToDiscord } from './discord'
import { recordGameEnded, recordGameAbandoned } from './db/persistence'

type Phase = 'RoundStart' | 'Bidding' | 'Playing' | 'Passing'

/** Every game type this table can be set to -- the one place that list lives. */
const KNOWN_GAME_TYPES: GameType[] = ['prediction', 'hearts', 'golf', 'blackjack', 'spades']

/**
 * How many finished rounds the in-memory replay keeps. The Prediction Game
 * plays exactly 10 and Spades rarely more, but Hearts runs until somebody
 * crosses the target and can go on for a while -- so this is a cap, not a
 * size. Old rounds fall off the front; the ones worth looking back at are the
 * recent ones.
 */
const REPLAY_MAX_ROUNDS = 12

export class Room {
  readonly seats: Seat[] = []
  private seatById = new Map<string, Seat>()
  /**
   * People who arrived mid-game. They sit in the Socket.IO room so every
   * broadcast reaches them, but hold no chair -- runGameLoop turns them into
   * real seats once the table reopens.
   */
  private spectators: Spectator[] = []
  private spectatorById = new Map<string, Spectator>()
  /** Spectator id -> id of the seat they're currently watching read-only. */
  private watching = new Map<string, string>()
  gameState: 'Lobby' | 'InProgress' = 'Lobby'
  lastActivity = Date.now()

  private io: EngineIO
  private roles: RoleManager
  private bidding: BiddingManager
  private tricks: TrickManager

  /**
   * Which game this table is playing. Host-chosen in the lobby; the two games
   * share the table, the chat and the reconnect machinery and nothing else.
   */
  private gameType: GameType = 'prediction'
  private targetScore: number = HeartsConfig.defaultTargetScore
  private holeCount: number = GolfConfig.defaultHoleCount
  private blackjackMode: BlackjackMode = 'dealer'
  private blackjackRounds: number = BlackjackConfig.defaultRounds
  private spadesTargetScore: number = SpadesConfig.defaultTargetScore
  /**
   * Listed in the public table browser. OFF by default and only the host can
   * change it: a table opened to play with friends must never appear in a
   * public directory because nobody thought to opt out. Opt-IN is the whole
   * design of this flag.
   */
  private isPublic = false
  /** Host-picked rotation of games; null means a normal single-game table. */
  private tournamentGames: GameType[] | null = null
  private tournamentIndex = 0
  /** seatId -> accumulated rank-based points across every finished leg so far. */
  private tournamentScores = new Map<string, number>()
  private passing: PassManager
  private heartsTricks: HeartsTrickManager
  private golfReveal: GolfRevealManager
  private golfTurns: GolfTurnManager
  private golfDealerIndex = 0
  private blackjackTurns: BlackjackTurnManager
  private spadesBidding: SpadesBiddingManager
  private spadesTricks: SpadesTrickManager

  // Round state, kept so a reconnecting client can be handed a full snapshot.
  private roundNumber = 0
  private cardsDealt = 0
  private trumpSuit = ''
  private turnOrderIds: string[] = []
  private phase: Phase = 'RoundStart'
  private history: Record<number, Record<string, number>> = {}
  /** Set when the table empties mid-game so the round loop can bail out. */
  private aborted = false
  /**
   * Seats currently voting to abandon the game in progress and reopen the
   * lobby -- the way a table with people waiting as spectators gets them a
   * chair without playing ten rounds out first.
   */
  private restartVotes = new Set<string>()

  // Table talk. Kept server-side so a refresh (or a late joiner) sees the
  // recent conversation rather than an empty box.
  private chatLog: ChatMessage[] = []
  private nextChatId = 1

  /**
   * Every trick this game has resolved, for the replay viewer. In memory and
   * nowhere else: it is reset at the top of each game (and each tournament
   * leg) and dies with the process, with no connection to the SQLite store.
   * It deliberately SURVIVES the end of a game into the lobby, which is
   * exactly when a table wants to argue about the last round.
   */
  private replay: ReplayRound[] = []

  constructor(
    readonly code: string,
    private server: SocketServer<ClientToServerEvents, ServerToClientEvents>,
  ) {
    // Socket.IO's emit signature is variadic over the event map; EngineIO
    // narrows it to the one-payload shape every event in the protocol actually
    // uses, which the generic can't prove on its own.
    this.io = {
      broadcast: (event, payload) => {
        ;(this.server.to(this.code).emit as (e: string, p: unknown) => void)(event, payload)
        // Every public announcement (role abilities, moon shots, restart-vote
        // tallies) is also logged to chat so it survives after the floating
        // feed card expires -- one choke point, so no phase manager has to
        // know chat exists. Never fires for abilityResult, which is sent
        // privately and never broadcast.
        if (event === 'roleAnnounce') {
          this.pushChat({ from: null, name: '', text: (payload as RoleAnnounce).message })
        }
        // ...and every resolved trick is recorded for the replay viewer.
        // Same reasoning as the chat line above: one choke point, so none of
        // the three trick managers (Prediction, Hearts, Spades) has to know
        // the replay exists, and a fourth trick-taking game would be
        // recorded the day it broadcasts its first trickResolved.
        if (event === 'trickResolved') {
          this.recordTrick(payload as TrickResolved)
        }
      },
      send: (seat, event, payload) => {
        if (!seat.socketId) return
        ;(this.server.to(seat.socketId).emit as (e: string, p: unknown) => void)(event, payload)
        // Every hand mutation (deal, Joker swap, Illusion scramble, Rewind)
        // goes through this one choke point, so hooking it here reaches
        // spectators watching this seat without touching each call site.
        if (event === 'dealHand') this.notifyWatchers(seat)
      },
      sendSpectators: (event, payload) => {
        for (const spectator of this.spectators) {
          ;(this.server.to(spectator.socketId).emit as (e: string, p: unknown) => void)(
            event,
            payload,
          )
        }
      },
    }
    this.roles = new RoleManager(this.io)
    this.bidding = new BiddingManager(this.io, this.roles)
    this.tricks = new TrickManager(this.io, this.roles)
    // The Time Traveler's Rewind reaches back into the live trick. Injected
    // after construction because TrickManager already depends on RoleManager,
    // and this keeps that dependency one-way.
    this.roles.attachTricks(this.tricks)

    // Hearts. No RoleManager: chaos roles are a Prediction Game feature, and
    // these two managers talk to clients through the same EngineIO, so a
    // Hearts-specific role manager could be injected here later the same way.
    this.passing = new PassManager(this.io)
    this.heartsTricks = new HeartsTrickManager(this.io)

    // Golf. No RoleManager either -- chaos roles are a Prediction Game feature.
    this.golfReveal = new GolfRevealManager(this.io)
    this.golfTurns = new GolfTurnManager(this.io)

    // Blackjack. No RoleManager either.
    this.blackjackTurns = new BlackjackTurnManager(this.io)

    // Spades. No RoleManager either -- chaos roles are a Prediction Game feature.
    this.spadesBidding = new SpadesBiddingManager(this.io)
    this.spadesTricks = new SpadesTrickManager(this.io)
  }

  // ---- Which game --------------------------------------------------------

  private get isHearts(): boolean {
    return this.gameType === 'hearts'
  }

  private get isSpades(): boolean {
    return this.gameType === 'spades'
  }

  private get isGolf(): boolean {
    return this.gameType === 'golf'
  }

  private get isBlackjack(): boolean {
    return this.gameType === 'blackjack'
  }

  private limitsFor(gameType: GameType): { min: number; max: number } {
    if (gameType === 'hearts') return { min: HeartsConfig.minPlayers, max: HeartsConfig.maxPlayers }
    if (gameType === 'golf') return { min: GolfConfig.minPlayers, max: GolfConfig.maxPlayers }
    if (gameType === 'blackjack') return { min: BlackjackConfig.minPlayers, max: BlackjackConfig.maxPlayers }
    if (gameType === 'spades') return { min: SpadesConfig.minPlayers, max: SpadesConfig.maxPlayers }
    return { min: Config.minPlayers, max: Config.maxPlayers }
  }

  /**
   * Table size limits for the game currently selected -- or, in tournament
   * mode, the INTERSECTION across every game in the rotation, since the same
   * roster has to fit all of them for the whole tournament's duration.
   */
  private get limits(): { min: number; max: number } {
    const gameTypes = this.tournamentGames ?? [this.gameType]
    const all = gameTypes.map((g) => this.limitsFor(g))
    return {
      min: Math.max(...all.map((l) => l.min)),
      max: Math.min(...all.map((l) => l.max)),
    }
  }

  // ---- Roster ---------------------------------------------------------------

  get isEmpty(): boolean {
    return this.seats.every((seat) => !seat.connected)
  }

  get spectatorCount(): number {
    return this.spectators.length
  }

  /** Everything the admin status endpoint needs -- no player-level detail, just table shape. */
  summary() {
    return {
      code: this.code,
      gameType: this.gameType,
      gameName: this.gameName(),
      gameState: this.gameState,
      players: this.seats.length,
      spectators: this.spectatorCount,
      lastActivity: this.lastActivity,
    }
  }

  getSeat(id: string): Seat | undefined {
    return this.seatById.get(id)
  }

  /**
   * The host is whoever is in seat 1 -- the first player who joined and is
   * still seated (seat indices are kept contiguous in the lobby). Only the host
   * may start the game / pick the mode.
   */
  private get host(): Seat | undefined {
    return this.seats[0]
  }

  isHost(seat: Seat): boolean {
    return this.host?.id === seat.id
  }

  /**
   * Seats a player, or re-attaches an existing seat when `playerId` matches one
   * that's already here (a refresh, or a drop mid-game). Returns an error
   * string when the table can't take them.
   */
  join(
    name: string,
    playerId: string | null,
    socketId: string,
  ): { seat: Seat } | { spectator: Spectator } | { error: string } {
    this.lastActivity = Date.now()

    const existing = playerId ? this.seatById.get(playerId) : undefined
    if (existing) {
      existing.socketId = socketId
      existing.connected = true
      existing.disconnectedAt = null
      if (name.trim()) existing.name = name.trim().slice(0, 20)
      return { seat: existing }
    }

    // A spectator refreshing mid-game keeps watching rather than being handed
    // a brand new spectator id every reload.
    const watching = playerId ? this.spectatorById.get(playerId) : undefined
    if (watching) {
      watching.socketId = socketId
      if (name.trim()) watching.name = name.trim().slice(0, 20)
      return { spectator: watching }
    }

    if (this.gameState !== 'Lobby') {
      // Mid-game arrivals watch instead of bouncing off an error. They're
      // seated automatically when this game finishes.
      const spectator: Spectator = {
        id: crypto.randomUUID(),
        socketId,
        name: name.trim().slice(0, 20) || `Spectator ${this.spectators.length + 1}`,
      }
      this.spectators.push(spectator)
      this.spectatorById.set(spectator.id, spectator)
      return { spectator }
    }
    if (this.seats.length >= Config.maxPlayers) {
      return { error: `That table is full (${Config.maxPlayers} players max).` }
    }

    const seat: Seat = {
      id: crypto.randomUUID(),
      socketId,
      name: name.trim().slice(0, 20) || `Player ${this.seats.length + 1}`,
      seatIndex: this.seats.length + 1,
      ready: false,
      connected: true,
      hand: [],
      bid: null,
      hasDoubled: false,
      tricksWon: 0,
      collected: [],
      passSelection: null,
      golfGrid: [],
      golfRevealed: new Array(GRID_SIZE).fill(false),
      blackjackHand: [],
      blackjackDone: false,
      blackjackDoubled: false,
      spadesBid: null,
      spadesBags: 0,
      totalScore: 0,
      lastRoundScore: null,
      disconnectedAt: null,
    }
    this.seats.push(seat)
    this.seatById.set(seat.id, seat)
    return { seat }
  }

  /**
   * On disconnect: during a game the seat is KEPT (so turn order doesn't shift
   * mid-round) and marked disconnected so the phase managers auto-play for it.
   * In the lobby the chair is held for a grace period -- long enough to survive
   * a refresh, short enough that a leaver doesn't block the table forever.
   */
  detach(seat: Seat, socketId: string) {
    // A reconnect can land BEFORE the old socket's disconnect event: the seat
    // is already bound to the new socket by then, and tearing it down here
    // would knock the player back out of their own chair.
    if (seat.socketId !== socketId) return

    seat.socketId = null
    seat.connected = false
    seat.disconnectedAt = Date.now()
    this.lastActivity = Date.now()

    if (this.gameState === 'Lobby') {
      seat.ready = false
      this.broadcastLobby()
      setTimeout(() => {
        if (seat.connected || this.gameState !== 'Lobby') return
        this.removeSeat(seat)
        this.broadcastLobby()
      }, Config.reconnectGraceSeconds * 1000)
    } else {
      // Everyone's gone: tell the round loop to stop between phases instead of
      // auto-playing the rest of the game to an empty room.
      if (this.isEmpty) this.aborted = true
      // Unblock whichever phase was waiting on this seat. Only one game is
      // running, so the other game's managers have nothing pending.
      this.bidding.onSeatDisconnected(seat)
      this.tricks.onSeatDisconnected(seat)
      this.passing.onSeatDisconnected(seat)
      this.heartsTricks.onSeatDisconnected(seat)
      this.golfReveal.onSeatDisconnected(seat)
      this.golfTurns.onSeatDisconnected(seat)
      this.blackjackTurns.onSeatDisconnected(seat)
      this.spadesBidding.onSeatDisconnected(seat)
      this.spadesTricks.onSeatDisconnected(seat)
      // Their vote goes with them, and the bar drops with the table size.
      this.settleRestartVote()
    }
  }

  private removeSeat(seat: Seat) {
    const index = this.seats.indexOf(seat)
    if (index < 0) return
    this.seats.splice(index, 1)
    this.seatById.delete(seat.id)
    this.seats.forEach((s, i) => {
      s.seatIndex = i + 1
    })
  }

  getSpectator(id: string): Spectator | undefined {
    return this.spectatorById.get(id)
  }

  /** A watcher closed the tab. Unlike a seat there's nothing to hold open. */
  detachSpectator(spectator: Spectator, socketId: string) {
    // Same reconnect-ordering guard as detach(): a reload can bind the new
    // socket before the old one's disconnect event arrives.
    if (spectator.socketId !== socketId) return
    const index = this.spectators.indexOf(spectator)
    if (index >= 0) this.spectators.splice(index, 1)
    this.spectatorById.delete(spectator.id)
    this.watching.delete(spectator.id)
    this.lastActivity = Date.now()
    this.broadcastLobby()
    // One fewer person waiting for a chair, which is what the vote is about.
    this.broadcastRestartVote()
  }

  /**
   * A spectator picking (or dropping) a seat to watch read-only. `seatId:
   * null` stops watching. Reused whenever that seat's hand changes -- see
   * `notifyWatchers` -- so the view stays live without polling.
   */
  watchSeat(spectator: Spectator, seatId: string | null) {
    const seat = seatId ? this.seatById.get(seatId) : undefined
    if (!seat) {
      this.watching.delete(spectator.id)
      this.sendToSocket(spectator.socketId, 'watchedHand', null)
      return
    }
    this.watching.set(spectator.id, seat.id)
    this.sendToSocket(spectator.socketId, 'watchedHand', {
      seatId: seat.id,
      name: seat.name,
      hand: seat.hand,
    })
  }

  /** Pushes this seat's current hand to anyone watching it. */
  private notifyWatchers(seat: Seat) {
    for (const spectator of this.spectators) {
      if (this.watching.get(spectator.id) !== seat.id) continue
      this.sendToSocket(spectator.socketId, 'watchedHand', {
        seatId: seat.id,
        name: seat.name,
        hand: seat.hand,
      })
    }
  }

  /**
   * Turns everyone who was watching into a real seat. Called once the game
   * loop drops back to the lobby, so spectators play the next game without
   * having to rejoin. Anyone who doesn't fit stays a spectator.
   */
  private seatSpectators() {
    // The game that made "watch a seat" meaningful just ended -- whoever's
    // left spectating gets a clean slate rather than a stale hand.
    for (const spectator of this.spectators) this.sendToSocket(spectator.socketId, 'watchedHand', null)
    this.watching.clear()

    for (const spectator of [...this.spectators]) {
      if (this.seats.length >= Config.maxPlayers) break
      this.spectators.splice(this.spectators.indexOf(spectator), 1)
      this.spectatorById.delete(spectator.id)

      const seat: Seat = {
        id: spectator.id,
        socketId: spectator.socketId,
        name: spectator.name,
        seatIndex: this.seats.length + 1,
        ready: false,
        connected: true,
        hand: [],
        bid: null,
        hasDoubled: false,
        tricksWon: 0,
        collected: [],
        passSelection: null,
        golfGrid: [],
        golfRevealed: new Array(GRID_SIZE).fill(false),
        blackjackHand: [],
        blackjackDone: false,
        blackjackDoubled: false,
        spadesBid: null,
        spadesBags: 0,
        totalScore: 0,
        lastRoundScore: null,
        disconnectedAt: null,
      }
      this.seats.push(seat)
      this.seatById.set(seat.id, seat)
      // Their client is still in spectator mode; this tells it it has a chair
      // now (same id, so localStorage keeps working).
      this.io.send(seat, 'joined', {
        playerId: seat.id,
        roomCode: this.code,
        name: seat.name,
        spectating: false,
      })
      this.systemChat(`${seat.name} takes a seat.`)
    }
  }

  // ---- Lobby ----------------------------------------------------------------

  private roster(): RosterEntry[] {
    const hostId = this.host?.id
    return this.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      ready: seat.ready,
      connected: seat.connected,
      isHost: seat.id === hostId,
    }))
  }

  /** Every non-host seat must be ready (the host readies by pressing Start). */
  private allGuestsReady(): boolean {
    return this.seats.slice(1).every((seat) => seat.ready)
  }

  private canStart(): boolean {
    const count = this.seats.length
    const { min, max } = this.limits
    if (count < min || count > max) return false
    return this.allGuestsReady()
  }

  /**
   * NEVER fires while a game is running. `lobbyUpdate` goes to the whole room
   * and the client treats it as "we're in the lobby now" -- it resets the view
   * and drops the round's history, order and role. So sending one mid-game
   * yanks EVERY player out of the game and into the lobby screen.
   *
   * That's not hypothetical: both a mid-game join (a spectator arriving) and a
   * mid-game rejoin (someone's wifi dropping and coming back) call this, and
   * either one used to kick the whole table out. Mid-game roster changes reach
   * clients through the snapshot / gameState path instead.
   *
   * runGameLoop sets gameState back to 'Lobby' BEFORE its own call here, so
   * the legitimate return-to-lobby at the end of a game still goes out.
   */
  broadcastLobby() {
    if (this.gameState !== 'Lobby') return
    this.io.broadcast('lobbyUpdate', {
      roomCode: this.code,
      roster: this.roster(),
      minPlayers: this.limits.min,
      maxPlayers: this.limits.max,
      hostId: this.host?.id ?? null,
      canStart: this.canStart(),
      mode: this.roles.getMode(),
      gameType: this.gameType,
      targetScore: this.targetScore,
      holeCount: this.holeCount,
      blackjackMode: this.blackjackMode,
      blackjackRounds: this.blackjackRounds,
      spadesTargetScore: this.spadesTargetScore,
      spectators: this.spectators.map((s) => s.name),
      isPublic: this.isPublic,
      tournamentGames: this.tournamentGames,
    })
  }

  setReady(seat: Seat, ready: boolean) {
    if (this.gameState !== 'Lobby') return
    seat.ready = ready
    this.broadcastLobby()
  }

  setMode(seat: Seat, mode: GameMode) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the game mode.')
      return
    }
    if (mode !== 'classic' && mode !== 'chaos') return
    this.roles.setMode(mode)
    this.broadcastLobby()
  }

  /**
   * The game a brand new table opens on, chosen by whoever created it. Only
   * valid before anyone has sat down -- after that it's `setGameType`, which is
   * host-only.
   */
  openOn(gameType: GameType) {
    if (this.seats.length > 0 || this.gameState !== 'Lobby') return
    if (!KNOWN_GAME_TYPES.includes(gameType)) return
    this.gameType = gameType
  }

  /** Switches the table between games. Host only, lobby only. */
  setGameType(seat: Seat, gameType: GameType) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the game.')
      return
    }
    if (!KNOWN_GAME_TYPES.includes(gameType)) return
    if (this.gameType === gameType) return
    this.gameType = gameType
    // Chaos roles are a Prediction Game feature; every other table is always plain.
    if (gameType !== 'prediction') this.roles.setMode('classic')
    const label =
      gameType === 'hearts'
        ? 'Hearts ♥'
        : gameType === 'golf'
          ? 'Golf ⛳'
          : gameType === 'blackjack'
            ? 'Blackjack 🂡'
            : gameType === 'spades'
              ? 'Spades ♠️'
              : 'The Prediction Game'
    this.systemChat(`The table switches to ${label}`)
    this.broadcastLobby()
  }

  /** The score that ends a Hearts game. Host only, lobby only. */
  setTargetScore(seat: Seat, score: number) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the target score.')
      return
    }
    if (!(HeartsConfig.targetScoreOptions as readonly number[]).includes(score)) return
    this.targetScore = score
    this.broadcastLobby()
  }

  /** How many holes a Golf game runs. Host only, lobby only. */
  setHoleCount(seat: Seat, holes: number) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the hole count.')
      return
    }
    if (!(GolfConfig.holeCountOptions as readonly number[]).includes(holes)) return
    this.holeCount = holes
    this.broadcastLobby()
  }

  /** The score that ends a Spades game. Host only, lobby only. */
  setSpadesTargetScore(seat: Seat, score: number) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the target score.')
      return
    }
    if (!(SpadesConfig.targetScoreOptions as readonly number[]).includes(score)) return
    this.spadesTargetScore = score
    this.broadcastLobby()
  }

  /**
   * Host only, lobby only: which games to rotate through as one tournament.
   * Kept in the one canonical order every game list in this app uses,
   * regardless of what order the host happened to toggle them in. Fewer than
   * 2 distinct valid games clears tournament mode entirely -- a "tournament"
   * of one game is just a normal game.
   */
  setTournamentGames(seat: Seat, games: GameType[]) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can set up a tournament.')
      return
    }
    const requested = new Set(games.filter((g) => KNOWN_GAME_TYPES.includes(g)))
    const ordered = KNOWN_GAME_TYPES.filter((g) => requested.has(g))
    this.tournamentGames = ordered.length >= 2 ? ordered : null
    this.broadcastLobby()
  }

  /** List this table publicly, or take it back off. Host only, lobby only. */
  setPublic(seat: Seat, isPublic: boolean) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can list the table publicly.')
      return
    }
    if (this.isPublic === isPublic) return
    this.isPublic = isPublic
    this.systemChat(
      isPublic
        ? 'This table is now listed publicly — anyone can find and join it.'
        : 'This table is private again.',
    )
    this.broadcastLobby()
  }

  /**
   * One row in the public table browser, or null when this table shouldn't be
   * listed. Everything a stranger needs to decide whether to sit down and
   * nothing more -- no player ids, no chat, no game state. Deliberately NOT a
   * Socket.IO event: this is a cross-table read like the leaderboard, not
   * something a table sends to the people already at it.
   */
  publicListing() {
    // Four separate reasons not to appear, all of them "you couldn't join
    // this anyway": not opted in, already playing, empty (a ghost the reaper
    // hasn't swept yet), or full.
    if (!this.isPublic) return null
    if (this.gameState !== 'Lobby') return null
    const players = this.seats.length
    if (players === 0) return null
    if (players >= this.limits.max) return null

    return {
      code: this.code,
      gameType: this.gameType,
      gameName: this.gameName(),
      mode: this.roles.getMode(),
      players,
      minPlayers: this.limits.min,
      maxPlayers: this.limits.max,
      hostName: this.host?.name ?? '',
      isTournament: this.tournamentGames != null,
      lastActivity: this.lastActivity,
    }
  }

  /** Blackjack between a shared dealer and ranked-against-each-other. Host only, lobby only. */
  setBlackjackMode(seat: Seat, mode: BlackjackMode) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the blackjack mode.')
      return
    }
    if (mode !== 'dealer' && mode !== 'players') return
    this.blackjackMode = mode
    this.broadcastLobby()
  }

  /** How many rounds a Blackjack game runs. Host only, lobby only. */
  setBlackjackRounds(seat: Seat, rounds: number) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can change the round count.')
      return
    }
    if (!(BlackjackConfig.roundOptions as readonly number[]).includes(rounds)) return
    this.blackjackRounds = rounds
    this.broadcastLobby()
  }

  startGame(seat: Seat) {
    if (this.gameState !== 'Lobby') return
    if (!this.isHost(seat)) {
      this.io.send(seat, 'actionError', 'Only the host can start the game.')
      return
    }
    if (!this.canStart()) {
      this.io.send(seat, 'actionError', 'Everyone needs to ready up first.')
      return
    }
    if (this.tournamentGames) {
      this.tournamentIndex = 0
      this.tournamentScores = new Map(this.seats.map((s) => [s.id, 0]))
      this.gameType = this.tournamentGames[0]
    }
    this.gameState = 'InProgress'
    void this.runGameLoop()
  }

  // ---- Client actions -------------------------------------------------------

  submitBid(seat: Seat, bid: number) {
    this.lastActivity = Date.now()
    this.bidding.handleBidSubmission(seat, bid)
  }

  /** Answering a Time Traveler's Reverse Time. Not a turn -- nothing waits. */
  submitRebid(seat: Seat, bid: number) {
    this.lastActivity = Date.now()
    this.roles.handleRebid(seat, bid)
  }

  declareDouble(seat: Seat) {
    this.lastActivity = Date.now()
    this.bidding.handleDeclareDouble(seat)
  }

  playCard(seat: Seat, card: Card) {
    this.lastActivity = Date.now()
    if (this.isSpades) this.spadesTricks.handleCardPlay(seat, card)
    else if (this.isHearts) this.heartsTricks.handleCardPlay(seat, card)
    else this.tricks.handleCardPlay(seat, card)
  }

  /** Spades: your bid for the current hand. */
  submitSpadesBid(seat: Seat, bid: unknown) {
    this.lastActivity = Date.now()
    if (!this.isSpades) return
    this.spadesBidding.handleBidSubmission(seat, bid)
  }

  /** Hearts: the three cards this seat is giving away. */
  passCards(seat: Seat, cards: Card[]) {
    this.lastActivity = Date.now()
    if (!this.isHearts) return
    this.passing.handlePassSelection(seat, cards)
  }

  /** Golf: this seat's two starting flips. */
  golfRevealInitial(seat: Seat, slots: unknown) {
    this.lastActivity = Date.now()
    if (!this.isGolf) return
    this.golfReveal.handleReveal(seat, slots)
  }

  /** Golf: draw from the stock or take the discard pile's top card. */
  golfDraw(seat: Seat, source: unknown) {
    this.lastActivity = Date.now()
    if (!this.isGolf) return
    this.golfTurns.handleDraw(seat, source)
  }

  /** Golf: what to do with the card just drawn. */
  golfResolve(seat: Seat, action: GolfResolveAction) {
    this.lastActivity = Date.now()
    if (!this.isGolf) return
    this.golfTurns.handleResolve(seat, action)
  }

  /** Blackjack: hit, stand, or double on your turn. */
  blackjackAction(seat: Seat, action: unknown) {
    this.lastActivity = Date.now()
    if (!this.isBlackjack) return
    this.blackjackTurns.handleAction(seat, action)
  }

  useAbility(seat: Seat, payload: UseAbilityPayload) {
    this.lastActivity = Date.now()
    this.roles.handleUseAbility(seat, payload)
  }

  // ---- Restart vote ---------------------------------------------------------

  /** A majority of the seats still connected. Always at least one vote. */
  private restartVotesNeeded(): number {
    const connected = this.seats.filter((seat) => seat.connected).length
    return Math.max(1, Math.floor(connected / 2) + 1)
  }

  /**
   * Republish the tally. Public because it is also how the table hears that the
   * number of people WAITING for a chair changed -- a spectator arriving is the
   * usual reason anyone calls a restart in the first place.
   */
  broadcastRestartVote() {
    if (this.gameState !== 'InProgress') return
    this.io.broadcast('restartVote', this.restartVoteState())
  }

  private restartVoteState(): RestartVote {
    return {
      votes: [...this.restartVotes],
      needed: this.restartVotesNeeded(),
      waiting: this.spectators.length,
    }
  }

  /**
   * Any seated player can call this; it's a toggle, so pressing it again takes
   * the vote back. Passing abandons the game IMMEDIATELY -- no scores, no
   * standings -- and drops the table back to the lobby, where anyone who has
   * been watching is seated.
   */
  voteRestart(seat: Seat, vote: boolean) {
    if (this.gameState !== 'InProgress') return
    this.lastActivity = Date.now()

    const had = this.restartVotes.has(seat.id)
    if (vote) this.restartVotes.add(seat.id)
    else this.restartVotes.delete(seat.id)
    if (had === vote) return

    // Cast votes are announced so people looking at the table rather than the
    // button know a restart is building; withdrawals stay quiet.
    if (vote) {
      this.io.broadcast('roleAnnounce', {
        message: `🔄 ${seat.name} votes to restart — ${this.restartVotes.size}/${this.restartVotesNeeded()}`,
      })
    }
    this.settleRestartVote()
  }

  /**
   * Drops votes from seats that have left (they can't consent to anything), then
   * either passes the vote or republishes the tally. Also called on a mid-game
   * disconnect: fewer connected seats means a lower bar, so someone dropping can
   * be what carries a vote that was already one short.
   */
  private settleRestartVote() {
    for (const id of [...this.restartVotes]) {
      const seat = this.seatById.get(id)
      if (!seat || !seat.connected) this.restartVotes.delete(id)
    }
    if (this.gameState !== 'InProgress') return
    if (this.restartVotes.size >= this.restartVotesNeeded()) {
      this.abandonGame()
      return
    }
    this.broadcastRestartVote()
  }

  /**
   * The vote passed. `aborted` makes the round loop return without scoring or
   * announcing standings, and each phase manager's `cancel()` unblocks whatever
   * turn it is sitting on -- without that the loop would wait forever on a
   * player who is already looking at the lobby (there are no turn timers).
   */
  private abandonGame() {
    this.aborted = true
    this.restartVotes.clear()
    this.broadcastRestartVote()
    this.systemChat('The table voted to restart — back to the lobby.')
    this.bidding.cancel()
    this.tricks.cancel()
    this.passing.cancel()
    this.heartsTricks.cancel()
    this.golfReveal.cancel()
    this.golfTurns.cancel()
    this.blackjackTurns.cancel()
    this.spadesBidding.cancel()
    this.spadesTricks.cancel()

    postGameAbandonedToDiscord({
      code: this.code,
      gameName: this.gameName(),
      roundNumber: this.roundNumber,
      standings: this.currentStandings(),
    })
    recordGameAbandoned({
      roomCode: this.code,
      gameType: this.gameType,
      gameName: this.gameName(),
      roundNumber: this.roundNumber,
      standings: this.currentStandings(),
    })
  }

  // ---- Chat -----------------------------------------------------------------

  // ---- Replay ---------------------------------------------------------------

  /**
   * Appends one resolved trick, opening a new round bucket when the round
   * number moves on. Called from the `broadcast` choke point, so it sees
   * every trick from all three trick-taking games and none of the games has
   * to call it.
   *
   * `this.roundNumber` / `this.trumpSuit` are read rather than passed because
   * TrickResolved carries neither -- and every trick manager sets both on the
   * Room before its play phase starts, so they're always the right round's.
   */
  private recordTrick(trick: TrickResolved) {
    let round = this.replay[this.replay.length - 1]
    if (!round || round.roundNumber !== this.roundNumber) {
      round = { roundNumber: this.roundNumber, trumpSuit: this.trumpSuit, tricks: [] }
      this.replay.push(round)
      if (this.replay.length > REPLAY_MAX_ROUNDS) this.replay.shift()
    }
    round.tricks.push({
      trickNumber: trick.trickNumber,
      plays: trick.plays,
      winnerId: trick.winnerId,
      counted: trick.counted,
    })
  }

  /**
   * Names are snapshotted INTO the payload rather than left for the client to
   * look up in its roster: a replay outlives the round it records, and by the
   * time anyone opens it a player may have dropped and lost their chair, at
   * which point the live roster no longer knows who they were.
   */
  sendReplay(viewer: Seat | Spectator) {
    const names: Record<string, string> = {}
    for (const seat of this.seats) names[seat.id] = seat.name
    this.sendToSocket(viewer.socketId, 'replayData', { rounds: this.replay, names })
  }

  private pushChat(message: Omit<ChatMessage, 'id'>) {
    const entry: ChatMessage = { id: this.nextChatId++, ...message }
    this.chatLog.push(entry)
    // Only the tail is ever replayed, so there's no reason to keep more.
    if (this.chatLog.length > 200) this.chatLog.shift()
    this.io.broadcast('chat', entry)
  }

  chat(seat: Seat, text: string) {
    const clean = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CHAT_LENGTH)
    if (!clean) return
    this.lastActivity = Date.now()
    this.pushChat({ from: seat.id, name: seat.name, text: clean })
  }

  /** A system line ("Ada joined the table"), attributed to nobody. */
  systemChat(text: string) {
    this.pushChat({ from: null, name: '', text })
  }

  // ---- Reconnect ------------------------------------------------------------

  /**
   * Everything this client needs to redraw a game already in progress. Pass a
   * Spectator instead of a Seat for a watcher: same table, but no hand and no
   * role -- the two things a spectator must never be sent.
   */
  sendState(viewer: Seat | Spectator) {
    if (this.gameState === 'Lobby') {
      this.broadcastLobby()
      return
    }

    const seat = this.seatById.get(viewer.id) ?? null

    if (this.isHearts) {
      this.sendHeartsState(viewer, seat)
      return
    }

    if (this.isGolf) {
      this.sendGolfState(viewer, seat)
      return
    }

    if (this.isBlackjack) {
      this.sendBlackjackState(viewer, seat)
      return
    }

    if (this.isSpades) {
      this.sendSpadesState(viewer, seat)
      return
    }

    // A seated viewer always sees their OWN bid undisguised; a watcher is an
    // outsider and gets the fully disguised view.
    const bids = this.roles.isActive()
      ? seat
        ? this.roles.displayedBidsFor(seat)
        : this.roles.displayedBids()
      : Object.fromEntries(
          this.seats.filter((s) => s.bid != null).map((s) => [s.id, s.bid as number]),
        )

    const snapshot: Snapshot = {
      inGame: true,
      roster: this.roster(),
      mode: this.roles.getMode(),
      gameType: 'prediction',
      hearts: null,
      golf: null,
      blackjack: null,
      spades: null,
      roundNumber: this.roundNumber,
      cardsDealt: this.cardsDealt,
      trumpSuit: this.trumpSuit,
      turnOrder: this.turnOrderIds,
      phase: this.phase,
      bids,
      // The real total, never derived from the (possibly disguised) map above.
      bidSum: this.seats.reduce((sum, s) => sum + (s.bid ?? 0), 0),
      tricksWon: Object.fromEntries(this.seats.map((s) => [s.id, s.tricksWon])),
      totals: Object.fromEntries(this.seats.map((s) => [s.id, s.totalScore])),
      history: this.history,
      hand: seat ? seat.hand : [],
      roleState: seat ? this.roles.getRoleState(seat) : null,
      illusion: seat ? this.roles.getIllusion(seat) : [],
      rebid: seat ? this.roles.getRebidPrompt(seat) : null,
      barred: seat ? this.tricks.barredFor(seat) : null,
      chat: this.chatLog,
      restart: this.restartVoteState(),
      spectating: seat == null,
      ...this.tricks.snapshot(),
    }
    // A spectator has no Seat, so address their socket directly.
    if (seat) {
      this.io.send(seat, 'snapshot', snapshot)
    } else {
      this.sendToSocket(viewer.socketId, 'snapshot', snapshot)
    }
  }

  /**
   * The Hearts branch of sendState: the same table-level fields, then
   * everything Hearts-specific in one `hearts` block. The prediction-only
   * fields (bids, bidSum, roles) are sent empty rather than omitted, so the
   * client's snapshot handling stays one shape.
   */
  private sendHeartsState(viewer: Seat | Spectator, seat: Seat | null) {
    const hearts: HeartsSnapshot = {
      targetScore: this.targetScore,
      direction: passDirection(this.roundNumber, this.seats.length),
      passToId: seat ? (this.heartsPassTarget(seat)?.id ?? null) : null,
      passPending: seat ? this.passing.isPending(seat) : false,
      ...this.heartsTricks.state(),
    }

    const snapshot: Snapshot = {
      inGame: true,
      roster: this.roster(),
      mode: 'classic',
      gameType: 'hearts',
      hearts,
      golf: null,
      blackjack: null,
      spades: null,
      roundNumber: this.roundNumber,
      cardsDealt: this.cardsDealt,
      trumpSuit: '',
      turnOrder: this.turnOrderIds,
      phase: this.phase,
      bids: {},
      bidSum: 0,
      tricksWon: Object.fromEntries(this.seats.map((s) => [s.id, s.tricksWon])),
      totals: Object.fromEntries(this.seats.map((s) => [s.id, s.totalScore])),
      history: this.history,
      hand: seat ? seat.hand : [],
      roleState: null,
      illusion: [],
      rebid: null,
      barred: null,
      chat: this.chatLog,
      restart: this.restartVoteState(),
      spectating: seat == null,
      ...this.heartsTricks.snapshot(),
    }

    if (seat) this.io.send(seat, 'snapshot', snapshot)
    else this.sendToSocket(viewer.socketId, 'snapshot', snapshot)
  }

  /**
   * Every seat's grid as the table can see it -- a face-down slot is `null`
   * for EVERYONE, including its own owner. Built from the seats directly
   * (not golfTurns) because it has to stay right during the reveal phase too,
   * before golfTurns has anything of its own to say.
   */
  private golfGridsSnapshot(): Record<string, (Card | null)[]> {
    return Object.fromEntries(
      this.seats.map((seat) => [
        seat.id,
        seat.golfGrid.map((card, i) => (seat.golfRevealed[i] ? card : null)),
      ]),
    )
  }

  /** The Golf branch of sendState. */
  private sendGolfState(viewer: Seat | Spectator, seat: Seat | null) {
    const golf: GolfSnapshot = {
      holeNumber: this.roundNumber,
      totalHoles: this.holeCount,
      ...this.golfTurns.snapshot(),
      grids: this.golfGridsSnapshot(),
      pendingDraw: seat ? this.golfTurns.pendingDrawFor(seat) : null,
    }

    const snapshot: Snapshot = {
      inGame: true,
      roster: this.roster(),
      mode: 'classic',
      gameType: 'golf',
      hearts: null,
      golf,
      blackjack: null,
      spades: null,
      roundNumber: this.roundNumber,
      cardsDealt: 0,
      trumpSuit: '',
      turnOrder: this.turnOrderIds,
      phase: this.phase,
      bids: {},
      bidSum: 0,
      tricksWon: {},
      totals: Object.fromEntries(this.seats.map((s) => [s.id, s.totalScore])),
      history: this.history,
      currentTurnId: null,
      leadSuit: null,
      plays: [],
      trickNumber: 0,
      hand: [],
      roleState: null,
      illusion: [],
      rebid: null,
      barred: null,
      chat: this.chatLog,
      restart: this.restartVoteState(),
      spectating: seat == null,
    }

    if (seat) this.io.send(seat, 'snapshot', snapshot)
    else this.sendToSocket(viewer.socketId, 'snapshot', snapshot)
  }

  /** The Blackjack branch of sendState. */
  private sendBlackjackState(viewer: Seat | Spectator, seat: Seat | null) {
    const blackjack: BlackjackSnapshot = {
      roundNumber: this.roundNumber,
      totalRounds: this.blackjackRounds,
      ...this.blackjackTurns.snapshot(),
    }

    const snapshot: Snapshot = {
      inGame: true,
      roster: this.roster(),
      mode: 'classic',
      gameType: 'blackjack',
      hearts: null,
      golf: null,
      blackjack,
      spades: null,
      roundNumber: this.roundNumber,
      cardsDealt: 0,
      trumpSuit: '',
      turnOrder: this.turnOrderIds,
      phase: this.phase,
      bids: {},
      bidSum: 0,
      tricksWon: {},
      totals: Object.fromEntries(this.seats.map((s) => [s.id, s.totalScore])),
      history: this.history,
      currentTurnId: null,
      leadSuit: null,
      plays: [],
      trickNumber: 0,
      hand: [],
      roleState: null,
      illusion: [],
      rebid: null,
      barred: null,
      chat: this.chatLog,
      restart: this.restartVoteState(),
      spectating: seat == null,
    }

    if (seat) this.io.send(seat, 'snapshot', snapshot)
    else this.sendToSocket(viewer.socketId, 'snapshot', snapshot)
  }

  /** seatId -> team, from the seats' fixed array position (see teamOfSeatPosition). */
  private spadesTeams(): Record<string, 0 | 1> {
    return Object.fromEntries(this.seats.map((seat, i) => [seat.id, teamOfSeatPosition(i)]))
  }

  /** The Spades branch of sendState: same shape as Hearts', since both are trick-based. */
  private sendSpadesState(viewer: Seat | Spectator, seat: Seat | null) {
    const bids: Partial<Record<string, SpadesBid>> = {}
    for (const s of this.seats) if (s.spadesBid != null) bids[s.id] = s.spadesBid
    const bags: [number, number] = [
      this.seats.find((_, i) => teamOfSeatPosition(i) === 0)?.spadesBags ?? 0,
      this.seats.find((_, i) => teamOfSeatPosition(i) === 1)?.spadesBags ?? 0,
    ]

    const spades: SpadesSnapshot = {
      handNumber: this.roundNumber,
      targetScore: this.spadesTargetScore,
      teams: this.spadesTeams(),
      phase: this.phase === 'Bidding' ? 'bidding' : 'playing',
      biddingTurnId: this.phase === 'Bidding' ? this.spadesBidding.currentTurnId() : null,
      bids,
      spadesBroken: this.spadesTricks.isBroken(),
      bags,
      ...this.spadesTricks.snapshot(),
    }

    const snapshot: Snapshot = {
      inGame: true,
      roster: this.roster(),
      mode: 'classic',
      gameType: 'spades',
      hearts: null,
      golf: null,
      blackjack: null,
      spades,
      roundNumber: this.roundNumber,
      cardsDealt: this.cardsDealt,
      trumpSuit: 'Spades',
      turnOrder: this.turnOrderIds,
      phase: this.phase,
      bids: {},
      bidSum: 0,
      tricksWon: Object.fromEntries(this.seats.map((s) => [s.id, s.tricksWon])),
      totals: Object.fromEntries(this.seats.map((s) => [s.id, s.totalScore])),
      history: this.history,
      hand: seat ? seat.hand : [],
      roleState: null,
      illusion: [],
      rebid: null,
      barred: null,
      chat: this.chatLog,
      restart: this.restartVoteState(),
      spectating: seat == null,
      ...this.spadesTricks.snapshot(),
    }

    if (seat) this.io.send(seat, 'snapshot', snapshot)
    else this.sendToSocket(viewer.socketId, 'snapshot', snapshot)
  }

  /** Whoever receives this seat's three cards in the current round. */
  private heartsPassTarget(seat: Seat): Seat | undefined {
    const order = this.turnOrderIds.map((id) => this.seatById.get(id)).filter(Boolean) as Seat[]
    const index = order.findIndex((s) => s.id === seat.id)
    if (index < 0) return undefined
    const target = passTargetIndex(index, order.length, this.roundNumber)
    return target == null ? undefined : order[target]
  }

  /** Direct-to-socket emit, for viewers who hold no chair. */
  private sendToSocket<K extends keyof ServerToClientEvents>(
    socketId: string | null,
    event: K,
    payload: Parameters<ServerToClientEvents[K]>[0],
  ) {
    if (!socketId) return
    ;(this.server.to(socketId).emit as (e: string, p: unknown) => void)(event, payload)
  }

  /** Replays the recent conversation onto a spectator's client. */
  sendChatHistoryToSocket(socketId: string) {
    this.sendToSocket(socketId, 'chatHistory', this.chatLog)
  }

  /** A spectator said something. They can talk; they just can't play. */
  spectatorChat(spectator: Spectator, text: string) {
    const clean = text
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CHAT_LENGTH)
    if (!clean) return
    this.lastActivity = Date.now()
    this.pushChat({ from: spectator.id, name: `${spectator.name} 👁`, text: clean })
  }

  /** Replays the recent conversation onto a client that just connected. */
  sendChatHistory(seat: Seat) {
    this.io.send(seat, 'chatHistory', this.chatLog)
  }

  // ---- The game loop --------------------------------------------------------

  private rotateSeatsStartingAt(startIndex: number): Seat[] {
    const n = this.seats.length
    return this.seats.map((_, offset) => this.seats[(startIndex - 1 + offset) % n])
  }

  private async playRound(roundNumber: number, cardsDealt: number, dealerIndex: number) {
    // Reset round-scoped state (hand/bid/double/tricks).
    for (const seat of this.seats) {
      seat.hand = []
      seat.bid = null
      seat.hasDoubled = false
      seat.tricksWon = 0
    }
    this.tricks.reset()

    const trumpSuit = trumpForRound(roundNumber)
    const startingBidderIndex = (dealerIndex % this.seats.length) + 1
    const turnOrder = this.rotateSeatsStartingAt(startingBidderIndex)

    const { hands, remainder } = dealHands(turnOrder, cardsDealt)
    for (const seat of turnOrder) seat.hand = hands.get(seat.id) as Card[]

    this.roundNumber = roundNumber
    this.cardsDealt = cardsDealt
    this.trumpSuit = trumpSuit
    this.turnOrderIds = turnOrder.map((s) => s.id)
    this.phase = 'RoundStart'

    this.io.broadcast('gameState', {
      phase: 'RoundStart',
      roundNumber,
      cardsDealt,
      trumpSuit,
      dealerId: this.seats[dealerIndex - 1].id,
      turnOrder: this.turnOrderIds,
    })

    for (const seat of turnOrder) {
      this.io.send(seat, 'dealHand', { hand: seat.hand, roundNumber, trumpSuit })
    }

    // Chaos mode: roll this round's ability for every role (no-op in classic).
    this.roles.startRound(this.seats, cardsDealt, remainder)

    this.phase = 'Bidding'
    await this.bidding.runBiddingPhase(turnOrder, cardsDealt)
    if (this.aborted) return
    this.bidding.lockDoubles()
    this.roles.setPhase('Playing')

    this.phase = 'Playing'
    this.io.broadcast('gameState', { phase: 'Playing', roundNumber })
    await this.tricks.runPlayPhase(this.seats, turnOrder[0], cardsDealt, trumpSuit)
    if (this.aborted) return
    const results = scoreRound(this.io, this.roles, this.seats, roundNumber)
    this.history[roundNumber] = Object.fromEntries(results.map((r) => [r.id, r.roundScore]))
    this.roles.endRound()

    this.io.broadcast('roundEnded', { roundNumber })
    await sleep(Config.roundEndPause)
  }

  /**
   * One Hearts round: deal the whole deck, pass three cards (unless this is a
   * no-pass round), play every trick out, then score the penalties.
   */
  private async playHeartsRound(roundNumber: number) {
    for (const seat of this.seats) {
      seat.hand = []
      seat.tricksWon = 0
      seat.collected = []
      seat.passSelection = null
    }
    this.passing.reset()
    this.heartsTricks.reset()

    const order = [...this.seats]
    const { hands, cardsEach, opening } = dealHearts(order)
    for (const seat of order) seat.hand = hands.get(seat.id) as Card[]

    this.roundNumber = roundNumber
    this.cardsDealt = cardsEach
    this.trumpSuit = ''
    this.turnOrderIds = order.map((s) => s.id)
    this.phase = 'Passing'

    const direction = this.passing.directionFor(roundNumber, order.length)
    this.io.broadcast('heartsRoundStart', {
      roundNumber,
      cardsEach,
      direction,
      passToId: null, // per-seat; the passPrompt below carries the real target
      targetScore: this.targetScore,
      turnOrder: this.turnOrderIds,
    })
    for (const seat of order) {
      this.io.send(seat, 'dealHand', { hand: seat.hand, roundNumber })
    }

    await this.passing.runPassPhase(order, roundNumber)
    if (this.aborted) return
    if (direction !== 'none') await sleep(HeartsConfig.passPause)

    this.phase = 'Playing'
    this.io.broadcast('gameState', { phase: 'Playing', roundNumber })
    await this.heartsTricks.runPlayPhase(order, cardsEach, opening)
    if (this.aborted) return

    const results = scoreHeartsRoundForSeats(this.io, this.seats, roundNumber)
    this.history[roundNumber] = Object.fromEntries(results.map((r) => [r.id, r.roundScore]))

    this.io.broadcast('roundEnded', { roundNumber })
    await sleep(HeartsConfig.roundEndPause)
  }

  private async runHeartsGame() {
    // Unlike the Prediction Game's fixed ten rounds, this runs until somebody
    // crosses the target -- and the round they cross in is always finished.
    for (let roundNumber = 1; roundNumber <= HeartsConfig.maxRounds; roundNumber++) {
      if (this.isEmpty) {
        this.aborted = true
        return
      }
      await this.playHeartsRound(roundNumber)
      if (this.aborted) return
      if (this.seats.some((seat) => seat.totalScore >= this.targetScore)) return
    }
  }

  /**
   * One Spades hand: deal, bid, play 13 tricks, score. Team assignment comes
   * from `this.seats`' array position (teamOfSeatPosition) and is stable for
   * the whole game -- exactly 4 seats, enforced by canStart() against
   * SpadesConfig's 4-4 limits before the game could ever start.
   */
  private async playSpadesHand(handNumber: number, dealerIndex: number) {
    for (const seat of this.seats) {
      seat.hand = []
      seat.tricksWon = 0
      seat.spadesBid = null
    }
    this.spadesBidding.reset()
    this.spadesTricks.reset()

    const order = [...this.seats]
    const { hands } = dealHands(order, 13)
    for (const seat of order) seat.hand = hands.get(seat.id) as Card[]

    this.roundNumber = handNumber
    this.cardsDealt = 13
    this.trumpSuit = 'Spades'
    this.turnOrderIds = order.map((s) => s.id)
    this.phase = 'Bidding'

    this.io.broadcast('spadesRoundStart', {
      handNumber,
      turnOrder: this.turnOrderIds,
      dealerId: order[dealerIndex].id,
      teams: this.spadesTeams(),
      targetScore: this.spadesTargetScore,
    })
    for (const seat of order) {
      this.io.send(seat, 'dealHand', { hand: seat.hand, roundNumber: handNumber })
    }

    // Both partners always carry the same bag count, so either one's value
    // is the team's -- this is what bidders see going into the hand.
    const bagsIn: [number, number] = [
      order.find((_, i) => teamOfSeatPosition(i) === 0)?.spadesBags ?? 0,
      order.find((_, i) => teamOfSeatPosition(i) === 1)?.spadesBags ?? 0,
    ]

    await this.spadesBidding.runBiddingPhase(order, bagsIn)
    if (this.aborted) return

    this.phase = 'Playing'
    this.io.broadcast('gameState', { phase: 'Playing', roundNumber: handNumber })

    const leader = order[(dealerIndex + 1) % order.length]
    const bids: Partial<Record<string, SpadesBid>> = {}
    for (const seat of order) if (seat.spadesBid != null) bids[seat.id] = seat.spadesBid

    await this.spadesTricks.runPlayPhase(order, leader, bids, bagsIn)
    if (this.aborted) return

    scoreSpadesHandForSeats(this.io, order, handNumber)
    this.history[handNumber] = Object.fromEntries(
      order.map((seat) => [seat.id, seat.lastRoundScore ?? 0]),
    )

    this.io.broadcast('roundEnded', { roundNumber: handNumber })
    await sleep(SpadesConfig.handEndPause)
  }

  private async runSpadesGame() {
    // Same "until somebody crosses the target" shape as Hearts. Both
    // partners always carry the same totalScore, so checking any one seat is
    // the same as checking its team.
    let dealerIndex = 0
    for (let handNumber = 1; handNumber <= SpadesConfig.maxRounds; handNumber++) {
      if (this.isEmpty) {
        this.aborted = true
        return
      }
      dealerIndex = (dealerIndex + 1) % this.seats.length
      await this.playSpadesHand(handNumber, dealerIndex)
      if (this.aborted) return
      if (this.seats.some((seat) => seat.totalScore >= this.spadesTargetScore)) return
    }
  }

  /** Sorted the way each game reads a leaderboard -- Hearts and Golf ascending, the Prediction Game descending. */
  private currentStandings(): Standing[] {
    const lowestWins = this.isHearts || this.isGolf
    return this.seats
      .map((seat) => {
        const reveal = this.roles.getRoleReveal(seat.id)
        const roleHistory = this.roles.getRoleHistoryReveal(seat.id)
        return {
          id: seat.id,
          name: seat.name,
          totalScore: seat.totalScore,
          roleName: reveal?.roleName,
          roleEmoji: reveal?.roleEmoji,
          roleHistory: roleHistory.length > 0 ? roleHistory : undefined,
        }
      })
      .sort((a, b) => (lowestWins ? a.totalScore - b.totalScore : b.totalScore - a.totalScore))
  }

  private gameName(): string {
    if (this.isHearts) return 'Hearts'
    if (this.isGolf) return 'Golf'
    if (this.isBlackjack) return 'Blackjack'
    if (this.isSpades) return 'Spades'
    return this.roles.getMode() === 'chaos' ? 'The Prediction Game (Chaos)' : 'The Prediction Game'
  }

  private broadcastGameEnded() {
    const lowestWins = this.isHearts || this.isGolf
    const standings = this.currentStandings()

    this.io.broadcast('gameEnded', { standings, lowestWins })
    postGameEndedToDiscord({ code: this.code, gameName: this.gameName(), standings })
    recordGameEnded({
      roomCode: this.code,
      gameType: this.gameType,
      gameName: this.gameName(),
      standings,
    })
  }

  /**
   * One game end-to-end. In tournament mode this recurses into the next leg
   * instead of dropping to the lobby: `this.gameType` is advanced and the
   * function re-enters itself, so every per-game branch below stays
   * completely untouched by tournament mode -- it just runs one more time.
   * Round 1 of any game already resets each client's own history/view (see
   * `roundStart`-family reducer cases in useGame.ts), so a fresh leg starts
   * clean without this function having to reach into per-game state itself.
   */
  private async runGameLoop() {
    this.aborted = false
    this.restartVotes.clear()
    this.history = {}
    // A fresh game (or tournament leg) gets a fresh replay. Reset HERE and
    // not at the end of the loop on purpose: the replay has to survive into
    // the lobby, which is exactly when a table wants to re-watch the round
    // that just decided the game.
    this.replay = []
    for (const seat of this.seats) {
      seat.totalScore = 0
      seat.lastRoundScore = null
      seat.ready = false
    }

    if (this.tournamentGames && this.tournamentGames.length > 1) {
      const leg = this.tournamentIndex + 1
      this.io.broadcast('roleAnnounce', {
        message: `🏆 Tournament — game ${leg} of ${this.tournamentGames.length}: ${this.gameName()}`,
      })
    }

    if (this.isSpades) {
      await this.runSpadesGame()
    } else if (this.isHearts) {
      await this.runHeartsGame()
    } else if (this.isGolf) {
      await this.runGolfGame()
    } else if (this.isBlackjack) {
      await this.runBlackjackGame()
    } else {
      await this.runPredictionGame()
    }

    if (this.tournamentGames && !this.aborted) {
      this.applyTournamentPoints()
      // Every leg gets its own real standings shown, including the last one
      // -- a tournament's final leg deserves to be seen on its own terms,
      // not silently folded straight into the combined score.
      this.broadcastGameEnded()
      await sleep(Config.gameEndPause)

      const hasNextLeg = this.tournamentIndex < this.tournamentGames.length - 1
      if (hasNextLeg) {
        // Advance and play the next leg without ever dropping to the lobby
        // in between.
        this.tournamentIndex++
        this.gameType = this.tournamentGames[this.tournamentIndex]
        await this.runGameLoop()
        return
      }

      this.broadcastTournamentEnded()
      await sleep(Config.gameEndPause)
    } else if (!this.aborted) {
      this.broadcastGameEnded()
      await sleep(Config.gameEndPause)
    }

    this.roles.resetGame()
    this.tricks.reset()
    this.passing.reset()
    this.heartsTricks.reset()
    this.golfReveal.reset()
    this.golfTurns.reset()
    this.blackjackTurns.reset()
    this.spadesBidding.reset()
    this.spadesTricks.reset()
    this.gameState = 'Lobby'
    this.roundNumber = 0
    this.history = {}
    this.tournamentGames = null
    this.tournamentScores.clear()
    this.tournamentIndex = 0

    // Anyone who dropped during the game gives up their chair now.
    for (const seat of [...this.seats]) {
      if (!seat.connected) this.removeSeat(seat)
    }
    // ...and anyone who spent the game watching takes one of the free chairs.
    this.seatSpectators()
    this.broadcastLobby()
  }

  /**
   * Folds one finished leg's standings into the running tournament total as
   * rank-based points (like a points classification), NOT raw scores --
   * different games' scores live on wildly different scales (a Blackjack
   * round swings by ±1-2, a Prediction Game round by dozens), so summing raw
   * totals across games would let whichever game has the biggest numbers
   * decide the whole tournament. In an n-player leg, 1st gets n points, last
   * gets 1; a tie splits its ranks' points evenly, the same "ties split it"
   * convention Blackjack's vs-Players mode already uses.
   */
  private applyTournamentPoints() {
    const standings = this.currentStandings()
    const n = standings.length
    let i = 0
    while (i < n) {
      let j = i
      while (j + 1 < n && standings[j + 1].totalScore === standings[i].totalScore) j++
      const tiedRanks = Array.from({ length: j - i + 1 }, (_, k) => n - (i + k))
      const points = tiedRanks.reduce((a, b) => a + b, 0) / tiedRanks.length
      for (let k = i; k <= j; k++) {
        const seatId = standings[k].id
        this.tournamentScores.set(seatId, (this.tournamentScores.get(seatId) ?? 0) + points)
      }
      i = j + 1
    }
  }

  private broadcastTournamentEnded() {
    const standings: Standing[] = this.seats
      .map((seat) => ({ id: seat.id, name: seat.name, totalScore: this.tournamentScores.get(seat.id) ?? 0 }))
      .sort((a, b) => b.totalScore - a.totalScore)

    this.io.broadcast('gameEnded', { standings, lowestWins: false, tournament: true })
    postGameEndedToDiscord({ code: this.code, gameName: 'Tournament', standings })
    recordGameEnded({ roomCode: this.code, gameType: 'tournament', gameName: 'Tournament', standings })
  }

  /** Ten rounds of 5-4-3-2-1-1-2-3-4-5, with chaos roles if the host picked them. */
  private async runPredictionGame() {
    if (this.roles.getMode() === 'chaos') this.roles.assignRoles(this.seats)

    let dealerIndex = 0
    for (let roundNumber = 1; roundNumber <= TOTAL_ROUNDS; roundNumber++) {
      // Everyone closed the tab mid-game: stop rather than play out ten rounds
      // of auto-play into the void.
      if (this.isEmpty) {
        this.aborted = true
        break
      }
      dealerIndex = (dealerIndex % this.seats.length) + 1
      await this.playRound(roundNumber, Config.cardSequence[roundNumber - 1], dealerIndex)
      if (this.aborted) break
    }
  }

  /**
   * One Golf hole: deal a 6-card grid to everyone, let everyone flip their
   * starting two at once, then play turns (draw, decide) until someone's
   * whole grid is face-up and the resulting last lap completes.
   */
  private async playGolfHole(holeNumber: number) {
    for (const seat of this.seats) {
      seat.golfGrid = []
      seat.golfRevealed = new Array(GRID_SIZE).fill(false)
    }
    this.golfReveal.reset()
    this.golfTurns.reset()

    const order = [...this.seats]
    const { grids, stock, discardTop } = dealGolfGrids(order)
    for (const seat of order) seat.golfGrid = grids.get(seat.id) as Card[]

    this.roundNumber = holeNumber
    this.cardsDealt = GRID_SIZE
    this.trumpSuit = ''
    this.turnOrderIds = order.map((s) => s.id)
    this.phase = 'RoundStart'

    const dealerId = order[this.golfDealerIndex % order.length].id

    this.io.broadcast('golfRoundStart', {
      holeNumber,
      totalHoles: this.holeCount,
      turnOrder: this.turnOrderIds,
      dealerId,
    })
    this.broadcastGolfGrids()

    this.phase = 'Passing'
    await this.golfReveal.runRevealPhase(order)
    if (this.aborted) return
    this.broadcastGolfGrids()
    await sleep(GolfConfig.revealPause)

    this.phase = 'Playing'
    this.io.broadcast('gameState', { phase: 'Playing', roundNumber: holeNumber })

    // First to act is the seat after the dealer.
    const dealerPos = order.findIndex((s) => s.id === dealerId)
    const turnOrder = order.map((_, i) => order[(dealerPos + 1 + i) % order.length])
    await this.golfTurns.runTurnPhase(turnOrder, stock, discardTop)
    if (this.aborted) return

    const results = scoreGolfHole(this.io, this.seats, holeNumber)
    this.history[holeNumber] = Object.fromEntries(results.map((r) => [r.id, r.gridScore]))

    this.io.broadcast('roundEnded', { roundNumber: holeNumber })
    await sleep(GolfConfig.holeEndPause)

    this.golfDealerIndex++
  }

  /** A golfState broadcast that only updates the grids -- used before turns start. */
  private broadcastGolfGrids() {
    this.io.broadcast('golfState', {
      grids: this.golfGridsSnapshot(),
      discardTop: null,
      stockCount: 0,
      currentTurnId: null,
      awaitingResolve: false,
      finalLap: false,
      finalLapTriggeredBy: null,
    })
  }

  /** Host-chosen hole count, lowest cumulative score when the last one ends wins. */
  private async runGolfGame() {
    this.golfDealerIndex = 0
    for (let holeNumber = 1; holeNumber <= this.holeCount; holeNumber++) {
      if (this.isEmpty) {
        this.aborted = true
        return
      }
      await this.playGolfHole(holeNumber)
      if (this.aborted) return
    }
  }

  /**
   * One Blackjack round: deal two cards to everyone (and the dealer, in
   * vs-Dealer mode), let each seat hit/stand/double in turn -- a natural
   * settles immediately, before any decision -- then, in vs-Dealer mode, the
   * dealer plays its fixed rule.
   */
  private async playBlackjackRound(roundNumber: number) {
    for (const seat of this.seats) {
      seat.blackjackHand = []
      seat.blackjackDone = false
      seat.blackjackDoubled = false
    }
    this.blackjackTurns.reset()

    const order = [...this.seats]
    const { hands, dealerHand, shoe } = dealBlackjackRound(order, this.blackjackMode)
    for (const seat of order) seat.blackjackHand = hands.get(seat.id) as Card[]

    this.roundNumber = roundNumber
    this.cardsDealt = 0
    this.trumpSuit = ''
    this.turnOrderIds = order.map((s) => s.id)
    this.phase = 'RoundStart'

    this.io.broadcast('blackjackRoundStart', {
      roundNumber,
      totalRounds: this.blackjackRounds,
      mode: this.blackjackMode,
      turnOrder: this.turnOrderIds,
    })

    this.phase = 'Playing'
    this.io.broadcast('gameState', { phase: 'Playing', roundNumber })

    await this.blackjackTurns.runTurnPhase(order, hands, dealerHand, shoe, this.blackjackMode)
    if (this.aborted) return

    // dealerHand is mutated in place by runTurnPhase's dealer auto-play, so
    // this reference already carries the dealer's final cards.
    const results = scoreBlackjackRound(
      this.io,
      this.seats,
      this.blackjackMode,
      dealerHand,
      roundNumber,
    )
    this.history[roundNumber] = Object.fromEntries(results.map((r) => [r.id, r.roundScore]))

    this.io.broadcast('roundEnded', { roundNumber })
    await sleep(BlackjackConfig.roundEndPause)
  }

  /** Host-chosen round count, most points when the last round ends wins. */
  private async runBlackjackGame() {
    for (let roundNumber = 1; roundNumber <= this.blackjackRounds; roundNumber++) {
      if (this.isEmpty) {
        this.aborted = true
        return
      }
      await this.playBlackjackRound(roundNumber)
      if (this.aborted) return
    }
  }
}
