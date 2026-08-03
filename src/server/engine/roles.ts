// Chaos mode: assigns a secret role to every player at game start, deals each
// player ONE of their role's abilities per round, and validates/executes
// ability use. Entirely dormant in classic mode -- every hook below no-ops
// when the mode is "classic", so the base game path is untouched.
//
// Conflict rules (checked in this order when an ability targets a player):
//   1. Nullify: if the target armed Nullify, both abilities are consumed and
//      the attempt is publicly announced as blocked.
//   2. Bid Lock: bid-affecting abilities (verdict / fate_swap / bid_chaos /
//      imposter) bounce off a locked bid; the attacker's ability is spent.
// Announcements name the ROLE, never the player using it -- part of the fun is
// working out who holds which role.
//
// Every per-player effect
// is keyed by player id, so DUPLICATE role holders are independent. The two
// effects keyed by TARGET must ACCUMULATE, never overwrite: armedSabotageBy is
// a LIST of saboteurs per target and armedGravekeeper is a COUNT. disguisedBids
// is deliberately last-write-wins -- a bid can only display one number.

import type { Card, Suit } from '@shared/cards'
import { cardKey, sortHand } from '@shared/cards'
import { calculateScore } from '@shared/scoring'
import * as RoleDefs from '@shared/roleDefs'
import type { GameMode, RoleState, UseAbilityPayload } from '@shared/protocol'
import type { Seat } from '../types'
import { randomInt, shuffle } from '../types'
import type { EngineIO } from './io'

// Chance per chaos game that the rare Mirrorer joins the role pool at all.
const MIRRORER_CHANCE = 0.2

// Every Joker swap is a gamble: this often it actually goes through.
const SWAP_SUCCESS = 0.75

// A BLOCKED swap doesn't end the Joker's round: they get one more go at
// someone new. Two attempts total, then the ability is spent regardless.
// (A fizzled roll is different -- that ends the turn immediately.)
const MAX_SWAP_TRIES = 2

const SWAP_ABILITIES = new Set(['hand_swap', 'card_theft', 'bid_chaos', 'fate_swap'])

// Consecutive losing All In flips before the next one is a guaranteed win.
const ALL_IN_PITY = 3

// Suits the Detective's Fortune can name. Jokers aren't nameable: they're not
// a suit anybody bids around.
const FORTUNE_SUITS: Suit[] = ['Spades', 'Diamonds', 'Clubs', 'Hearts']

// How much rarer a repeat gets each time it lands again. Weight is
// DECAY^streak against 1.0 for every other option: with four abilities a first
// repeat sits at ~12% instead of 25%, a second at ~5%.
const ABILITY_REPEAT_DECAY = 0.4

const SUIT_GLYPH: Record<string, string> = {
  Spades: '♠',
  Hearts: '♥',
  Diamonds: '♦',
  Clubs: '♣',
  Joker: '🃏',
}

const RANK_NAME: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: 'JOKER' }

function cardText(card: Card): string {
  if (card.suit === 'Joker') return 'JOKER 🃏'
  const rank = RANK_NAME[card.rank] ?? String(card.rank)
  return rank + (SUIT_GLYPH[card.suit] ?? card.suit)
}

type Phase = 'Idle' | 'Bidding' | 'Playing'

/** (ok, errorMessage, keepAbility) -- see executeAbility. */
type ExecResult = { ok: boolean; error?: string; keepAbility?: boolean }

export class RoleManager {
  private mode: GameMode = 'classic'
  private rolesActive = false

  // ---- Per-game state -------------------------------------------------------
  private roleBySeat = new Map<string, string>()
  private handSwapUsed = new Set<string>() // Joker's once-per-game gate
  // Ability roll fairness: the ability you were just dealt gets rarer each time
  // it repeats, and rolling anything else flattens the odds again.
  private lastAbilityBySeat = new Map<string, string>()
  private abilityRepeatStreak = new Map<string, number>()
  private allInLossStreak = new Map<string, number>()

  // ---- Per-round state ------------------------------------------------------
  private roundSeats: Seat[] = []
  private roundCardsDealt = 0
  private deckRemainder: Card[] = []
  private phase: Phase = 'Idle'
  private playsInCurrentTrick = 0
  private firstTrickResolved = false
  private wonFirstTrick = new Set<string>()

  private abilityBySeat = new Map<string, string>()
  private abilityUsed = new Set<string>()

  // Armed (delayed) effects, per player id.
  private armedShield = new Set<string>()
  private armedLastChance = new Set<string>()
  private armedAllIn = new Set<string>()
  private armedCrown = new Set<string>()
  private armedLock = new Set<string>()
  private armedNullify = new Set<string>()
  /** TARGET id -> every saboteur who marked them (a list, so duplicate Judges each collect). */
  private armedSabotageBy = new Map<string, string[]>()
  /** Cross-seat score deltas resolved before scoring (Sabotage's backfire hits the Judge). */
  private pendingDeltas = new Map<string, number>()
  /** TARGET id -> number of curses stacked on them (a count, so two Guardians void two tricks). */
  private armedGravekeeper = new Map<string, number>()
  private raisedStakes = new Set<string>()
  private disguisedBids = new Map<string, number>()
  private mirrorBetOn = new Map<string, string>()
  // Joker swap retries, per round: attempts burned and who they've already
  // failed against (a retry has to find a new mark).
  private swapAttempts = new Map<string, number>()
  private swapTriedTargets = new Map<string, Set<string>>()
  /** The Detective's Set the Pace: who has claimed the next trick's lead. */
  private pendingLeadId: string | null = null
  /**
   * The Detective's Illusion: player id -> card keys their client should render
   * as dead. Cosmetic only; nothing here is ever consulted when validating a
   * play, so an illusioned card is still perfectly legal.
   */
  private illusionCards = new Map<string, string[]>()

