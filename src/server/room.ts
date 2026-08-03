// One table: the roster, the lobby (ready/start), the state machine, and one
// round end-to-end. All of it is instance state rather than module state,
// because a single process hosts many tables at once.

import type { Server as SocketServer } from 'socket.io'
import { Config, TOTAL_ROUNDS, trumpForRound } from '@shared/config'
import type { Card } from '@shared/cards'
import type {
  ChatMessage,
  ClientToServerEvents,
  GameMode,
  RosterEntry,
  ServerToClientEvents,
  Snapshot,
  Standing,
  UseAbilityPayload,
} from '@shared/protocol'
import { MAX_CHAT_LENGTH } from '@shared/protocol'
import type { Seat, Spectator } from './types'
import { sleep } from './types'
import type { EngineIO } from './engine/io'
import { dealHands } from './engine/deck'
import { RoleManager } from './engine/roles'
import { BiddingManager } from './engine/bidding'
import { TrickManager } from './engine/tricks'
import { scoreRound } from './engine/scoring'

type Phase = 'RoundStart' | 'Bidding' | 'Playing'

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
  gameState: 'Lobby' | 'InProgress' = 'Lobby'
  lastActivity = Date.now()

  private io: EngineIO
  private roles: RoleManager
  private bidding: BiddingManager
  private tricks: TrickManager

  // Round state, kept so a reconnecting client can be handed a full snapshot.
  private roundNumber = 0
  private cardsDealt = 0
  private trumpSuit = ''
  private turnOrderIds: string[] = []
  private phase: Phase = 'RoundStart'
  private history: Record<number, Record<string, number>> = {}
  /** Set when the table empties mid-game so the round loop can bail out. */
  private aborted = false

  // Table talk. Kept server-side so a refresh (or a late joiner) sees the
  // recent conversation rather than an empty box.
  private chatLog: ChatMessage[] = []
  private nextChatId = 1

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
      },
      send: (seat, event, payload) => {
        if (!seat.socketId) return
        ;(this.server.to(seat.socketId).emit as (e: string, p: unknown) => void)(event, payload)
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
  }

  // ---- Roster ---------------------------------------------------------------

  get isEmpty(): boolean {
    return this.seats.every((seat) => !seat.connected)
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
      // Unblock whichever phase was waiting on this seat.
      this.bidding.onSeatDisconnected(seat)
      this.tricks.onSeatDisconnected(seat)
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
    this.lastActivity = Date.now()
    this.broadcastLobby()
  }

  /**
   * Turns everyone who was watching into a real seat. Called once the game
   * loop drops back to the lobby, so spectators play the next game without
   * having to rejoin. Anyone who doesn't fit stays a spectator.
   */
  private seatSpectators() {
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
    if (count < Config.minPlayers || count > Config.maxPlayers) return false
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
      minPlayers: Config.minPlayers,
      maxPlayers: Config.maxPlayers,
      hostId: this.host?.id ?? null,
      canStart: this.canStart(),
      mode: this.roles.getMode(),
      spectators: this.spectators.map((s) => s.name),
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
    this.tricks.handleCardPlay(seat, card)
  }

  useAbility(seat: Seat, payload: UseAbilityPayload) {
    this.lastActivity = Date.now()
    this.roles.handleUseAbility(seat, payload)
  }

  // ---- Chat -----------------------------------------------------------------

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

  private broadcastGameEnded() {
    const standings: Standing[] = this.seats
      .map((seat) => {
        const reveal = this.roles.getRoleReveal(seat.id)
        return {
          id: seat.id,
          name: seat.name,
          totalScore: seat.totalScore,
          roleName: reveal?.roleName,
          roleEmoji: reveal?.roleEmoji,
        }
      })
      .sort((a, b) => b.totalScore - a.totalScore)

    this.io.broadcast('gameEnded', { standings })
  }

  private async runGameLoop() {
    this.aborted = false
    this.history = {}
    for (const seat of this.seats) {
      seat.totalScore = 0
      seat.lastRoundScore = null
      seat.ready = false
    }

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

    if (!this.aborted) {
      this.broadcastGameEnded()
      await sleep(Config.gameEndPause)
    }

    this.roles.resetGame()
    this.tricks.reset()
    this.gameState = 'Lobby'
    this.roundNumber = 0
    this.history = {}

    // Anyone who dropped during the game gives up their chair now.
    for (const seat of [...this.seats]) {
      if (!seat.connected) this.removeSeat(seat)
    }
    // ...and anyone who spent the game watching takes one of the free chairs.
    this.seatSpectators()
    this.broadcastLobby()
  }
}
