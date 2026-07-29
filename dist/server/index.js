// src/server/index.ts
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";

// src/shared/config.ts
var Config = {
  minPlayers: 2,
  maxPlayers: 10,
  // Cards dealt per round. 5-4-3-2-1-1-2-3-4-5 = 10 rounds total.
  cardSequence: [5, 4, 3, 2, 1, 1, 2, 3, 4, 5],
  // Trump suit cycles through this list, one per round, wrapping around.
  trumpRotation: ["Spades", "Diamonds", "Clubs", "Hearts", "NoTrump"],
  // House rule: restrict "Double" to only be declared on a bid of 0.
  doubleOnlyOnZeroBid: false,
  // After placing a bid, a player has this long to declare Double before the
  // next player bids. Once it expires the chance is gone for the round.
  doubleWindowSeconds: 5,
  // "scaled": score = -(abs(bid - tricksWon))
  // "flat": score = flatMissPenalty, regardless of how far off the bid was
  missPenaltyMode: "scaled",
  flatMissPenalty: -10,
  // Note: there are deliberately no turn timers. A player is never skipped for
  // thinking too long; the server only auto-plays for a seat that has actually
  // disconnected, so a round can't hang on an empty chair.
  // Pacing between phases.
  trickResolvePause: 1.5,
  // after a trick resolves, before the next lead
  roundEndPause: 4,
  // scoreboard reading time between rounds
  gameEndPause: 12,
  // final standings display before returning to lobby
  // Web-only: a seat that has been gone this long during the lobby loses its
  // reservation, so a refresh reconnects but a leaver frees the chair.
  reconnectGraceSeconds: 45
};
var TOTAL_ROUNDS = Config.cardSequence.length;
function trumpForRound(roundNumber) {
  return Config.trumpRotation[(roundNumber - 1) % Config.trumpRotation.length];
}

// src/shared/protocol.ts
var MAX_CHAT_LENGTH = 300;

// src/server/types.ts
var sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1e3));
function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
var randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// src/shared/cards.ts
function isSameCard(a, b) {
  return a.suit === b.suit && a.rank === b.rank;
}
var SUIT_SORT_ORDER = {
  Spades: 1,
  Diamonds: 2,
  Clubs: 3,
  Hearts: 4,
  Joker: 5
};
function sortHand(hand) {
  hand.sort((a, b) => {
    const orderA = SUIT_SORT_ORDER[a.suit] ?? 99;
    const orderB = SUIT_SORT_ORDER[b.suit] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return b.rank - a.rank;
  });
}
function resolveTrickWinnerIndex(plays, leadSuit, trumpSuit) {
  const isTrump = (card) => trumpSuit !== "NoTrump" && (card.suit === trumpSuit || card.suit === "Joker");
  const beats = (candidate, current) => {
    const candidateIsTrump = isTrump(candidate);
    const currentIsTrump = isTrump(current);
    if (candidateIsTrump && !currentIsTrump) return true;
    if (currentIsTrump && !candidateIsTrump) return false;
    if (candidateIsTrump && currentIsTrump) return candidate.rank > current.rank;
    if (candidate.suit === leadSuit && current.suit === leadSuit) {
      return candidate.rank > current.rank;
    }
    return candidate.suit === leadSuit && current.suit !== leadSuit;
  };
  let bestIndex = 0;
  let bestCard = plays[0].card;
  for (let i = 1; i < plays.length; i++) {
    if (beats(plays[i].card, bestCard)) {
      bestCard = plays[i].card;
      bestIndex = i;
    }
  }
  return bestIndex;
}
function isLegalPlay(card, hand, leadSuit) {
  if (leadSuit == null) return true;
  if (card.suit === leadSuit || card.suit === "Joker") return true;
  return !hand.some((c) => c.suit === leadSuit);
}

// src/server/engine/deck.ts
var SUITS = ["Spades", "Diamonds", "Clubs", "Hearts"];
function buildFullDeck(includeJokers) {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) cards.push({ suit, rank });
  }
  if (includeJokers) {
    cards.push({ suit: "Joker", rank: 15 }, { suit: "Joker", rank: 15 });
  }
  return cards;
}
function dealHands(order, cardsPerPlayer) {
  const cardsNeeded = order.length * cardsPerPlayer;
  const includeJokers = order.length >= 6 && cardsNeeded > 52;
  const deck = buildFullDeck(includeJokers);
  if (cardsNeeded > deck.length) {
    throw new Error("Not enough cards in the deck for this deal");
  }
  shuffle(deck);
  const hands = /* @__PURE__ */ new Map();
  for (const seat of order) hands.set(seat.id, []);
  let cursor = 0;
  for (let i = 0; i < cardsPerPlayer; i++) {
    for (const seat of order) {
      hands.get(seat.id).push(deck[cursor]);
      cursor++;
    }
  }
  for (const seat of order) sortHand(hands.get(seat.id));
  return { hands, remainder: deck.slice(cursor) };
}

// src/shared/scoring.ts
function calculateScore(bid, tricksWon, doubled) {
  const diff = Math.abs(bid - tricksWon);
  if (diff === 0) {
    const base = 10 + bid;
    return doubled ? base * 2 : base;
  }
  if (doubled) return -(10 + bid);
  if (Config.missPenaltyMode === "flat") return Config.flatMissPenalty;
  return -diff;
}
function canDouble(bid) {
  if (Config.doubleOnlyOnZeroBid) return bid === 0;
  return true;
}