  constructor(private io: EngineIO) {}

  // ---- Mode -----------------------------------------------------------------

  setMode(mode: GameMode) {
    this.mode = mode
  }

  getMode(): GameMode {
    return this.mode
  }

  isActive(): boolean {
    return this.rolesActive
  }

  // ---- Helpers --------------------------------------------------------------

  private findSeat(id: string): Seat | null {
    return this.roundSeats.find((s) => s.id === id) ?? null
  }

  private announce(message: string) {
    this.io.broadcast('roleAnnounce', { message })
  }

  private privateResult(seat: Seat, message: string) {
    this.io.send(seat, 'abilityResult', { message })
  }

  private actionError(seat: Seat, message: string) {
    this.io.send(seat, 'actionError', message)
  }

  sendRoleState(seat: Seat, roundIntro = false) {
    const state: RoleState = {
      active: this.rolesActive,
      roleId: this.roleBySeat.get(seat.id) ?? null,
      abilityId: this.abilityBySeat.get(seat.id) ?? null,
      used: this.abilityUsed.has(seat.id),
      handSwapUsed: this.handSwapUsed.has(seat.id),
      roundIntro,
    }
    this.io.send(seat, 'roleState', state)
  }

  /** The role state a reconnecting client should be handed. */
  getRoleState(seat: Seat): RoleState | null {
    if (!this.rolesActive) return null
    return {
      active: true,
      roleId: this.roleBySeat.get(seat.id) ?? null,
      abilityId: this.abilityBySeat.get(seat.id) ?? null,
      used: this.abilityUsed.has(seat.id),
      handSwapUsed: this.handSwapUsed.has(seat.id),
      roundIntro: false,
    }
  }

  private resendHand(seat: Seat) {
    this.io.send(seat, 'dealHand', { hand: seat.hand })
  }

  /** Greys the given cards in one player's own view of their hand. */
  private castIllusion(seat: Seat, cards: string[]) {
    this.illusionCards.set(seat.id, cards)
    this.io.send(seat, 'illusion', { cards })
  }

  /** Any Illusion on this player, for the reconnect snapshot. */
  getIllusion(seat: Seat): string[] {
    return this.illusionCards.get(seat.id) ?? []
  }

  /**
   * The bid map an OUTSIDER should see: real bids with every disguise applied.
   * This is the spectator view; seated players get displayedBidsFor instead.
   */
  displayedBids(): Record<string, number> {
    const bids: Record<string, number> = {}
    for (const seat of this.roundSeats) {
      if (seat.bid != null) bids[seat.id] = this.disguisedBids.get(seat.id) ?? seat.bid
    }
    return bids
  }

  /**
   * The bid map one SEAT should see. Identical to displayedBids except your own
   * bid is always the true one -- you have to play to your real number, and a
   * Judge who disguised their own bid would otherwise be lying to themselves.
   * (A victim is told their real bid privately as well, but the UI shouldn't
   * keep contradicting it.)
   */
  displayedBidsFor(seat: Seat): Record<string, number> {
    const bids = this.displayedBids()
    if (seat.bid != null) bids[seat.id] = seat.bid
    return bids
  }

  /** Per-seat, because each player sees their own bid undisguised. */
  private syncBids() {
    for (const seat of this.roundSeats) {
      this.io.send(seat, 'roleSync', { bids: this.displayedBidsFor(seat) })
    }
    // Watchers are outsiders: they see every disguise, including its owner's.
    this.io.sendSpectators('roleSync', { bids: this.displayedBids() })
  }

  private syncTricks() {
    const tricks: Record<string, number> = {}
    for (const seat of this.roundSeats) tricks[seat.id] = seat.tricksWon
    this.io.broadcast('roleSync', { tricks })
  }

  // ---- Game / round lifecycle ----------------------------------------------

  /**
   * Called when a chaos game starts. EVERY seat gets a role. Roles are dealt
   * round-robin from a shuffled pool, so past the pool size they repeat -- with
   * 10 players over 6 roles, four roles appear twice and two appear once, and
   * which ones double up is random every game.
   */
  assignRoles(seats: Seat[]) {
    this.rolesActive = true
    this.roleBySeat.clear()
    this.handSwapUsed.clear()
    this.lastAbilityBySeat.clear()
    this.abilityRepeatStreak.clear()
    this.allInLossStreak.clear()

    // The Mirrorer stays rare: it only enters the pool some games.
    const pool = [...RoleDefs.standardRoleOrder]
    if (Math.random() < MIRRORER_CHANCE) pool.push('mirrorer')
    shuffle(pool)

    // Shuffle the seats too, so the roles that end up duplicated aren't always
    // the ones held by the earliest seats.
    const seatPicks = shuffle([...seats])
    seatPicks.forEach((seat, i) => {
      this.roleBySeat.set(seat.id, pool[i % pool.length])
    })
  }

  resetGame() {
    this.rolesActive = false
    this.roleBySeat.clear()
    this.handSwapUsed.clear()
    this.roundSeats = []
    this.abilityBySeat.clear()
    this.abilityUsed.clear()
    this.lastAbilityBySeat.clear()
    this.abilityRepeatStreak.clear()
    this.allInLossStreak.clear()
    this.phase = 'Idle'
  }