// src/shared/roleDefs.ts
var abilities = {
  // ---- The Peeker ---------------------------------------------------------
  peek_high: {
    id: "peek_high",
    name: "High Peek",
    desc: "Secretly view the TOP TWO cards in another player\u2019s hand.",
    target: "other",
    note: "private \u2014 nobody is told. a Guardian\u2019s Nullify can cancel it"
  },
  peek_low: {
    id: "peek_low",
    name: "Low Peek",
    desc: "Secretly view the BOTTOM TWO cards in another player\u2019s hand.",
    target: "other",
    note: "private \u2014 nobody is told. a Guardian\u2019s Nullify can cancel it"
  },
  investigate: {
    id: "investigate",
    name: "Investigate",
    desc: "See a player\u2019s TRUE bid, trick count, and whether they doubled. Sees through any disguise.",
    target: "other",
    note: "private \u2014 nobody is told. a Guardian\u2019s Nullify can cancel it"
  },
  fortune: {
    id: "fortune",
    name: "Fortune",
    desc: "Secretly view the top 5 undealt cards of the deck \u2014 every card nobody was dealt.",
    target: "none",
    note: "private \u2014 nobody is told. targets no one, so nothing can block it"
  },
  set_pace: {
    id: "set_pace",
    name: "Set the Pace",
    desc: "Seize the lead: YOU open the next trick instead of whoever won the last one. Knowing the table is worth little if you can\u2019t choose the suit.",
    target: "none",
    note: "the lead change is public \u2014 it may give you away. targets no one, so nothing can block it"
  },
  // ---- The Joker ----------------------------------------------------------
  hand_swap: {
    id: "hand_swap",
    name: "The Big Swap",
    desc: "Swap your ENTIRE hand with another player\u2019s. Lands 60% of the time, and a failed roll spends it.",
    target: "other",
    note: "once per game \u2014 only while you\u2019re lowest on the scoreboard, never mid-trick. if a Guardian BLOCKS it you get one more try, at someone new"
  },
  card_theft: {
    id: "card_theft",
    name: "Sticky Fingers",
    desc: "Trade one random card from your hand for one random card of another player\u2019s. Lands 60% of the time, and a failed roll spends it.",
    target: "other",
    note: "never mid-trick. if a Guardian BLOCKS it you get one more try, at someone new"
  },
  bid_chaos: {
    id: "bid_chaos",
    name: "Bid Chaos",
    desc: "Swap two OTHER players\u2019 bids. Their real bids \u2014 scoring follows. Lands 60% of the time, and a failed roll spends it.",
    target: "two",
    note: "play phase only. if a Guardian\u2019s Nullify or Bid Lock BLOCKS it you get one more try, at someone new"
  },
  fate_swap: {
    id: "fate_swap",
    name: "Fate Swap",
    desc: "Swap YOUR bid with another player\u2019s bid. Lands 60% of the time, and a failed roll spends it.",
    target: "other",
    note: "play phase only. if a Guardian\u2019s Nullify or Bid Lock BLOCKS it you get one more try, at someone new"
  },
  // ---- The Gambler --------------------------------------------------------
  raise_stakes: {
    id: "raise_stakes",
    name: "Raise the Stakes",
    desc: "Raise your own bid by 1. Hit the new bid exactly for a +10 bonus.",
    target: "none",
    note: "play phase only. targets no one, so nothing can block it"
  },
  all_in: {
    id: "all_in",
    name: "All In",
    desc: "Coin flip at scoring: +15 points\u2026 or -15 points. A true 50/50 \u2014 and lose 3 flips in a row and the next one is guaranteed to land.",
    target: "none",
    note: "resolves at end of round. targets no one, so nothing can block it"
  },
  last_chance: {
    id: "last_chance",
    name: "Last Chance",
    desc: "If you miss your bid by exactly 1: coin flip \u2014 score as if you hit it, or double the penalty.",
    target: "none",
    note: "resolves at end of round. targets no one, so nothing can block it"
  },
  crown: {
    id: "crown",
    name: "Claim the Crown",
    desc: "Declare for the crown: if you win the FIRST trick this round, +10 points.",
    target: "none",
    note: "declare before the first trick ends. targets no one, so nothing can block it"
  },
  // ---- The Judge ----------------------------------------------------------
  verdict: {
    id: "verdict",
    name: "Verdict",
    desc: "Change another player\u2019s bid by +1 or -1. Their REAL bid \u2014 it counts at scoring.",
    target: "other",
    extra: "direction",
    note: "play phase only. a Guardian\u2019s Nullify or Bid Lock can cancel it"
  },
  sabotage: {
    id: "sabotage",
    name: "Sabotage",
    desc: "Mark a player: if they hit their bid exactly, they lose 10 points. But if they MISS, the sabotage backfires and YOU lose 5.",
    target: "other",
    note: "resolves at end of round \u2014 risky. a Guardian\u2019s Nullify can cancel it"
  },
  magnet: {
    id: "magnet",
    name: "Trick Magnet",
    desc: "Steal one trick another player has already won. It becomes yours.",
    target: "other",
    note: "play phase only, target must have won a trick. a Guardian\u2019s Nullify can cancel it"
  },
  imposter: {
    id: "imposter",
    name: "Imposter",
    desc: "Disguise a player\u2019s bid: the table sees a FALSE number until scoring. Silent.",
    target: "other",
    note: "play phase only. a Guardian\u2019s Nullify or Bid Lock can cancel it"
  },
  // ---- The Guardian -------------------------------------------------------
  shield: {
    id: "shield",
    name: "Shield",
    desc: "If you miss your bid by exactly 1 this round, score as if you hit it.",
    target: "none",
    note: "resolves at end of round"
  },
  lock: {
    id: "lock",
    name: "Bid Lock",
    desc: "Your bid can\u2019t be changed, swapped, or disguised for the rest of the round.",
    target: "none",
    note: "protects your bid"
  },
  nullify: {
    id: "nullify",
    name: "Nullify",
    desc: "The next ability aimed at you this round fizzles into nothing.",
    target: "none",
    note: "one-time reactive shield"
  },
  gravekeeper: {
    id: "gravekeeper",
    name: "Gravekeeper",
    desc: "Curse a player: the next trick they win this round doesn\u2019t count.",
    target: "other",
    note: "triggers on their next trick win. a Guardian\u2019s Nullify can cancel it"
  },
  // ---- The Mirrorer (rare) ------------------------------------------------
  mirror_bet: {
    id: "mirror_bet",
    name: "Mirror Bet",
    desc: "Secretly bet on another player. At scoring: +3 for every trick they won, -1 for every trick they didn\u2019t.",
    target: "other",
    note: "bidding phase only \u2014 bet before the first card falls. a Guardian\u2019s Nullify KILLS the bet outright"
  }
};
var roles = {
  peeker: {
    id: "peeker",
    name: "The Peeker",
    emoji: "\u{1F50D}",
    tagline: "Knowledge is power.",
    blurb: "The information role. Peek at hands, bids, and the deck itself \u2014 then bid like a prophet. And when knowing isn\u2019t enough, Set the Pace and take the lead for yourself.",
    color: "#66BEFF",
    abilities: ["peek_high", "peek_low", "investigate", "fortune", "set_pace"]
  },
  joker: {
    id: "joker",
    name: "The Joker",
    emoji: "\u{1F0CF}",
    tagline: "Chaos favors the bold.",
    blurb: "The chaos role. Swap cards, hands, and bids \u2014 but every swap only lands 60% of the time, and a failed roll is gone. Get BLOCKED by a Guardian, though, and you get one more go at a different player. Strongest from the BOTTOM of the scoreboard.",
    color: "#C47EF0",
    abilities: ["hand_swap", "card_theft", "bid_chaos", "fate_swap"]
  },
  gambler: {
    id: "gambler",
    name: "The Gambler",
    emoji: "\u{1F3B2}",
    tagline: "Fortune favors\u2026 someone.",
    blurb: "High risk, high reward. Raise your own stakes and flip coins with fate. For players who KNOW they\u2019ve got this.",
    color: "#FFB052",
    abilities: ["raise_stakes", "all_in", "last_chance", "crown"]
  },
  judge: {
    id: "judge",
    name: "The Judge",
    emoji: "\u2696\uFE0F",
    tagline: "Your bid is what I say it is.",
    blurb: "The interference role. Bend other players\u2019 bids, steal their tricks, and poison their information.",
    color: "#E96E6E",
    abilities: ["verdict", "sabotage", "magnet", "imposter"]
  },
  guardian: {
    id: "guardian",
    name: "The Guardian",
    emoji: "\u{1F6E1}\uFE0F",
    tagline: "Not today.",
    blurb: "The defensive role. Nullify cancels ANY ability aimed at you \u2014 peeks, swaps, verdicts, curses, even a Mirrorer\u2019s bet \u2014 and Bid Lock shuts down bid tampering on top of that.",
    color: "#7ADE8E",
    abilities: ["shield", "lock", "nullify", "gravekeeper"]
  },
  mirrorer: {
    id: "mirrorer",
    name: "The Mirrorer",
    emoji: "\u{1FA9E}",
    tagline: "Your fate is my fate.",
    blurb: "RARE. One permanent ability, every round: bet on a player and ride their tricks \u2014 their wins pay you, their losses cost you. Beware: a Guardian\u2019s Nullify wipes the bet out entirely.",
    color: "#B2D2E0",
    abilities: ["mirror_bet"],
    rare: true
  }
};
var standardRoleOrder = ["peeker", "joker", "gambler", "judge", "guardian"];
function getRole(roleId) {
  if (!roleId) return null;
  return roles[roleId] ?? null;
}
function getAbility(abilityId) {
  if (!abilityId) return null;
  return abilities[abilityId] ?? null;
}

// src/server/engine/roles.ts
var MIRRORER_CHANCE = 0.2;
var SWAP_SUCCESS = 0.6;
var MAX_SWAP_TRIES = 2;
var SWAP_ABILITIES = /* @__PURE__ */ new Set(["hand_swap", "card_theft", "bid_chaos", "fate_swap"]);
var ALL_IN_PITY = 3;
var ABILITY_REPEAT_DECAY = 0.4;
var SUIT_GLYPH = {
  Spades: "\u2660",
  Hearts: "\u2665",
  Diamonds: "\u2666",
  Clubs: "\u2663",
  Joker: "\u{1F0CF}"
};
var RANK_NAME = { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "JOKER" };
function cardText(card) {
  if (card.suit === "Joker") return "JOKER \u{1F0CF}";
  const rank = RANK_NAME[card.rank] ?? String(card.rank);
  return rank + (SUIT_GLYPH[card.suit] ?? card.suit);
}
var RoleManager = class {
  constructor(io2) {
    this.io = io2;
  }
  mode = "classic";
  rolesActive = false;
  // ---- Per-game state -------------------------------------------------------
  roleBySeat = /* @__PURE__ */ new Map();
  handSwapUsed = /* @__PURE__ */ new Set();
  // Joker's once-per-game gate
  // Ability roll fairness: the ability you were just dealt gets rarer each time
  // it repeats, and rolling anything else flattens the odds again.
  lastAbilityBySeat = /* @__PURE__ */ new Map();
  abilityRepeatStreak = /* @__PURE__ */ new Map();
  allInLossStreak = /* @__PURE__ */ new Map();
  // ---- Per-round state ------------------------------------------------------
  roundSeats = [];
  roundCardsDealt = 0;
  deckRemainder = [];
  phase = "Idle";
  playsInCurrentTrick = 0;
  firstTrickResolved = false;
  wonFirstTrick = /* @__PURE__ */ new Set();
  abilityBySeat = /* @__PURE__ */ new Map();
  abilityUsed = /* @__PURE__ */ new Set();
  // Armed (delayed) effects, per player id.
  armedShield = /* @__PURE__ */ new Set();
  armedLastChance = /* @__PURE__ */ new Set();
  armedAllIn = /* @__PURE__ */ new Set();
  armedCrown = /* @__PURE__ */ new Set();
  armedLock = /* @__PURE__ */ new Set();
  armedNullify = /* @__PURE__ */ new Set();
  /** TARGET id -> every saboteur who marked them (a list, so duplicate Judges each collect). */
  armedSabotageBy = /* @__PURE__ */ new Map();
  /** Cross-seat score deltas resolved before scoring (Sabotage's backfire hits the Judge). */
  pendingDeltas = /* @__PURE__ */ new Map();
  /** TARGET id -> number of curses stacked on them (a count, so two Guardians void two tricks). */
  armedGravekeeper = /* @__PURE__ */ new Map();
  raisedStakes = /* @__PURE__ */ new Set();
  disguisedBids = /* @__PURE__ */ new Map();
  mirrorBetOn = /* @__PURE__ */ new Map();
  // Joker swap retries, per round: attempts burned and who they've already
  // failed against (a retry has to find a new mark).
  swapAttempts = /* @__PURE__ */ new Map();
  swapTriedTargets = /* @__PURE__ */ new Map();
  /** Peeker's Set the Pace: who has claimed the next trick's lead. */
  pendingLeadId = null;
  // ---- Mode -----------------------------------------------------------------
  setMode(mode) {
    this.mode = mode;
  }
  getMode() {
    return this.mode;
  }
  isActive() {
    return this.rolesActive;
  }
  // ---- Helpers --------------------------------------------------------------
  findSeat(id) {
    return this.roundSeats.find((s) => s.id === id) ?? null;
  }
  announce(message) {
    this.io.broadcast("roleAnnounce", { message });
  }
  privateResult(seat, message) {
    this.io.send(seat, "abilityResult", { message });
  }
  actionError(seat, message) {
    this.io.send(seat, "actionError", message);
  }
  sendRoleState(seat, roundIntro = false) {
    const state = {
      active: this.rolesActive,
      roleId: this.roleBySeat.get(seat.id) ?? null,
      abilityId: this.abilityBySeat.get(seat.id) ?? null,
      used: this.abilityUsed.has(seat.id),
      handSwapUsed: this.handSwapUsed.has(seat.id),
      roundIntro
    };
    this.io.send(seat, "roleState", state);
  }
  /** The role state a reconnecting client should be handed. */
  getRoleState(seat) {
    if (!this.rolesActive) return null;
    return {
      active: true,
      roleId: this.roleBySeat.get(seat.id) ?? null,
      abilityId: this.abilityBySeat.get(seat.id) ?? null,
      used: this.abilityUsed.has(seat.id),
      handSwapUsed: this.handSwapUsed.has(seat.id),
      roundIntro: false
    };
  }
  resendHand(seat) {
    this.io.send(seat, "dealHand", { hand: seat.hand });
  }
  /** The bid map clients should DISPLAY: real bids with disguises applied. */
  displayedBids() {
    const bids = {};
    for (const seat of this.roundSeats) {
      if (seat.bid != null) bids[seat.id] = this.disguisedBids.get(seat.id) ?? seat.bid;
    }
    return bids;
  }
  syncBids() {
    this.io.broadcast("roleSync", { bids: this.displayedBids() });
  }
  syncTricks() {
    const tricks = {};
    for (const seat of this.roundSeats) tricks[seat.id] = seat.tricksWon;
    this.io.broadcast("roleSync", { tricks });
  }
  // ---- Game / round lifecycle ----------------------------------------------
  /**
   * Called when a chaos game starts. EVERY seat gets a role. Roles are dealt
   * round-robin from a shuffled pool, so past the pool size they repeat -- with
   * 10 players over 6 roles, four roles appear twice and two appear once, and
   * which ones double up is random every game.
   */
  assignRoles(seats) {
    this.rolesActive = true;
    this.roleBySeat.clear();
    this.handSwapUsed.clear();
    this.lastAbilityBySeat.clear();
    this.abilityRepeatStreak.clear();
    this.allInLossStreak.clear();
    const pool = [...standardRoleOrder];
    if (Math.random() < MIRRORER_CHANCE) pool.push("mirrorer");
    shuffle(pool);
    const seatPicks = shuffle([...seats]);
    seatPicks.forEach((seat, i) => {
      this.roleBySeat.set(seat.id, pool[i % pool.length]);
    });
  }
  resetGame() {
    this.rolesActive = false;
    this.roleBySeat.clear();
    this.handSwapUsed.clear();
    this.roundSeats = [];
    this.abilityBySeat.clear();
    this.abilityUsed.clear();
    this.lastAbilityBySeat.clear();
    this.abilityRepeatStreak.clear();
    this.allInLossStreak.clear();
    this.phase = "Idle";
  }
  /**
   * Picks this round's ability. All options start equally likely; the one dealt
   * last round is weighted down, and more so the longer it has been repeating.
   * Rolling anything else clears the streak and the odds go flat again.
   */
  rollAbility(id, options) {
    if (options.length === 1) {
      this.lastAbilityBySeat.set(id, options[0]);
      this.abilityRepeatStreak.set(id, (this.abilityRepeatStreak.get(id) ?? 0) + 1);
      return options[0];
    }
    const lastId = this.lastAbilityBySeat.get(id);
    const streak = this.abilityRepeatStreak.get(id) ?? 0;
    const weights = options.map(
      (option) => option === lastId && streak > 0 ? ABILITY_REPEAT_DECAY ** streak : 1
    );
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let picked = options[options.length - 1];
    for (let i = 0; i < options.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        picked = options[i];
        break;
      }
    }
    if (picked === lastId) {
      this.abilityRepeatStreak.set(id, streak + 1);
    } else {
      this.lastAbilityBySeat.set(id, picked);
      this.abilityRepeatStreak.set(id, 1);
    }
    return picked;
  }
  /**
   * Called right after the deal. Rolls this round's ability for every player
   * and privately tells each their role + ability.
   */
  startRound(seats, cardsDealt, remainder) {
    if (!this.rolesActive) return;
    this.roundSeats = seats;
    this.roundCardsDealt = cardsDealt;
    this.deckRemainder = remainder;
    this.phase = "Bidding";
    this.playsInCurrentTrick = 0;
    this.firstTrickResolved = false;
    this.wonFirstTrick.clear();
    this.abilityBySeat.clear();
    this.abilityUsed.clear();
    this.armedShield.clear();
    this.armedLastChance.clear();
    this.armedAllIn.clear();
    this.armedCrown.clear();
    this.armedLock.clear();
    this.armedNullify.clear();
    this.armedSabotageBy.clear();
    this.pendingDeltas.clear();
    this.armedGravekeeper.clear();
    this.raisedStakes.clear();
    this.disguisedBids.clear();
    this.mirrorBetOn.clear();
    this.swapAttempts.clear();
    this.swapTriedTargets.clear();
    this.pendingLeadId = null;
    for (const seat of seats) {
      const role = getRole(this.roleBySeat.get(seat.id));
      if (!role) continue;
      let options = [...role.abilities];
      if (this.handSwapUsed.has(seat.id)) {
        options = options.filter((id) => id !== "hand_swap");
      }
      if (seats.length < 3) {
        options = options.filter((id) => getAbility(id)?.target !== "two");
      }
      if (options.length > 0) {
        this.abilityBySeat.set(seat.id, this.rollAbility(seat.id, options));
      }
      this.sendRoleState(seat, true);
    }
  }
  setPhase(phase) {
    if (this.rolesActive) this.phase = phase;
  }
  endRound() {
    if (!this.rolesActive) return;
    this.phase = "Idle";
    this.disguisedBids.clear();
  }
  // ---- TrickManager hooks ---------------------------------------------------
  noteTrickProgress(playsSoFar) {
    if (this.rolesActive) this.playsInCurrentTrick = playsSoFar;
  }
  /**
   * Who actually leads the next trick. Normally the seat TrickManager picked
   * (the trick winner, or the round's opening leader), unless a Peeker has
   * claimed the lead with Set the Pace. Consumed on use.
   */
  overrideNextLeader(defaultSeat) {
    if (!this.rolesActive || this.pendingLeadId == null) return defaultSeat;
    const claimant = this.findSeat(this.pendingLeadId);
    this.pendingLeadId = null;
    if (!claimant || claimant.hand.length === 0 || claimant.id === defaultSeat.id) {
      return defaultSeat;
    }
    this.announce(
      `\u{1F50D} SET THE PACE! The Peeker seizes the lead from ${defaultSeat.name} and opens the next trick.`
    );
    return claimant;
  }
  /**
   * Called when a trick resolves, BEFORE tricksWon is incremented. Returns
   * false if the win shouldn't count (Gravekeeper curse), consuming the curse.
   */
  consumeTrickWin(winner, trickNumber) {
    if (!this.rolesActive) return true;
    this.playsInCurrentTrick = 0;
    if (trickNumber === 1) this.firstTrickResolved = true;
    const curses = this.armedGravekeeper.get(winner.id) ?? 0;
    if (curses > 0) {
      this.armedGravekeeper.set(winner.id, curses - 1);
      this.announce(`\u26B0\uFE0F The Gravekeeper's curse strikes! ${winner.name}'s trick doesn't count.`);
      return false;
    }
    if (trickNumber === 1) this.wonFirstTrick.add(winner.id);
    return true;
  }
  // ---- ScoringManager hooks -------------------------------------------------
  /**
   * Runs once before any seat is scored. Resolves effects whose outcome lands
   * on a DIFFERENT seat than the one that triggered them (Sabotage's backfire),
   * because adjustScore only ever sees one seat at a time.
   */
  prepareScoring() {
    if (!this.rolesActive) return;
    this.pendingDeltas.clear();
    for (const [targetId, saboteurIds] of this.armedSabotageBy) {
      const target = this.findSeat(targetId);
      if (!target) continue;
      if (Math.abs((target.bid ?? 0) - target.tricksWon) === 0) continue;
      for (const saboteurId of saboteurIds) {
        if (!this.findSeat(saboteurId)) continue;
        this.pendingDeltas.set(saboteurId, (this.pendingDeltas.get(saboteurId) ?? 0) - 5);
        this.announce(
          `\u2696\uFE0F Sabotage BACKFIRES! ${target.name} missed anyway \u2014 the Judge loses 5.`
        );
      }
    }
  }
  /**
   * Adjusts a seat's base round score with every armed chaos effect. Announces
   * anything the table should know about.
   */
  adjustScore(seat, baseScore) {
    if (!this.rolesActive) return baseScore;
    const id = seat.id;
    const name = seat.name;
    const bid = seat.bid ?? 0;
    const diff = Math.abs(bid - seat.tricksWon);
    let score = baseScore;
    if (this.armedShield.has(id) && diff === 1) {
      score = calculateScore(bid, bid, seat.hasDoubled);
      this.announce(`\u{1F6E1}\uFE0F The Guardian's Shield saves ${name} \u2014 scored as a hit!`);
    } else if (this.armedLastChance.has(id) && diff === 1) {
      if (randomInt(0, 1) === 1) {
        score = calculateScore(bid, bid, seat.hasDoubled);
        this.announce(`\u{1F3B2} Last Chance pays off! ${name} scores as if they hit their bid.`);
      } else {
        score = score * 2;
        this.announce(`\u{1F3B2} Last Chance backfires! ${name} takes double the penalty.`);
      }
    }
    if (this.raisedStakes.has(id) && diff === 0) {
      score += 10;
      this.announce(`\u{1F3B2} The Gambler raised the stakes and DELIVERED: ${name} banks +10.`);
    }
    if (this.armedCrown.has(id) && this.wonFirstTrick.has(id)) {
      score += 10;
      this.announce(`\u{1F451} ${name} claimed the crown \u2014 first trick won, +10!`);
    }
    if (this.armedAllIn.has(id)) {
      const lossStreak = this.allInLossStreak.get(id) ?? 0;
      const won = lossStreak >= ALL_IN_PITY || randomInt(0, 1) === 1;
      if (won) {
        score += 15;
        this.allInLossStreak.set(id, 0);
        this.announce(
          lossStreak >= ALL_IN_PITY ? `\u{1F3B2} ALL IN: the streak breaks \u2014 the coin finally lands for ${name}. +15!` : `\u{1F3B2} ALL IN: the coin lands right for ${name}. +15!`
        );
      } else {
        score -= 15;
        this.allInLossStreak.set(id, lossStreak + 1);
        this.announce(`\u{1F3B2} ALL IN: the coin betrays ${name}. -15.`);
      }
    }
    const marks = this.armedSabotageBy.get(id);
    if (marks && diff === 0) {
      score -= 10 * marks.length;
      this.announce(
        `\u2696\uFE0F Sabotage! ${name} hit their bid but ${marks.length > 1 ? "the Judges take" : "the Judge takes"} ${10 * marks.length} points away.`
      );
    }
    const pending = this.pendingDeltas.get(id);
    if (pending) score += pending;
    const betTargetId = this.mirrorBetOn.get(id);
    if (betTargetId) {
      const betTarget = this.findSeat(betTargetId);
      if (betTarget) {
        const won = betTarget.tricksWon;
        const delta = 3 * won - (this.roundCardsDealt - won);
        score += delta;
        this.announce(
          delta >= 0 ? `\u{1FA9E} The Mirrorer bet on ${betTarget.name} \u2014 it pays out! +${delta}.` : `\u{1FA9E} The Mirrorer bet on ${betTarget.name} \u2014 it backfires. ${delta}.`
        );
      }
    }
    return score;
  }
  /** Role info for the final standings reveal. */
  getRoleReveal(id) {
    if (!this.rolesActive) return null;
    const role = getRole(this.roleBySeat.get(id));
    if (!role) return null;
    return { roleName: role.name, roleEmoji: role.emoji };
  }
  // ---- Ability execution ----------------------------------------------------
  isBidAffecting(abilityId) {
    return abilityId === "verdict" || abilityId === "fate_swap" || abilityId === "bid_chaos" || abilityId === "imposter";
  }
  /**
   * True if the target's defenses stopped the ability. Consumes the attacker's
   * ability either way (the caller marks it used on any return).
   */
  blockedByDefenses(target, abilityId) {
    if (this.armedNullify.has(target.id)) {
      this.armedNullify.delete(target.id);
      this.announce(`\u{1F6E1}\uFE0F The Guardian's Nullify shattered an ability aimed at ${target.name}!`);
      return true;
    }
    if (this.isBidAffecting(abilityId) && this.armedLock.has(target.id)) {
      this.announce(`\u{1F6E1}\uFE0F ${target.name}'s bid is LOCKED \u2014 the meddling fizzled.`);
      return true;
    }
    return false;
  }
  /** How many players this Joker hasn't already aimed a swap at this round. */
  untriedTargetCount(id) {
    const tried = this.swapTriedTargets.get(id);
    return this.roundSeats.filter((other) => other.id !== id && !tried?.has(other.id)).length;
  }
  /**
   * Called when a Joker swap bounces off a Guardian's defenses. Being BLOCKED
   * doesn't burn the turn the way a fizzle does: the Joker gets one more go, at
   * someone they haven't aimed at yet. Returns keepAbility -- false once
   * MAX_SWAP_TRIES is reached or the table has no fresh targets left, at which
   * point the ability is finally spent. `needed` is how many fresh marks
   * another attempt would require (2 for Bid Chaos, 1 otherwise).
   */
  retryAfterBlock(seat, targets, needed) {
    let tried = this.swapTriedTargets.get(seat.id);
    if (!tried) {
      tried = /* @__PURE__ */ new Set();
      this.swapTriedTargets.set(seat.id, tried);
    }
    for (const target of targets) tried.add(target.id);
    const attempts = (this.swapAttempts.get(seat.id) ?? 0) + 1;
    this.swapAttempts.set(seat.id, attempts);
    if (attempts < MAX_SWAP_TRIES && this.untriedTargetCount(seat.id) >= needed) {
      this.privateResult(
        seat,
        "BLOCKED \u2014 but a block doesn't cost you the turn. One more try, at someone you haven't aimed at yet."
      );
      return true;
    }
    this.privateResult(
      seat,
      attempts >= MAX_SWAP_TRIES ? "BLOCKED again \u2014 that was your second attempt. The ability is spent." : "BLOCKED, and there's nobody new left to aim at. The ability is spent."
    );
    return false;
  }
  /**
   * Every Joker swap only lands SWAP_SUCCESS of the time. A fizzle is the dice
   * simply refusing -- unlike a block, it ends the turn then and there.
   */
  swapFizzled(seat, flavor) {
    if (Math.random() < SWAP_SUCCESS) return false;
    this.announce("\u{1F0CF} " + flavor);
    this.privateResult(
      seat,
      "It FAILED. The Joker's swaps only land 60% of the time, and this was the other 40% \u2014 your ability is spent."
    );
    return true;
  }
  /**
   * Executes one ability. On ok the ability is consumed even if a defense
   * blocked it -- a spent shot is a spent shot. keepAbility is true only when a
   * Joker swap was BLOCKED with retries left: the attempt resolved, but the
   * ability stays live so they can aim it somewhere new.
   */
  executeAbility(seat, abilityId, payload) {
    const id = seat.id;
    const myName = seat.name;
    const def = getAbility(abilityId);
    if (!def) return { ok: false, error: "Unknown ability." };
    let target = null;
    if (def.target === "other" || def.target === "two") {
      const targetId = payload.targetId;
      if (!targetId || targetId === id) {
        return { ok: false, error: "Pick another player as the target." };
      }
      target = this.findSeat(targetId);
      if (!target) return { ok: false, error: "That player isn't in the round." };
    }
    let target2 = null;
    if (def.target === "two") {
      const targetId2 = payload.targetId2;
      if (!targetId2 || targetId2 === id) return { ok: false, error: "Pick two OTHER players." };
      if (target && targetId2 === target.id) {
        return { ok: false, error: "Pick two different players." };
      }
      target2 = this.findSeat(targetId2);
      if (!target2) return { ok: false, error: "That player isn't in the round." };
    }
    if (SWAP_ABILITIES.has(abilityId) && target) {
      const tried = this.swapTriedTargets.get(id);
      const needed = def.target === "two" ? 2 : 1;
      if (tried && this.untriedTargetCount(id) >= needed) {
        if (tried.has(target.id) || target2 && tried.has(target2.id)) {
          return {
            ok: false,
            error: "That swap already failed on them. Pick someone you haven't tried."
          };
        }
      }
    }
    switch (abilityId) {
      case "peek_high":
      case "peek_low": {
        const t = target;
        if (t.hand.length === 0) return { ok: false, error: "They have no cards left." };
        if (this.blockedByDefenses(t, abilityId)) {
          this.privateResult(seat, "Your peek was NULLIFIED by the Guardian.");
          return { ok: true };
        }
        const ranked = [...t.hand].sort(
          (a, b) => abilityId === "peek_high" ? b.rank - a.rank : a.rank - b.rank
        );
        const shown = ranked.slice(0, 2).map(cardText).join("   ");
        this.privateResult(
          seat,
          `${t.name}'s ${abilityId === "peek_high" ? "TOP TWO" : "BOTTOM TWO"}: ${shown}`
        );
        return { ok: true };
      }
      case "investigate": {
        const t = target;
        if (this.blockedByDefenses(t, abilityId)) {
          this.privateResult(seat, "Your investigation was NULLIFIED by the Guardian.");
          return { ok: true };
        }
        const bidText = t.bid != null ? String(t.bid) : "not placed yet";
        const disguiseNote = this.disguisedBids.has(t.id) ? " (their public bid is a DISGUISE)" : "";
        this.privateResult(
          seat,
          `${t.name} \u2014 true bid: ${bidText}${disguiseNote}, tricks won: ${t.tricksWon}, doubled: ${t.hasDoubled ? "YES \u2014 they're swinging for double" : "no"}`
        );
        return { ok: true };
      }
      case "fortune": {
        if (this.deckRemainder.length === 0) {
          return { ok: false, error: "No cards left in the deck this round." };
        }
        const peek = this.deckRemainder.slice(0, 5).map(cardText).join("   ");
        this.privateResult(seat, "Top of the deck: " + peek);
        return { ok: true };
      }
      case "set_pace": {
        if (seat.hand.length === 0) {
          return { ok: false, error: "You have no cards left to lead with." };
        }
        if (this.pendingLeadId != null) {
          return { ok: false, error: "The lead is already claimed for the next trick." };
        }
        this.pendingLeadId = id;
        this.privateResult(
          seat,
          "You've claimed the lead. You open the next trick \u2014 the table will see the lead jump to you, so expect questions."
        );
        return { ok: true };
      }
      case "hand_swap": {
        const t = target;
        if (this.handSwapUsed.has(id)) {
          return { ok: false, error: "The Big Swap is once per game \u2014 you've used it." };
        }
        if (this.roundSeats.some((other) => other.totalScore < seat.totalScore)) {
          return {
            ok: false,
            error: "The Big Swap only works while you're lowest on the scoreboard."
          };
        }
        if (this.playsInCurrentTrick > 0) {
          return { ok: false, error: "Wait for the current trick to finish." };
        }
        if (t.hand.length === 0 || seat.hand.length === 0) {
          return { ok: false, error: "No cards left to swap." };
        }
        if (this.blockedByDefenses(t, abilityId)) {
          const keep = this.retryAfterBlock(seat, [t], 1);
          if (!keep) this.handSwapUsed.add(id);
          return { ok: true, keepAbility: keep };
        }
        this.handSwapUsed.add(id);
        if (this.swapFizzled(
          seat,
          `The Joker reached for ${t.name}'s hand\u2026 and came up EMPTY. The Big Swap failed!`
        )) {
          return { ok: true };
        }
        const mine = seat.hand;
        seat.hand = t.hand;
        t.hand = mine;
        this.resendHand(seat);
        this.resendHand(t);
        this.announce(`\u{1F0CF} THE BIG SWAP! The Joker traded entire hands with ${t.name}!`);
        this.privateResult(t, "The Joker swapped hands with you. Those cards are yours now.");
        return { ok: true };
      }
      case "card_theft": {
        const t = target;
        if (this.playsInCurrentTrick > 0) {
          return { ok: false, error: "Wait for the current trick to finish." };
        }
        if (t.hand.length === 0 || seat.hand.length === 0) {
          return { ok: false, error: "No cards left to trade." };
        }
        if (this.blockedByDefenses(t, abilityId)) {
          return { ok: true, keepAbility: this.retryAfterBlock(seat, [t], 1) };
        }
        if (this.swapFizzled(
          seat,
          `The Joker's fingers slipped \u2014 the trade with ${t.name} never happened!`
        )) {
          return { ok: true };
        }
        const myIdx = randomInt(0, seat.hand.length - 1);
        const theirIdx = randomInt(0, t.hand.length - 1);
        const mine = seat.hand[myIdx];
        const theirs = t.hand[theirIdx];
        seat.hand[myIdx] = theirs;
        t.hand[theirIdx] = mine;
        sortHand(seat.hand);
        sortHand(t.hand);
        this.resendHand(seat);
        this.resendHand(t);
        this.announce(`\u{1F0CF} Sticky Fingers! The Joker traded a random card with ${t.name}.`);
        this.privateResult(seat, `You gave away ${cardText(mine)} and got ${cardText(theirs)}.`);
        this.privateResult(
          t,
          `The Joker took your ${cardText(theirs)} and left you ${cardText(mine)}.`
        );
        return { ok: true };
      }
      case "bid_chaos": {
        const t = target;
        const t2 = target2;
        if (this.phase !== "Playing") {
          return { ok: false, error: "Bids can only be swapped once play begins." };
        }
        if (t.bid == null || t2.bid == null) {
          return { ok: false, error: "Both players need a bid first." };
        }
        const blocked1 = this.blockedByDefenses(t, abilityId);
        const blocked2 = blocked1 ? false : this.blockedByDefenses(t2, abilityId);
        if (blocked1 || blocked2) {
          return { ok: true, keepAbility: this.retryAfterBlock(seat, [t, t2], 2) };
        }
        if (this.swapFizzled(
          seat,
          `The Joker went for ${t.name}'s and ${t2.name}'s bids\u2026 and fumbled it. Nothing changed!`
        )) {
          return { ok: true };
        }
        const tmp = t.bid;
        t.bid = t2.bid;
        t2.bid = tmp;
        this.syncBids();
        this.announce(
          `\u{1F0CF} BID CHAOS! The Joker swapped ${t.name}'s and ${t2.name}'s bids! (${t2.bid} \u2194 ${t.bid})`
        );
        return { ok: true };
      }
      case "fate_swap": {
        const t = target;
        if (this.phase !== "Playing") {
          return { ok: false, error: "Bids can only be swapped once play begins." };
        }
        if (seat.bid == null || t.bid == null) {
          return { ok: false, error: "Both bids need to be placed first." };
        }
        if (this.blockedByDefenses(t, abilityId)) {
          return { ok: true, keepAbility: this.retryAfterBlock(seat, [t], 1) };
        }
        if (this.swapFizzled(seat, `The Joker tried to trade fates with ${t.name}\u2026 and fate said no!`)) {
          return { ok: true };
        }
        const tmp = seat.bid;
        seat.bid = t.bid;
        t.bid = tmp;
        this.syncBids();
        this.announce(
          `\u{1F0CF} FATE SWAP! The Joker swapped bids with ${t.name}! (now ${seat.bid} \u2194 ${t.bid})`
        );
        return { ok: true };
      }
      case "raise_stakes": {
        if (this.phase !== "Playing") {
          return { ok: false, error: "Raise the stakes once play begins." };
        }
        if (seat.bid == null) return { ok: false, error: "You need a bid first." };
        if (seat.bid >= this.roundCardsDealt) {
          return { ok: false, error: "Your bid is already at the max for this round." };
        }
        seat.bid += 1;
        this.raisedStakes.add(id);
        this.syncBids();
        this.announce(
          `\u{1F3B2} The Gambler RAISES THE STAKES: ${myName}'s bid is now ${seat.bid} (+10 bonus if they hit it).`
        );
        return { ok: true };
      }
      case "all_in": {
        this.armedAllIn.add(id);
        this.announce("\u{1F3B2} The Gambler goes ALL IN. A coin flips at the end of the round\u2026");
        this.privateResult(seat, "You're all in: +15 or -15 at scoring. No take-backs.");
        return { ok: true };
      }
      case "last_chance": {
        this.armedLastChance.add(id);
        this.privateResult(
          seat,
          "Last Chance armed: if you miss your bid by exactly 1, a coin decides \u2014 full credit or double the pain."
        );
        return { ok: true };
      }
      case "crown": {
        if (this.firstTrickResolved) return { ok: false, error: "The first trick is already done." };
        this.armedCrown.add(id);
        this.announce(`\u{1F451} ${myName} declares for the crown: +10 if they win the FIRST trick!`);
        return { ok: true };
      }
      case "verdict": {
        const t = target;
        if (this.phase !== "Playing") {
          return { ok: false, error: "Verdicts can only be passed once play begins." };
        }
        if (t.bid == null) return { ok: false, error: "They haven't bid yet." };
        const direction = payload.direction === -1 ? -1 : 1;
        const newBid = t.bid + direction;
        if (newBid < 0 || newBid > this.roundCardsDealt) {
          return { ok: false, error: "That would push their bid out of range." };
        }
        if (this.blockedByDefenses(t, abilityId)) return { ok: true };
        const oldBid = t.bid;
        t.bid = newBid;
        this.syncBids();
        this.announce(`\u2696\uFE0F VERDICT! The Judge changed ${t.name}'s bid: ${oldBid} \u2192 ${newBid}.`);
        return { ok: true };
      }
      case "sabotage": {
        const t = target;
        if (this.blockedByDefenses(t, abilityId)) return { ok: true };
        const marks = this.armedSabotageBy.get(t.id) ?? [];
        marks.push(id);
        this.armedSabotageBy.set(t.id, marks);
        this.privateResult(
          seat,
          `Sabotage armed on ${t.name}: -10 for them if they hit their bid exactly \u2014 but -5 for YOU if they miss. Pick your marks carefully.`
        );
        return { ok: true };
      }
      case "magnet": {
        const t = target;
        if (this.phase !== "Playing") {
          return { ok: false, error: "Tricks can only be stolen during play." };
        }
        if (t.tricksWon < 1) return { ok: false, error: "They haven't won a trick yet." };
        if (this.blockedByDefenses(t, abilityId)) return { ok: true };
        t.tricksWon -= 1;
        seat.tricksWon += 1;
        this.syncTricks();
        this.announce(`\u2696\uFE0F TRICK MAGNET! The Judge stole one of ${t.name}'s tricks!`);
        return { ok: true };
      }
      case "imposter": {
        const t = target;
        if (this.phase !== "Playing") {
          return { ok: false, error: "Disguises only work once play begins." };
        }
        if (t.bid == null) return { ok: false, error: "They haven't bid yet." };
        if (this.blockedByDefenses(t, abilityId)) return { ok: true };
        const realBid = t.bid;
        let fake = realBid;
        while (fake === realBid) fake = randomInt(0, this.roundCardsDealt);
        this.disguisedBids.set(t.id, fake);
        this.syncBids();
        this.privateResult(
          seat,
          `${t.name}'s bid now shows as ${fake} to the table (really ${realBid}). Only Investigate sees through it.`
        );
        this.privateResult(
          t,
          `\u2696\uFE0F The Judge disguised your bid! The table sees ${fake}, but your REAL bid of ${realBid} is what counts.`
        );
        return { ok: true };
      }
      case "shield": {
        this.armedShield.add(id);
        this.privateResult(
          seat,
          "Shield up: if you miss your bid by exactly 1 this round, you score as if you hit it."
        );
        return { ok: true };
      }
      case "lock": {
        this.armedLock.add(id);
        this.announce(`\u{1F6E1}\uFE0F The Guardian LOCKED ${myName}'s bid. Hands off.`);
        return { ok: true };
      }
      case "nullify": {
        this.armedNullify.add(id);
        this.privateResult(seat, "Nullify armed: the next ability aimed at you this round fizzles.");
        return { ok: true };
      }
      case "gravekeeper": {
        const t = target;
        if (this.blockedByDefenses(t, abilityId)) return { ok: true };
        this.armedGravekeeper.set(t.id, (this.armedGravekeeper.get(t.id) ?? 0) + 1);
        this.privateResult(
          seat,
          `Curse placed on ${t.name}: the next trick they win doesn't count. They'll find out the hard way.`
        );
        return { ok: true };
      }
      case "mirror_bet": {
        const t = target;
        if (this.phase !== "Bidding") {
          return { ok: false, error: "Bets close when the first card falls \u2014 bet during bidding." };
        }
        if (this.blockedByDefenses(t, abilityId)) return { ok: true };
        this.mirrorBetOn.set(id, t.id);
        this.privateResult(
          seat,
          `Bet placed on ${t.name}: +3 for every trick they win this round, -1 for every trick they don't.`
        );
        return { ok: true };
      }
      default:
        return { ok: false, error: "Unknown ability." };
    }
  }
  /** Entry point for the client's `useAbility` event. */
  handleUseAbility(seat, payload) {
    if (!this.rolesActive) {
      this.actionError(seat, "Abilities are only available in chaos mode.");
      return;
    }
    if (this.phase !== "Bidding" && this.phase !== "Playing") {
      this.actionError(seat, "Abilities can't be used between rounds.");
      return;
    }
    const abilityId = this.abilityBySeat.get(seat.id);
    if (!abilityId) {
      this.actionError(seat, "You don't have an ability this round.");
      return;
    }
    if (this.abilityUsed.has(seat.id)) {
      this.actionError(seat, "You've already used your ability this round.");
      return;
    }
    const { ok, error, keepAbility } = this.executeAbility(seat, abilityId, payload ?? {});
    if (!ok) {
      this.actionError(seat, error ?? "That doesn't work right now.");
      return;
    }
    if (!keepAbility) this.abilityUsed.add(seat.id);
    this.sendRoleState(seat);
  }
};