  /**
   * Picks this round's ability. All options start equally likely; the one dealt
   * last round is weighted down, and more so the longer it has been repeating.
   * Rolling anything else clears the streak and the odds go flat again.
   */
  private rollAbility(id: string, options: string[]): string {
    if (options.length === 1) {
      this.lastAbilityBySeat.set(id, options[0])
      this.abilityRepeatStreak.set(id, (this.abilityRepeatStreak.get(id) ?? 0) + 1)
      return options[0]
    }

    const lastId = this.lastAbilityBySeat.get(id)
    const streak = this.abilityRepeatStreak.get(id) ?? 0

    const weights = options.map((option) =>
      option === lastId && streak > 0 ? ABILITY_REPEAT_DECAY ** streak : 1,
    )
    const total = weights.reduce((a, b) => a + b, 0)

    let roll = Math.random() * total
    let picked = options[options.length - 1] // fallback guards float drift
    for (let i = 0; i < options.length; i++) {
      roll -= weights[i]
      if (roll <= 0) {
        picked = options[i]
        break
      }
    }

    if (picked === lastId) {
      this.abilityRepeatStreak.set(id, streak + 1)
    } else {
      this.lastAbilityBySeat.set(id, picked)
      this.abilityRepeatStreak.set(id, 1)
    }
    return picked
  }

  /**
   * Called right after the deal. Rolls this round's ability for every player
   * and privately tells each their role + ability.
   */
  startRound(seats: Seat[], cardsDealt: number, remainder: Card[]) {
    if (!this.rolesActive) return

    this.roundSeats = seats
    this.roundCardsDealt = cardsDealt
    this.deckRemainder = remainder
    this.phase = 'Bidding'
    this.playsInCurrentTrick = 0
    this.firstTrickResolved = false
    this.wonFirstTrick.clear()

    this.abilityBySeat.clear()
    this.abilityUsed.clear()
    this.armedShield.clear()
    this.armedLastChance.clear()
    this.armedAllIn.clear()
    this.armedCrown.clear()
    this.armedLock.clear()
    this.armedNullify.clear()
    this.armedSabotageBy.clear()
    this.pendingDeltas.clear()
    this.armedGravekeeper.clear()
    this.raisedStakes.clear()
    this.disguisedBids.clear()
    this.mirrorBetOn.clear()
    this.swapAttempts.clear()
    this.swapTriedTargets.clear()
    this.pendingLeadId = null
    this.illusionCards.clear()

    for (const seat of seats) {
      // Last round's Illusion dies with the deal.
      this.io.send(seat, 'illusion', { cards: [] })

      const role = RoleDefs.getRole(this.roleBySeat.get(seat.id))
      if (!role) continue

      let options = [...role.abilities]
      // Don't deal the Joker a dead ability: The Big Swap is once per game.
      if (this.handSwapUsed.has(seat.id)) {
        options = options.filter((id) => id !== 'hand_swap')
      }
      // Small tables can't satisfy two-target abilities (need 2 OTHER players),
      // so never deal them with fewer than 3 seats.
      if (seats.length < 3) {
        options = options.filter((id) => RoleDefs.getAbility(id)?.target !== 'two')
      }
      if (options.length > 0) {
        this.abilityBySeat.set(seat.id, this.rollAbility(seat.id, options))
      }
      this.sendRoleState(seat, true)
    }
  }

  setPhase(phase: Phase) {
    if (this.rolesActive) this.phase = phase
  }

  endRound() {
    if (!this.rolesActive) return
    this.phase = 'Idle'
    this.disguisedBids.clear()
  }

  // ---- TrickManager hooks ---------------------------------------------------

  noteTrickProgress(playsSoFar: number) {
    if (this.rolesActive) this.playsInCurrentTrick = playsSoFar
  }

  /**
   * Who actually leads the next trick. Normally the seat TrickManager picked
   * (the trick winner, or the round's opening leader), unless a Detective has
   * pointed the lead somewhere with Set the Pace. Consumed on use.
   *
   * The announcement deliberately doesn't say whether the Detective took the
   * lead or forced it onto someone, so the new leader isn't automatically the
   * Detective.
   */
  overrideNextLeader(defaultSeat: Seat): Seat {
    if (!this.rolesActive || this.pendingLeadId == null) return defaultSeat
    const claimant = this.findSeat(this.pendingLeadId)
    this.pendingLeadId = null
    // A player with no cards left can't lead anything.
    if (!claimant || claimant.hand.length === 0 || claimant.id === defaultSeat.id) {
      return defaultSeat
    }
    this.announce(
      `🕵️ SET THE PACE! The Detective hands the lead to ${claimant.name} — they open the next trick instead of ${defaultSeat.name}.`,
    )
    return claimant
  }

  /**
   * Called when a trick resolves, BEFORE tricksWon is incremented. Returns
   * false if the win shouldn't count (Gravekeeper curse), consuming the curse.
   */
  consumeTrickWin(winner: Seat, trickNumber: number): boolean {
    if (!this.rolesActive) return true

    this.playsInCurrentTrick = 0
    if (trickNumber === 1) this.firstTrickResolved = true

    // Curses stack (duplicate Guardians): each trick win burns exactly one.
    const curses = this.armedGravekeeper.get(winner.id) ?? 0
    if (curses > 0) {
      this.armedGravekeeper.set(winner.id, curses - 1)
      this.announce(`⚰️ The Gravekeeper's curse strikes! ${winner.name}'s trick doesn't count.`)
      return false
    }

    if (trickNumber === 1) this.wonFirstTrick.add(winner.id)
    return true
  }

  // ---- ScoringManager hooks -------------------------------------------------