// src/server/engine/bidding.ts
var BiddingManager = class {
  constructor(io2, roles2, systemChat) {
    this.io = io2;
    this.roles = roles2;
    this.systemChat = systemChat;
  }
  currentTurnSeat = null;
  currentCardsDealt = 0;
  currentIsLastBidder = false;
  currentSumSoFar = 0;
  resolver = null;
  doublesLocked = false;
  /** Seat whose post-bid Double window is currently open (null otherwise). */
  doubleWindowSeat = null;
  doubleWindowResolve = null;
  isValidBid(bid, cardsDealt, isLastBidder, sumSoFar) {
    if (!Number.isInteger(bid) || bid < 0 || bid > cardsDealt) return false;
    if (isLastBidder && sumSoFar + bid === cardsDealt) return false;
    return true;
  }
  /**
   * Fallback bid for disconnected players: the smallest legal value, so an
   * empty chair doesn't skew scoring too wildly.
   */
  autoChooseBid(cardsDealt, isLastBidder, sumSoFar) {
    for (let bid = 0; bid <= cardsDealt; bid++) {
      if (this.isValidBid(bid, cardsDealt, isLastBidder, sumSoFar)) return bid;
    }
    return 0;
  }
  broadcastBidState(turnOrder) {
    const bids = {};
    for (const seat of turnOrder) {
      if (seat.bid != null) bids[seat.id] = seat.bid;
    }
    const displayed = this.roles.isActive() ? this.roles.displayedBids() : bids;
    this.io.broadcast("gameState", {
      phase: "Bidding",
      currentTurnId: this.currentTurnSeat?.id ?? null,
      bids: displayed,
      cardsDealt: this.currentCardsDealt
    });
  }
  waitForBid(seat, cardsDealt, isLastBidder, sumSoFar) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (bid) => {
        if (settled) return;
        settled = true;
        this.resolver = null;
        resolve(bid);
      };
      this.resolver = finish;
      if (!seat.connected) {
        setImmediate(() => finish(this.autoChooseBid(cardsDealt, isLastBidder, sumSoFar)));
      }
    });
  }
  /** Resolves the pending wait if the seat we're waiting on just dropped. */
  onSeatDisconnected(seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(
        this.autoChooseBid(this.currentCardsDealt, this.currentIsLastBidder, this.currentSumSoFar)
      );
    }
    if (this.doubleWindowSeat?.id === seat.id) this.closeDoubleWindow();
  }
  closeDoubleWindow() {
    this.doubleWindowSeat = null;
    const resolve = this.doubleWindowResolve;
    this.doubleWindowResolve = null;
    resolve?.();
  }
  /** Blocks until every seat in turnOrder has bid. */
  async runBiddingPhase(turnOrder, cardsDealt) {
    this.doublesLocked = false;
    this.currentCardsDealt = cardsDealt;
    let sumSoFar = 0;
    for (let i = 0; i < turnOrder.length; i++) {
      const seat = turnOrder[i];
      this.currentTurnSeat = seat;
      this.currentIsLastBidder = i === turnOrder.length - 1;
      this.currentSumSoFar = sumSoFar;
      this.broadcastBidState(turnOrder);
      const bid = await this.waitForBid(seat, cardsDealt, this.currentIsLastBidder, sumSoFar);
      seat.bid = bid;
      sumSoFar += bid;
      this.broadcastBidState(turnOrder);
      if (seat.connected && canDouble(bid)) {
        this.doubleWindowSeat = seat;
        this.io.send(seat, "doubleWindow", { seconds: Config.doubleWindowSeconds });
        await new Promise((resolve) => {
          this.doubleWindowResolve = resolve;
          setTimeout(() => {
            if (this.doubleWindowSeat?.id === seat.id) this.closeDoubleWindow();
          }, Config.doubleWindowSeconds * 1e3);
        });
      }
    }
    this.currentTurnSeat = null;
  }
  /** Client fired `submitBid`. */
  handleBidSubmission(seat, bid) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, "actionError", "It's not your turn to bid.");
      return;
    }
    if (typeof bid !== "number" || !this.isValidBid(bid, this.currentCardsDealt, this.currentIsLastBidder, this.currentSumSoFar)) {
      this.io.send(seat, "actionError", "That bid isn't allowed.");
      return;
    }
    this.resolver?.(bid);
  }
  /**
   * Client fired `declareDouble`. Doubling is a one-way, final commitment for
   * the round: once declared it can't be taken back, so we only ever set it to
   * true and reject repeats. It's only legal inside the short post-bid window.
   */
  handleDeclareDouble(seat) {
    if (this.doublesLocked) {
      this.io.send(seat, "actionError", "Too late to double \u2014 play has started.");
      return;
    }
    if (seat.bid == null) {
      this.io.send(seat, "actionError", "Place your bid before doubling.");
      return;
    }
    if (seat.hasDoubled) return;
    if (this.doubleWindowSeat?.id !== seat.id) {
      this.io.send(seat, "actionError", "Your chance to double has passed.");
      return;
    }
    if (!canDouble(seat.bid)) {
      this.io.send(seat, "actionError", "Double is only allowed on a bid of 0 this game.");
      return;
    }
    seat.hasDoubled = true;
    this.systemChat(
      `\u{1F525} ${seat.name} DOUBLES DOWN on a bid of ${seat.bid} \u2014 twice the reward, twice the fall.`
    );
    this.closeDoubleWindow();
  }
  /** Call once bidding is complete and the play phase is starting. */
  lockDoubles() {
    this.doublesLocked = true;
    this.closeDoubleWindow();
  }
};

// src/server/engine/tricks.ts
var TrickManager = class {
  constructor(io2, roles2) {
    this.io = io2;
    this.roles = roles2;
  }
  currentTurnSeat = null;
  currentLeadSuit = null;
  resolver = null;
  // Mirrored for the reconnect snapshot: what's on the table right now.
  livePlays = [];
  liveTrickNumber = 0;
  snapshot() {
    return {
      currentTurnId: this.currentTurnSeat?.id ?? null,
      leadSuit: this.currentLeadSuit,
      plays: this.livePlays,
      trickNumber: this.liveTrickNumber
    };
  }
  reset() {
    this.currentTurnSeat = null;
    this.currentLeadSuit = null;
    this.livePlays = [];
    this.liveTrickNumber = 0;
  }
  rotateToStart(seatOrder, startSeat) {
    const startIndex = Math.max(
      0,
      seatOrder.findIndex((s) => s.id === startSeat.id)
    );
    return seatOrder.map((_, i) => seatOrder[(startIndex + i) % seatOrder.length]);
  }
  /**
   * Removes the played card from the seat's hand AND pushes the updated hand to
   * that client. Without the re-send the client keeps rendering its original
   * dealt hand, so played cards appear to stay in it all round.
   */
  removeCardFromHand(seat, card) {
    const index = seat.hand.findIndex((c) => isSameCard(c, card));
    if (index >= 0) seat.hand.splice(index, 1);
    this.io.send(seat, "dealHand", { hand: seat.hand });
  }
  findAutoPlayCard(hand, leadSuit) {
    return hand.find((card) => isLegalPlay(card, hand, leadSuit)) ?? hand[0];
  }
  broadcastTrickState(plays, leadSuit, trickNumber, totalTricks) {
    this.livePlays = plays.map((p) => ({ id: p.seat.id, card: p.card }));
    this.liveTrickNumber = trickNumber;
    this.currentLeadSuit = leadSuit;
    this.io.broadcast("trickUpdate", {
      currentTurnId: this.currentTurnSeat?.id ?? null,
      plays: this.livePlays,
      leadSuit,
      trickNumber,
      totalTricks
    });
  }
  waitForCardPlay(seat, leadSuit) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (card) => {
        if (settled) return;
        settled = true;
        this.resolver = null;
        resolve(card);
      };
      this.resolver = finish;
      if (!seat.connected) {
        setImmediate(() => finish(this.findAutoPlayCard(seat.hand, leadSuit)));
      }
    });
  }
  onSeatDisconnected(seat) {
    if (this.currentTurnSeat?.id === seat.id && this.resolver) {
      this.resolver(this.findAutoPlayCard(seat.hand, this.currentLeadSuit));
    }
  }
  /**
   * Blocks until `cardsDealt` tricks have been played out. `seatOrder` is the
   * full table in fixed seat order; `leaderSeat` is whoever leads trick 1 (the
   * player left of the dealer). Mutates seat.hand / seat.tricksWon.
   */
  async runPlayPhase(seatOrder, leaderSeat, cardsDealt, trumpSuit) {
    let leader = this.roles.overrideNextLeader(leaderSeat);
    for (let trickNumber = 1; trickNumber <= cardsDealt; trickNumber++) {
      const order = this.rotateToStart(seatOrder, leader);
      const plays = [];
      let leadSuit = null;
      this.roles.noteTrickProgress(0);
      for (const seat of order) {
        this.currentTurnSeat = seat;
        this.currentLeadSuit = leadSuit;
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsDealt);
        const card = await this.waitForCardPlay(seat, leadSuit);
        this.removeCardFromHand(seat, card);
        plays.push({ seat, card });
        this.roles.noteTrickProgress(plays.length);
        if (leadSuit == null) leadSuit = card.suit;
        this.currentTurnSeat = null;
        this.broadcastTrickState(plays, leadSuit, trickNumber, cardsDealt);
      }
      this.currentTurnSeat = null;
      const winnerIndex = resolveTrickWinnerIndex(plays, leadSuit, trumpSuit);
      const winner = plays[winnerIndex].seat;
      const counted = this.roles.consumeTrickWin(winner, trickNumber);
      if (counted) winner.tricksWon += 1;
      this.io.broadcast("trickResolved", {
        plays: plays.map((p) => ({ id: p.seat.id, card: p.card })),
        winnerId: winner.id,
        trickNumber,
        totalTricks: cardsDealt,
        counted
      });
      leader = trickNumber < cardsDealt ? this.roles.overrideNextLeader(winner) : winner;
      await sleep(Config.trickResolvePause);
    }
  }
  /** Client fired `playCard`. */
  handleCardPlay(seat, card) {
    if (!this.currentTurnSeat || this.currentTurnSeat.id !== seat.id) {
      this.io.send(seat, "actionError", "It's not your turn to play.");
      return;
    }
    if (typeof card !== "object" || card == null || typeof card.suit !== "string" || typeof card.rank !== "number") {
      this.io.send(seat, "actionError", "Malformed card.");
      return;
    }
    if (!seat.hand.some((c) => isSameCard(c, card))) {
      this.io.send(seat, "actionError", "You don't have that card.");
      return;
    }
    if (!isLegalPlay(card, seat.hand, this.currentLeadSuit)) {
      this.io.send(seat, "actionError", "You must follow suit if you can.");
      return;
    }
    this.resolver?.(card);
  }
};