  /**
   * Runs once before any seat is scored. Resolves effects whose outcome lands
   * on a DIFFERENT seat than the one that triggered them (Sabotage's backfire),
   * because adjustScore only ever sees one seat at a time.
   */
  prepareScoring() {
    if (!this.rolesActive) return
    this.pendingDeltas.clear()

    for (const [targetId, saboteurIds] of this.armedSabotageBy) {
      const target = this.findSeat(targetId)
      if (!target) continue
      if (Math.abs((target.bid ?? 0) - target.tricksWon) === 0) continue
      // The mark blew their own bid: every Judge who staked an ability on them
      // gets nothing and eats the blowback for meddling.
      for (const saboteurId of saboteurIds) {
        if (!this.findSeat(saboteurId)) continue
        this.pendingDeltas.set(saboteurId, (this.pendingDeltas.get(saboteurId) ?? 0) - 5)
        this.announce(
          `⚖️ Sabotage BACKFIRES! ${target.name} missed anyway — the Judge loses 5.`,
        )
      }
    }
  }

  /**
   * Adjusts a seat's base round score with every armed chaos effect. Announces
   * anything the table should know about.
   */
  adjustScore(seat: Seat, baseScore: number): number {
    if (!this.rolesActive) return baseScore

    const id = seat.id
    const name = seat.name
    const bid = seat.bid ?? 0
    const diff = Math.abs(bid - seat.tricksWon)
    let score = baseScore

    if (this.armedShield.has(id) && diff === 1) {
      score = calculateScore(bid, bid, seat.hasDoubled)
      this.announce(`🛡️ The Guardian's Shield saves ${name} — scored as a hit!`)
    } else if (this.armedLastChance.has(id) && diff === 1) {
      if (randomInt(0, 1) === 1) {
        score = calculateScore(bid, bid, seat.hasDoubled)
        this.announce(`🎲 Last Chance pays off! ${name} scores as if they hit their bid.`)
      } else {
        score = score * 2
        this.announce(`🎲 Last Chance backfires! ${name} takes double the penalty.`)
      }
    }

    if (this.raisedStakes.has(id) && diff === 0) {
      score += 10
      this.announce(`🎲 The Gambler raised the stakes and DELIVERED: ${name} banks +10.`)
    }

    if (this.armedCrown.has(id) && this.wonFirstTrick.has(id)) {
      score += 10
      this.announce(`👑 ${name} claimed the crown — first trick won, +10!`)
    }

    if (this.armedAllIn.has(id)) {
      // A true 50/50, with a pity floor: lose ALL_IN_PITY flips in a row and the
      // next one is guaranteed to land. Streak resets on any win.
      const lossStreak = this.allInLossStreak.get(id) ?? 0
      const won = lossStreak >= ALL_IN_PITY || randomInt(0, 1) === 1
      if (won) {
        score += 15
        this.allInLossStreak.set(id, 0)
        this.announce(
          lossStreak >= ALL_IN_PITY
            ? `🎲 ALL IN: the streak breaks — the coin finally lands for ${name}. +15!`
            : `🎲 ALL IN: the coin lands right for ${name}. +15!`,
        )
      } else {
        score -= 15
        this.allInLossStreak.set(id, lossStreak + 1)
        this.announce(`🎲 ALL IN: the coin betrays ${name}. -15.`)
      }
    }

    // Each Judge who marked them collects separately (duplicate Judges).
    const marks = this.armedSabotageBy.get(id)
    if (marks && diff === 0) {
      score -= 10 * marks.length
      this.announce(
        `⚖️ Sabotage! ${name} hit their bid but ${
          marks.length > 1 ? 'the Judges take' : 'the Judge takes'
        } ${10 * marks.length} points away.`,
      )
    }

    // Cross-seat deltas resolved in prepareScoring (Sabotage backfire).
    const pending = this.pendingDeltas.get(id)
    if (pending) score += pending

    // Mirrorer payout: ride the bet target's tricks (+3 per win, -1 per miss).
    const betTargetId = this.mirrorBetOn.get(id)
    if (betTargetId) {
      const betTarget = this.findSeat(betTargetId)
      if (betTarget) {
        const won = betTarget.tricksWon
        const delta = 3 * won - (this.roundCardsDealt - won)
        score += delta
        this.announce(
          delta >= 0
            ? `🪞 The Mirrorer bet on ${betTarget.name} — it pays out! +${delta}.`
            : `🪞 The Mirrorer bet on ${betTarget.name} — it backfires. ${delta}.`,
        )
      }
    }

    return score
  }

  /** Role info for the final standings reveal. */
  getRoleReveal(id: string): { roleName: string; roleEmoji: string } | null {
    if (!this.rolesActive) return null
    const role = RoleDefs.getRole(this.roleBySeat.get(id))
    if (!role) return null
    return { roleName: role.name, roleEmoji: role.emoji }
  }

  // ---- Ability execution ----------------------------------------------------

  private isBidAffecting(abilityId: string): boolean {
    return (
      abilityId === 'verdict' ||
      abilityId === 'fate_swap' ||
      abilityId === 'bid_chaos' ||
      abilityId === 'imposter'
    )
  }

  /**
   * True if the target's defenses stopped the ability. Consumes the attacker's
   * ability either way (the caller marks it used on any return).
   */
  private blockedByDefenses(target: Seat, abilityId: string): boolean {
    if (this.armedNullify.has(target.id)) {
      this.armedNullify.delete(target.id)
      this.announce(`🛡️ The Guardian's Nullify shattered an ability aimed at ${target.name}!`)
      return true
    }
    if (this.isBidAffecting(abilityId) && this.armedLock.has(target.id)) {
      this.announce(`🛡️ ${target.name}'s bid is LOCKED — the meddling fizzled.`)
      return true
    }
    return false
  }

  /** How many players this Joker hasn't already aimed a swap at this round. */
  private untriedTargetCount(id: string): number {
    const tried = this.swapTriedTargets.get(id)
    return this.roundSeats.filter((other) => other.id !== id && !tried?.has(other.id)).length
  }