// src/server/engine/scoring.ts
function scoreRound(io2, roles2, seats, roundNumber) {
  roles2.prepareScoring();
  const results = [];
  for (const seat of seats) {
    const bid = seat.bid ?? 0;
    let roundScore = calculateScore(bid, seat.tricksWon, seat.hasDoubled);
    roundScore = roles2.adjustScore(seat, roundScore);
    seat.lastRoundScore = roundScore;
    seat.totalScore += roundScore;
    results.push({
      id: seat.id,
      bid,
      tricksWon: seat.tricksWon,
      doubled: seat.hasDoubled,
      roundScore,
      totalScore: seat.totalScore
    });
  }
  io2.broadcast("scoreUpdate", { roundNumber, results });
  return results;
}

// src/server/room.ts
var Room = class {
  constructor(code, server2) {
    this.code = code;
    this.server = server2;
    this.io = {
      broadcast: (event, payload) => {
        ;
        this.server.to(this.code).emit(event, payload);
      },
      send: (seat, event, payload) => {
        if (!seat.socketId) return;
        this.server.to(seat.socketId).emit(event, payload);
      }
    };
    this.roles = new RoleManager(this.io);
    this.bidding = new BiddingManager(this.io, this.roles, (text) => this.systemChat(text));
    this.tricks = new TrickManager(this.io, this.roles);
  }
  seats = [];
  seatById = /* @__PURE__ */ new Map();
  gameState = "Lobby";
  lastActivity = Date.now();
  io;
  roles;
  bidding;
  tricks;
  // Round state, kept so a reconnecting client can be handed a full snapshot.
  roundNumber = 0;
  cardsDealt = 0;
  trumpSuit = "";
  turnOrderIds = [];
  phase = "RoundStart";
  history = {};
  /** Set when the table empties mid-game so the round loop can bail out. */
  aborted = false;
  // Table talk. Kept server-side so a refresh (or a late joiner) sees the
  // recent conversation rather than an empty box.
  chatLog = [];
  nextChatId = 1;
  // ---- Roster ---------------------------------------------------------------
  get isEmpty() {
    return this.seats.every((seat) => !seat.connected);
  }
  getSeat(id) {
    return this.seatById.get(id);
  }
  /**
   * The host is whoever is in seat 1 -- the first player who joined and is
   * still seated (seat indices are kept contiguous in the lobby). Only the host
   * may start the game / pick the mode.
   */
  get host() {
    return this.seats[0];
  }
  isHost(seat) {
    return this.host?.id === seat.id;
  }
  /**
   * Seats a player, or re-attaches an existing seat when `playerId` matches one
   * that's already here (a refresh, or a drop mid-game). Returns an error
   * string when the table can't take them.
   */
  join(name, playerId, socketId) {
    this.lastActivity = Date.now();
    const existing = playerId ? this.seatById.get(playerId) : void 0;
    if (existing) {
      existing.socketId = socketId;
      existing.connected = true;
      existing.disconnectedAt = null;
      if (name.trim()) existing.name = name.trim().slice(0, 20);
      return { seat: existing };
    }
    if (this.gameState !== "Lobby") {
      return { error: "That game has already started." };
    }
    if (this.seats.length >= Config.maxPlayers) {
      return { error: `That table is full (${Config.maxPlayers} players max).` };
    }
    const seat = {
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
      disconnectedAt: null
    };
    this.seats.push(seat);
    this.seatById.set(seat.id, seat);
    return { seat };
  }
  /**
   * On disconnect: during a game the seat is KEPT (so turn order doesn't shift
   * mid-round) and marked disconnected so the phase managers auto-play for it.
   * In the lobby the chair is held for a grace period -- long enough to survive
   * a refresh, short enough that a leaver doesn't block the table forever.
   */
  detach(seat, socketId) {
    if (seat.socketId !== socketId) return;
    seat.socketId = null;
    seat.connected = false;
    seat.disconnectedAt = Date.now();
    this.lastActivity = Date.now();
    if (this.gameState === "Lobby") {
      seat.ready = false;
      this.broadcastLobby();
      setTimeout(() => {
        if (seat.connected || this.gameState !== "Lobby") return;
        this.removeSeat(seat);
        this.broadcastLobby();
      }, Config.reconnectGraceSeconds * 1e3);
    } else {
      if (this.isEmpty) this.aborted = true;
      this.bidding.onSeatDisconnected(seat);
      this.tricks.onSeatDisconnected(seat);
    }
  }
  removeSeat(seat) {
    const index = this.seats.indexOf(seat);
    if (index < 0) return;
    this.seats.splice(index, 1);
    this.seatById.delete(seat.id);
    this.seats.forEach((s, i) => {
      s.seatIndex = i + 1;
    });
  }
  // ---- Lobby ----------------------------------------------------------------
  roster() {
    const hostId = this.host?.id;
    return this.seats.map((seat) => ({
      id: seat.id,
      name: seat.name,
      ready: seat.ready,
      connected: seat.connected,
      isHost: seat.id === hostId
    }));
  }
  /** Every non-host seat must be ready (the host readies by pressing Start). */
  allGuestsReady() {
    return this.seats.slice(1).every((seat) => seat.ready);
  }
  canStart() {
    const count = this.seats.length;
    if (count < Config.minPlayers || count > Config.maxPlayers) return false;
    return this.allGuestsReady();
  }
  broadcastLobby() {
    this.io.broadcast("lobbyUpdate", {
      roomCode: this.code,
      roster: this.roster(),
      minPlayers: Config.minPlayers,
      maxPlayers: Config.maxPlayers,
      hostId: this.host?.id ?? null,
      canStart: this.canStart(),
      mode: this.roles.getMode()
    });
  }
  setReady(seat, ready) {
    if (this.gameState !== "Lobby") return;
    seat.ready = ready;
    this.broadcastLobby();
  }
  setMode(seat, mode) {
    if (this.gameState !== "Lobby") return;
    if (!this.isHost(seat)) {
      this.io.send(seat, "actionError", "Only the host can change the game mode.");
      return;
    }
    if (mode !== "classic" && mode !== "chaos") return;
    this.roles.setMode(mode);
    this.broadcastLobby();
  }
  startGame(seat) {
    if (this.gameState !== "Lobby") return;
    if (!this.isHost(seat)) {
      this.io.send(seat, "actionError", "Only the host can start the game.");
      return;
    }
    if (!this.canStart()) {
      this.io.send(seat, "actionError", "Everyone needs to ready up first.");
      return;
    }
    this.gameState = "InProgress";
    void this.runGameLoop();
  }
  // ---- Client actions -------------------------------------------------------
  submitBid(seat, bid) {
    this.lastActivity = Date.now();
    this.bidding.handleBidSubmission(seat, bid);
  }
  declareDouble(seat) {
    this.lastActivity = Date.now();
    this.bidding.handleDeclareDouble(seat);
  }
  playCard(seat, card) {
    this.lastActivity = Date.now();
    this.tricks.handleCardPlay(seat, card);
  }
  useAbility(seat, payload) {
    this.lastActivity = Date.now();
    this.roles.handleUseAbility(seat, payload);
  }
  // ---- Chat -----------------------------------------------------------------
  pushChat(message) {
    const entry = { id: this.nextChatId++, ...message };
    this.chatLog.push(entry);
    if (this.chatLog.length > 200) this.chatLog.shift();
    this.io.broadcast("chat", entry);
  }
  chat(seat, text) {
    const clean = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
    if (!clean) return;
    this.lastActivity = Date.now();
    this.pushChat({ from: seat.id, name: seat.name, text: clean });
  }
  /** A system line ("Ada joined the table"), attributed to nobody. */
  systemChat(text) {
    this.pushChat({ from: null, name: "", text });
  }
  // ---- Reconnect ------------------------------------------------------------
  /** Everything this client needs to redraw a game already in progress. */
  sendState(seat) {
    if (this.gameState === "Lobby") {
      this.broadcastLobby();
      return;
    }
    const bids = this.roles.isActive() ? this.roles.displayedBids() : Object.fromEntries(
      this.seats.filter((s) => s.bid != null).map((s) => [s.id, s.bid])
    );
    const snapshot = {
      inGame: true,
      roster: this.roster(),
      mode: this.roles.getMode(),
      roundNumber: this.roundNumber,
      cardsDealt: this.cardsDealt,
      trumpSuit: this.trumpSuit,
      turnOrder: this.turnOrderIds,
      phase: this.phase,
      bids,
      tricksWon: Object.fromEntries(this.seats.map((s) => [s.id, s.tricksWon])),
      totals: Object.fromEntries(this.seats.map((s) => [s.id, s.totalScore])),
      history: this.history,
      hand: seat.hand,
      roleState: this.roles.getRoleState(seat),
      chat: this.chatLog,
      ...this.tricks.snapshot()
    };
    this.io.send(seat, "snapshot", snapshot);
  }
  /** Replays the recent conversation onto a client that just connected. */
  sendChatHistory(seat) {
    this.io.send(seat, "chatHistory", this.chatLog);
  }
  // ---- The game loop --------------------------------------------------------
  rotateSeatsStartingAt(startIndex) {
    const n = this.seats.length;
    return this.seats.map((_, offset) => this.seats[(startIndex - 1 + offset) % n]);
  }
  async playRound(roundNumber, cardsDealt, dealerIndex) {
    for (const seat of this.seats) {
      seat.hand = [];
      seat.bid = null;
      seat.hasDoubled = false;
      seat.tricksWon = 0;
    }
    this.tricks.reset();
    const trumpSuit = trumpForRound(roundNumber);
    const startingBidderIndex = dealerIndex % this.seats.length + 1;
    const turnOrder = this.rotateSeatsStartingAt(startingBidderIndex);
    const { hands, remainder } = dealHands(turnOrder, cardsDealt);
    for (const seat of turnOrder) seat.hand = hands.get(seat.id);
    this.roundNumber = roundNumber;
    this.cardsDealt = cardsDealt;
    this.trumpSuit = trumpSuit;
    this.turnOrderIds = turnOrder.map((s) => s.id);
    this.phase = "RoundStart";
    this.io.broadcast("gameState", {
      phase: "RoundStart",
      roundNumber,
      cardsDealt,
      trumpSuit,
      dealerId: this.seats[dealerIndex - 1].id,
      turnOrder: this.turnOrderIds
    });
    for (const seat of turnOrder) {
      this.io.send(seat, "dealHand", { hand: seat.hand, roundNumber, trumpSuit });
    }
    this.roles.startRound(this.seats, cardsDealt, remainder);
    this.phase = "Bidding";
    await this.bidding.runBiddingPhase(turnOrder, cardsDealt);
    if (this.aborted) return;
    this.bidding.lockDoubles();
    this.roles.setPhase("Playing");
    this.phase = "Playing";
    this.io.broadcast("gameState", { phase: "Playing", roundNumber });
    await this.tricks.runPlayPhase(this.seats, turnOrder[0], cardsDealt, trumpSuit);
    if (this.aborted) return;
    const results = scoreRound(this.io, this.roles, this.seats, roundNumber);
    this.history[roundNumber] = Object.fromEntries(results.map((r) => [r.id, r.roundScore]));
    this.roles.endRound();
    this.io.broadcast("roundEnded", { roundNumber });
    await sleep(Config.roundEndPause);
  }
  broadcastGameEnded() {
    const standings = this.seats.map((seat) => {
      const reveal = this.roles.getRoleReveal(seat.id);
      return {
        id: seat.id,
        name: seat.name,
        totalScore: seat.totalScore,
        roleName: reveal?.roleName,
        roleEmoji: reveal?.roleEmoji
      };
    }).sort((a, b) => b.totalScore - a.totalScore);
    this.io.broadcast("gameEnded", { standings });
  }
  async runGameLoop() {
    this.aborted = false;
    this.history = {};
    for (const seat of this.seats) {
      seat.totalScore = 0;
      seat.lastRoundScore = null;
      seat.ready = false;
    }
    if (this.roles.getMode() === "chaos") this.roles.assignRoles(this.seats);
    let dealerIndex = 0;
    for (let roundNumber = 1; roundNumber <= TOTAL_ROUNDS; roundNumber++) {
      if (this.isEmpty) {
        this.aborted = true;
        break;
      }
      dealerIndex = dealerIndex % this.seats.length + 1;
      await this.playRound(roundNumber, Config.cardSequence[roundNumber - 1], dealerIndex);
      if (this.aborted) break;
    }
    if (!this.aborted) {
      this.broadcastGameEnded();
      await sleep(Config.gameEndPause);
    }
    this.roles.resetGame();
    this.tricks.reset();
    this.gameState = "Lobby";
    this.roundNumber = 0;
    this.history = {};
    for (const seat of [...this.seats]) {
      if (!seat.connected) this.removeSeat(seat);
    }
    this.broadcastLobby();
  }
};

// src/server/index.ts
var PORT = Number(process.env.PORT ?? 3001);
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var app = express();
var server = http.createServer(app);
var io = new Server(server, {
  cors: { origin: true }
});
var rooms = /* @__PURE__ */ new Map();
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newRoomCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate a room code");
}
var ROOM_TTL_MS = 2 * 60 * 60 * 1e3;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.isEmpty && now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 10 * 60 * 1e3);
io.on("connection", (socket) => {
  let room = null;
  let seatId = null;
  const withSeat = (fn) => {
    const currentRoom = room;
    const currentSeat = currentRoom && seatId ? currentRoom.getSeat(seatId) : void 0;
    if (!currentRoom || !currentSeat) return;
    fn(currentRoom, currentSeat);
  };
  socket.on("join", ({ roomCode, name, playerId }) => {
    if (room) return;
    let target;
    if (roomCode) {
      const code = String(roomCode).trim().toUpperCase();
      const existing = rooms.get(code);
      if (!existing) {
        socket.emit("joinError", `No table with the code ${code}.`);
        return;
      }
      target = existing;
    } else {
      target = new Room(newRoomCode(), io);
      rooms.set(target.code, target);
    }
    const known = playerId ? target.getSeat(String(playerId)) != null : false;
    const result = target.join(String(name ?? ""), playerId ? String(playerId) : null, socket.id);
    if ("error" in result) {
      socket.emit("joinError", result.error);
      return;
    }
    room = target;
    seatId = result.seat.id;
    void socket.join(target.code);
    socket.emit("joined", {
      playerId: result.seat.id,
      roomCode: target.code,
      name: result.seat.name
    });
    target.sendChatHistory(result.seat);
    target.systemChat(
      known ? `${result.seat.name} is back.` : `${result.seat.name} joined the table.`
    );
    target.broadcastLobby();
    if (target.gameState !== "Lobby") target.sendState(result.seat);
  });
  socket.on("toggleReady", (ready) => withSeat((r, s) => r.setReady(s, ready === true)));
  socket.on("startGame", () => withSeat((r, s) => r.startGame(s)));
  socket.on("setMode", (mode) => withSeat((r, s) => r.setMode(s, mode)));
  socket.on("submitBid", (bid) => withSeat((r, s) => r.submitBid(s, Number(bid))));
  socket.on("declareDouble", () => withSeat((r, s) => r.declareDouble(s)));
  socket.on("playCard", (card) => withSeat((r, s) => r.playCard(s, card)));
  socket.on("useAbility", (payload) => withSeat((r, s) => r.useAbility(s, payload ?? {})));
  socket.on("requestState", () => withSeat((r, s) => r.sendState(s)));
  socket.on("chat", (text) => withSeat((r, s) => r.chat(s, String(text ?? ""))));
  socket.on("disconnect", () => {
    withSeat((r, s) => {
      if (s.socketId === socket.id) r.systemChat(`${s.name} left.`);
      r.detach(s, socket.id);
    });
    room = null;
    seatId = null;
  });
});
var clientDir = path.resolve(__dirname, "../client");
app.use(express.static(clientDir));
app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
server.listen(PORT, () => {
  console.log(`The Prediction Game server listening on http://localhost:${PORT}`);
});