  /**
   * Called when a Joker swap bounces off a Guardian's defenses. Being BLOCKED
   * doesn't burn the turn the way a fizzle does: the Joker gets one more go, at
   * someone they haven't aimed at yet. Returns keepAbility -- false once
   * MAX_SWAP_TRIES is reached or the table has no fresh targets left, at which
   * point the ability is finally spent. `needed` is how many fresh marks
   * another attempt would require (2 for Bid Chaos, 1 otherwise).
   */
  private retryAfterBlock(seat: Seat, targets: Seat[], needed: number): boolean {
    let tried = this.swapTriedTargets.get(seat.id)
    if (!tried) {
      tried = new Set()
      this.swapTriedTargets.set(seat.id, tried)
    }
    for (const target of targets) tried.add(target.id)

    const attempts = (this.swapAttempts.get(seat.id) ?? 0) + 1
    this.swapAttempts.set(seat.id, attempts)

    if (attempts < MAX_SWAP_TRIES && this.untriedTargetCount(seat.id) >= needed) {
      this.privateResult(
        seat,
        "BLOCKED — but a block doesn't cost you the turn. One more try, at someone you haven't aimed at yet.",
      )
      return true
    }

    this.privateResult(
      seat,
      attempts >= MAX_SWAP_TRIES
        ? 'BLOCKED again — that was your second attempt. The ability is spent.'
        : "BLOCKED, and there's nobody new left to aim at. The ability is spent.",
    )
    return false
  }

  /**
   * Every Joker swap only lands SWAP_SUCCESS of the time. A fizzle is the dice
   * simply refusing -- unlike a block, it ends the turn then and there.
   */
  private swapFizzled(seat: Seat, flavor: string): boolean {
    if (Math.random() < SWAP_SUCCESS) return false
    this.announce('🃏 ' + flavor)
    this.privateResult(
      seat,
      "It FAILED. The Joker's swaps only land 75% of the time, and this was the other 25% — your ability is spent.",
    )
    return true
  }

  /**
   * Executes one ability. On ok the ability is consumed even if a defense
   * blocked it -- a spent shot is a spent shot. keepAbility is true only when a
   * Joker swap was BLOCKED with retries left: the attempt resolved, but the
   * ability stays live so they can aim it somewhere new.
   */
  private executeAbility(seat: Seat, abilityId: string, payload: UseAbilityPayload): ExecResult {
    const id = seat.id
    const myName = seat.name

    const def = RoleDefs.getAbility(abilityId)
    if (!def) return { ok: false, error: 'Unknown ability.' }

    // Resolve targets up front for abilities that need them.
    let target: Seat | null = null
    if (def.target === 'other' || def.target === 'two' || def.target === 'any') {
      const targetId = payload.targetId
      if (!targetId) return { ok: false, error: 'Pick a target first.' }
      // Only "any" abilities may be aimed at yourself.
      if (targetId === id && def.target !== 'any') {
        return { ok: false, error: 'Pick another player as the target.' }
      }
      target = this.findSeat(targetId)
      if (!target) return { ok: false, error: "That player isn't in the round." }
    }

    let target2: Seat | null = null
    if (def.target === 'two') {
      const targetId2 = payload.targetId2
      if (!targetId2 || targetId2 === id) return { ok: false, error: 'Pick two OTHER players.' }
      if (target && targetId2 === target.id) {
        return { ok: false, error: 'Pick two different players.' }
      }
      target2 = this.findSeat(targetId2)
      if (!target2) return { ok: false, error: "That player isn't in the round." }
    }

    // A Joker retrying after a block has to find a NEW mark -- re-aiming at the
    // player who just blocked you would only bounce again. Waived once the
    // table has run out of untried players so it can't strand the ability.
    if (SWAP_ABILITIES.has(abilityId) && target) {
      const tried = this.swapTriedTargets.get(id)
      const needed = def.target === 'two' ? 2 : 1
      if (tried && this.untriedTargetCount(id) >= needed) {
        if (tried.has(target.id) || (target2 && tried.has(target2.id))) {
          return {
            ok: false,
            error: "That swap already failed on them. Pick someone you haven't tried.",
          }
        }
      }
    }

    switch (abilityId) {
      // ---- The Detective ----------------------------------------------------
      case 'read_table': {
        // One card from EVERY other hand rather than two from one: breadth over
        // depth. It aims at nobody in particular, so no defense applies. Which
        // end of the hand to read is the player's call.
        const peek = payload.peek
        if (peek !== 'high' && peek !== 'low') {
          return { ok: false, error: 'Call HIGHEST or LOWEST first.' }
        }
        const others = this.roundSeats.filter((s) => s.id !== id && s.hand.length > 0)
        if (others.length === 0) return { ok: false, error: 'Nobody has cards left to read.' }

        const high = peek === 'high'
        const lines = others.map((other) => {
          // Sort a COPY so the target's own hand order is untouched -- the
          // client renders it in the order the server sent.
          const ranked = [...other.hand].sort((a, b) => (high ? b.rank - a.rank : a.rank - b.rank))
          return `${other.name}: ${cardText(ranked[0])}`
        })
        this.privateResult(
          seat,
          `${high ? 'Highest' : 'Lowest'} card in every hand — ${lines.join('   ')}`,
        )
        return { ok: true }
      }

      case 'illusion': {
        // Two shapes of the same trick, and the Detective picks which: blanket
        // ONE player, or put a single dead-looking card in front of EVERYONE.
        // Deliberately silent, and deliberately unblockable -- a Nullify
        // announcement would out the Detective, which is the one thing this
        // ability is built never to do.
        const scope = payload.scope
        if (scope !== 'one' && scope !== 'all') {
          return { ok: false, error: 'Call it — ONE PLAYER or EVERYONE.' }
        }
        const marks = this.roundSeats.filter((s) => s.id !== id && s.hand.length > 0)
        if (marks.length === 0) return { ok: false, error: 'Nobody has cards left to fool.' }

        if (scope === 'one') {
          const targetId = payload.targetId
          if (!targetId) return { ok: false, error: 'Pick who sees the illusion.' }
          if (targetId === id) return { ok: false, error: 'Pick another player as the target.' }
          const mark = marks.find((s) => s.id === targetId)
          if (!mark) return { ok: false, error: 'They have no cards left to fool.' }
          this.castIllusion(mark, mark.hand.map(cardKey))
          this.privateResult(
            seat,
            `Illusion cast: ${mark.name}'s ENTIRE hand looks dead to them. Every card still plays perfectly.`,
          )
          return { ok: true }
        }

        for (const mark of marks) {
          const card = mark.hand[randomInt(0, mark.hand.length - 1)]
          this.castIllusion(mark, [cardKey(card)])
        }
        this.privateResult(
          seat,
          'Illusion cast: one card in every other hand looks dead. All of them still play perfectly.',
        )
        return { ok: true }
      }

      case 'fortune': {
        const suit = payload.suit
        if (!suit || !FORTUNE_SUITS.includes(suit)) {
          return { ok: false, error: 'Name a suit first.' }
        }
        // "Top 2" means the two HIGHEST undealt cards of the suit, not the two
        // that happen to sit earliest in the shuffled remainder -- knowing the
        // A and K are dead is the whole point of naming a suit.
        const matches = this.deckRemainder
          .filter((card) => card.suit === suit)
          .sort((a, b) => b.rank - a.rank)
        // An empty result is information too -- often the best information on
        // the table -- so it still spends the ability.
        if (matches.length === 0) {
          this.privateResult(
            seat,
            `No undealt ${suit} at all: every single one is in somebody's hand — the whole suit is live.`,
          )
          return { ok: true }
        }
        const peek = matches.slice(0, 2).map(cardText).join('   ')
        this.privateResult(
          seat,
          `Highest undealt ${suit}: ${peek}  (${matches.length} of the suit never got dealt — nobody holds these)`,
        )
        return { ok: true }
      }

      case 'set_pace': {
        const t = target!
        if (t.hand.length === 0) {
          return { ok: false, error: 'They have no cards left to lead with.' }
        }
        if (this.pendingLeadId != null) {
          return { ok: false, error: 'The lead is already claimed for the next trick.' }
        }
        // Aiming it at yourself is just seizing the lead -- no target to defend,
        // and no point reading a hand you already hold.
        if (t.id === id) {
          this.pendingLeadId = id
          this.privateResult(
            seat,
            "You've claimed the lead. You open the next trick — the table will see the lead jump to you, so expect questions.",
          )
          return { ok: true }
        }
        // Forcing someone else into the lead aims at them, so it can be blocked.
        if (this.blockedByDefenses(t, abilityId)) {
          this.privateResult(seat, 'Your attempt to set the pace was NULLIFIED by the Guardian.')
          return { ok: true }
        }
        this.pendingLeadId = t.id
        const hand = [...t.hand].sort((a, b) => b.rank - a.rank).map(cardText).join('   ')
        this.privateResult(
          seat,
          `${t.name} opens the next trick, whether they like it or not — and their ENTIRE hand reads: ${hand}`,
        )
        return { ok: true }
      }

      // ---- The Joker --------------------------------------------------------
      case 'hand_swap': {
        const t = target!
        if (this.handSwapUsed.has(id)) {
          return { ok: false, error: "The Big Swap is once per game — you've used it." }
        }
        if (this.roundSeats.some((other) => other.totalScore < seat.totalScore)) {
          return {
            ok: false,
            error: "The Big Swap only works while you're lowest on the scoreboard.",
          }
        }
        if (this.playsInCurrentTrick > 0) {
          return { ok: false, error: 'Wait for the current trick to finish.' }
        }
        if (t.hand.length === 0 || seat.hand.length === 0) {
          return { ok: false, error: 'No cards left to swap.' }
        }
        // The once-per-game gate is only burned when the attempt sequence is
        // actually over, so a blocked retry leaves the Big Swap available.
        if (this.blockedByDefenses(t, abilityId)) {
          const keep = this.retryAfterBlock(seat, [t], 1)
          if (!keep) this.handSwapUsed.add(id)
          return { ok: true, keepAbility: keep }
        }
        this.handSwapUsed.add(id)
        if (
          this.swapFizzled(
            seat,
            `The Joker reached for ${t.name}'s hand… and came up EMPTY. The Big Swap failed!`,
          )
        ) {
          return { ok: true }
        }
        const mine = seat.hand
        seat.hand = t.hand
        t.hand = mine
        this.resendHand(seat)
        this.resendHand(t)
        this.announce(`🃏 THE BIG SWAP! The Joker traded entire hands with ${t.name}!`)
        this.privateResult(t, 'The Joker swapped hands with you. Those cards are yours now.')
        return { ok: true }
      }

      case 'card_theft': {
        const t = target!
        if (this.playsInCurrentTrick > 0) {
          return { ok: false, error: 'Wait for the current trick to finish.' }
        }
        if (t.hand.length === 0 || seat.hand.length === 0) {
          return { ok: false, error: 'No cards left to trade.' }
        }
        if (this.blockedByDefenses(t, abilityId)) {
          return { ok: true, keepAbility: this.retryAfterBlock(seat, [t], 1) }
        }
        if (
          this.swapFizzled(
            seat,
            `The Joker's fingers slipped — the trade with ${t.name} never happened!`,
          )
        ) {
          return { ok: true }
        }
        const myIdx = randomInt(0, seat.hand.length - 1)
        const theirIdx = randomInt(0, t.hand.length - 1)
        const mine = seat.hand[myIdx]
        const theirs = t.hand[theirIdx]
        seat.hand[myIdx] = theirs
        t.hand[theirIdx] = mine
        sortHand(seat.hand)
        sortHand(t.hand)
        this.resendHand(seat)
        this.resendHand(t)
        this.announce(`🃏 Sticky Fingers! The Joker traded a random card with ${t.name}.`)
        this.privateResult(seat, `You gave away ${cardText(mine)} and got ${cardText(theirs)}.`)
        this.privateResult(
          t,
          `The Joker took your ${cardText(theirs)} and left you ${cardText(mine)}.`,
        )
        return { ok: true }
      }

      case 'bid_chaos': {
        const t = target!
        const t2 = target2!
        if (this.phase !== 'Playing') {
          return { ok: false, error: 'Bids can only be swapped once play begins.' }
        }
        if (t.bid == null || t2.bid == null) {
          return { ok: false, error: 'Both players need a bid first.' }
        }
        // Both defenses are checked (and consumed) before any retry, matching
        // the Lua: an `or` short-circuits, so this deliberately doesn't.
        const blocked1 = this.blockedByDefenses(t, abilityId)
        const blocked2 = blocked1 ? false : this.blockedByDefenses(t2, abilityId)
        if (blocked1 || blocked2) {
          return { ok: true, keepAbility: this.retryAfterBlock(seat, [t, t2], 2) }
        }
        if (
          this.swapFizzled(
            seat,
            `The Joker went for ${t.name}'s and ${t2.name}'s bids… and fumbled it. Nothing changed!`,
          )
        ) {
          return { ok: true }
        }
        const tmp = t.bid
        t.bid = t2.bid
        t2.bid = tmp
        this.syncBids()
        this.announce(
          `🃏 BID CHAOS! The Joker swapped ${t.name}'s and ${t2.name}'s bids! (${t2.bid} ↔ ${t.bid})`,
        )
        return { ok: true }
      }

      case 'fate_swap': {
        const t = target!
        if (this.phase !== 'Playing') {
          return { ok: false, error: 'Bids can only be swapped once play begins.' }
        }
        if (seat.bid == null || t.bid == null) {
          return { ok: false, error: 'Both bids need to be placed first.' }
        }
        if (this.blockedByDefenses(t, abilityId)) {
          return { ok: true, keepAbility: this.retryAfterBlock(seat, [t], 1) }
        }
        if (
          this.swapFizzled(seat, `The Joker tried to trade fates with ${t.name}… and fate said no!`)
        ) {
          return { ok: true }
        }
        const tmp = seat.bid
        seat.bid = t.bid
        t.bid = tmp
        this.syncBids()
        this.announce(
          `🃏 FATE SWAP! The Joker swapped bids with ${t.name}! (now ${seat.bid} ↔ ${t.bid})`,
        )
        return { ok: true }
      }

      // ---- The Gambler ------------------------------------------------------
      case 'raise_stakes': {
        if (this.phase !== 'Playing') {
          return { ok: false, error: 'Raise the stakes once play begins.' }
        }
        if (seat.bid == null) return { ok: false, error: 'You need a bid first.' }
        if (seat.bid >= this.roundCardsDealt) {
          return { ok: false, error: 'Your bid is already at the max for this round.' }
        }
        seat.bid += 1
        this.raisedStakes.add(id)
        this.syncBids()
        this.announce(
          `🎲 The Gambler RAISES THE STAKES: ${myName}'s bid is now ${seat.bid} (+10 bonus if they hit it).`,
        )
        return { ok: true }
      }

      case 'all_in': {
        this.armedAllIn.add(id)
        this.announce('🎲 The Gambler goes ALL IN. A coin flips at the end of the round…')
        this.privateResult(seat, "You're all in: +15 or -15 at scoring. No take-backs.")
        return { ok: true }
      }

      case 'last_chance': {
        this.armedLastChance.add(id)
        this.privateResult(
          seat,
          'Last Chance armed: if you miss your bid by exactly 1, a coin decides — full credit or double the pain.',
        )
        return { ok: true }
      }

      case 'crown': {
        if (this.firstTrickResolved) return { ok: false, error: 'The first trick is already done.' }
        this.armedCrown.add(id)
        this.announce(`👑 ${myName} declares for the crown: +10 if they win the FIRST trick!`)
        return { ok: true }
      }

      // ---- The Judge --------------------------------------------------------
      case 'verdict': {
        const t = target!
        if (this.phase !== 'Playing') {
          return { ok: false, error: 'Verdicts can only be passed once play begins.' }
        }
        if (t.bid == null) return { ok: false, error: "They haven't bid yet." }
        const direction = payload.direction === -1 ? -1 : 1
        const newBid = t.bid + direction
        if (newBid < 0 || newBid > this.roundCardsDealt) {
          return { ok: false, error: 'That would push their bid out of range.' }
        }
        if (this.blockedByDefenses(t, abilityId)) return { ok: true }
        const oldBid = t.bid
        t.bid = newBid
        this.syncBids()
        this.announce(`⚖️ VERDICT! The Judge changed ${t.name}'s bid: ${oldBid} → ${newBid}.`)
        return { ok: true }
      }

      case 'sabotage': {
        const t = target!
        if (this.blockedByDefenses(t, abilityId)) return { ok: true }
        const marks = this.armedSabotageBy.get(t.id) ?? []
        marks.push(id)
        this.armedSabotageBy.set(t.id, marks)
        this.privateResult(
          seat,
          `Sabotage armed on ${t.name}: -10 for them if they hit their bid exactly — but -5 for YOU if they miss. Pick your marks carefully.`,
        )
        return { ok: true }
      }

      case 'magnet': {
        const t = target!
        if (this.phase !== 'Playing') {
          return { ok: false, error: 'Tricks can only be stolen during play.' }
        }
        if (t.tricksWon < 1) return { ok: false, error: "They haven't won a trick yet." }
        if (this.blockedByDefenses(t, abilityId)) return { ok: true }
        t.tricksWon -= 1
        seat.tricksWon += 1
        this.syncTricks()
        this.announce(`⚖️ TRICK MAGNET! The Judge stole one of ${t.name}'s tricks!`)
        return { ok: true }
      }

      case 'imposter': {
        const t = target!
        const self = t.id === id
        // Deliberately allowed during BIDDING: a disguise planted before the
        // rest of the table has bid is the strongest version of this ability,
        // because everyone after you bids against a number that isn't real.
        if (t.bid == null) {
          return { ok: false, error: self ? "You haven't bid yet." : "They haven't bid yet." }
        }
        // Hiding your OWN bid aims at nobody, so no defense applies -- you
        // can't Nullify or Bid Lock yourself out of your own disguise.
        if (!self && this.blockedByDefenses(t, abilityId)) return { ok: true }
        // Pick a fake bid that differs from the real one. Deliberately silent:
        // no public announcement, the table just sees the wrong number.
        const realBid = t.bid
        let fake = realBid
        while (fake === realBid) fake = randomInt(0, this.roundCardsDealt)
        this.disguisedBids.set(t.id, fake)
        this.syncBids()
        if (self) {
          this.privateResult(
            seat,
            `Your bid now shows as ${fake} to the table (really ${realBid}). Bid accordingly — only scoring reveals the truth.`,
          )
          return { ok: true }
        }
        this.privateResult(
          seat,
          `${t.name}'s bid now shows as ${fake} to the table (really ${realBid}). Nobody sees through it until scoring.`,
        )
        this.privateResult(
          t,
          `⚖️ The Judge disguised your bid! The table sees ${fake}, but your REAL bid of ${realBid} is what counts.`,
        )
        return { ok: true }
      }

      // ---- The Guardian -----------------------------------------------------
      case 'shield': {
        this.armedShield.add(id)
        this.privateResult(
          seat,
          'Shield up: if you miss your bid by exactly 1 this round, you score as if you hit it.',
        )
        return { ok: true }
      }

      case 'lock': {
        // SILENT, like Shield and Nullify. Announcing the lock told the table
        // both that a Guardian was sitting there and exactly whose bid was now
        // pointless to attack -- it burned the ability before it did anything.
        // The block message in blockedByDefenses is what reveals it, and only
        // once somebody has actually wasted an ability on it.
        this.armedLock.add(id)
        this.privateResult(
          seat,
          "Bid Lock armed: your bid can't be changed, swapped or disguised for the rest of the round.",
        )
        return { ok: true }
      }

      case 'nullify': {
        this.armedNullify.add(id)
        this.privateResult(seat, 'Nullify armed: the next ability aimed at you this round fizzles.')
        return { ok: true }
      }

      case 'gravekeeper': {
        const t = target!
        if (this.blockedByDefenses(t, abilityId)) return { ok: true }
        this.armedGravekeeper.set(t.id, (this.armedGravekeeper.get(t.id) ?? 0) + 1)
        this.privateResult(
          seat,
          `Curse placed on ${t.name}: the next trick they win doesn't count. They'll find out the hard way.`,
        )
        return { ok: true }
      }

      // ---- The Mirrorer -----------------------------------------------------
      case 'mirror_bet': {
        const t = target!
        if (this.phase !== 'Bidding') {
          return { ok: false, error: 'Bets close when the first card falls — bet during bidding.' }
        }
        // A Nullify costs the Mirrorer THIS ROUND's bet and nothing more: the
        // ability itself is permanent, and startRound deals it back next
        // deal along with a fresh mirrorBetOn.
        if (this.blockedByDefenses(t, abilityId)) {
          this.privateResult(
            seat,
            'Your bet was NULLIFIED by the Guardian — no bet this round. You get another next deal.',
          )
          return { ok: true }
        }
        this.mirrorBetOn.set(id, t.id)
        this.privateResult(
          seat,
          `Bet placed on ${t.name}: +3 for every trick they win this round, -1 for every trick they don't.`,
        )
        return { ok: true }
      }

      default:
        return { ok: false, error: 'Unknown ability.' }
    }
  }

  /** Entry point for the client's `useAbility` event. */
  handleUseAbility(seat: Seat, payload: UseAbilityPayload) {
    if (!this.rolesActive) {
      this.actionError(seat, 'Abilities are only available in chaos mode.')
      return
    }
    if (this.phase !== 'Bidding' && this.phase !== 'Playing') {
      this.actionError(seat, "Abilities can't be used between rounds.")
      return
    }

    const abilityId = this.abilityBySeat.get(seat.id)
    if (!abilityId) {
      this.actionError(seat, "You don't have an ability this round.")
      return
    }
    if (this.abilityUsed.has(seat.id)) {
      this.actionError(seat, "You've already used your ability this round.")
      return
    }

    const { ok, error, keepAbility } = this.executeAbility(seat, abilityId, payload ?? {})
    if (!ok) {
      this.actionError(seat, error ?? "That doesn't work right now.")
      return
    }

    if (!keepAbility) this.abilityUsed.add(seat.id)
    this.sendRoleState(seat)
  }
}
