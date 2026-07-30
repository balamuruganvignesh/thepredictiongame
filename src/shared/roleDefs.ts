// Chaos-mode role and ability definitions, shared by server (validation and
// execution) and client (lobby gallery + in-game role panel). Pure data --
// all behavior lives in server/engine/roles.ts.
//
// Every round each player is dealt ONE of their role's abilities at random
// (use it or lose it -- it expires at scoring).

export type AbilityTarget = 'none' | 'other' | 'two' | 'any'

export type AbilityDef = {
  id: string
  name: string
  desc: string
  /**
   * Who the ability aims at. "any" includes YOURSELF -- the picker lists the
   * whole table and self-targeting is legal (nothing can defend against it).
   */
  target: AbilityTarget
  /**
   * Extra input the ability needs beyond a target: "direction" shows a
   * +1 / -1 picker, "suit" shows a ♠ ♦ ♣ ♥ picker, "peek" shows a
   * HIGHEST / LOWEST picker.
   */
  extra?: 'direction' | 'suit' | 'peek'
  /** Short usability note surfaced in the UI ("play phase only" etc.). */
  note?: string
}

export type RoleDef = {
  id: string
  name: string
  emoji: string
  tagline: string
  blurb: string
  color: string
  abilities: string[]
  /**
   * Rare roles are excluded from the normal assignment pool; RoleManager rolls
   * them in with a small per-game chance. A role with a single ability keeps
   * that ability every round (no per-round reroll).
   */
  rare?: boolean
}

export const abilities: Record<string, AbilityDef> = {
  // ---- The Detective ------------------------------------------------------
  read_table: {
    id: 'read_table',
    name: 'Read the Table',
    desc: 'Call it — HIGHEST or LOWEST — then secretly read that card in every other player’s hand. One card each, the whole table at once.',
    target: 'none',
    extra: 'peek',
    note: 'private — nobody is told. targets no one, so nothing can block it',
  },
  illusion: {
    id: 'illusion',
    name: 'Illusion',
    desc: 'Misdirection. Either ONE player sees their whole hand greyed out, or EVERY player sees one card greyed. The cards still play perfectly — they just look dead.',
    target: 'none',
    note: 'silent — nobody is told it was you. purely cosmetic, so all it costs them is nerve',
  },
  fortune: {
    id: 'fortune',
    name: 'Fortune',
    desc: 'Name a suit and secretly see its two HIGHEST undealt cards — the top cards nobody at this table is holding. Name trump to find out whether the Ace is even in play.',
    target: 'none',
    extra: 'suit',
    note: 'private — nobody is told. targets no one, so nothing can block it',
  },
  set_pace: {
    id: 'set_pace',
    name: 'Set the Pace',
    desc: 'Name ANYONE to open the next trick. Take it yourself to choose the suit — or force it onto a player who was hiding, and secretly read their ENTIRE hand as you do it.',
    target: 'any',
    note: 'the lead change is public — it may give you away. aim it at yourself and nothing can block it; aim it at someone else and a Guardian’s Nullify can cancel it',
  },

  // ---- The Joker ----------------------------------------------------------
  hand_swap: {
    id: 'hand_swap',
    name: 'The Big Swap',
    desc: 'Swap your ENTIRE hand with another player’s. Lands 75% of the time, and a failed roll spends it.',
    target: 'other',
    note: 'once per game — only while you’re lowest on the scoreboard, never mid-trick. if a Guardian BLOCKS it you get one more try, at someone new',
  },
  card_theft: {
    id: 'card_theft',
    name: 'Sticky Fingers',
    desc: 'Trade one random card from your hand for one random card of another player’s. Lands 75% of the time, and a failed roll spends it.',
    target: 'other',
    note: 'never mid-trick. if a Guardian BLOCKS it you get one more try, at someone new',
  },
  bid_chaos: {
    id: 'bid_chaos',
    name: 'Bid Chaos',
    desc: 'Swap two OTHER players’ bids. Their real bids — scoring follows. Lands 75% of the time, and a failed roll spends it.',
    target: 'two',
    note: 'play phase only. if a Guardian’s Nullify or Bid Lock BLOCKS it you get one more try, at someone new',
  },
  fate_swap: {
    id: 'fate_swap',
    name: 'Fate Swap',
    desc: 'Swap YOUR bid with another player’s bid. Lands 75% of the time, and a failed roll spends it.',
    target: 'other',
    note: 'play phase only. if a Guardian’s Nullify or Bid Lock BLOCKS it you get one more try, at someone new',
  },

  // ---- The Gambler --------------------------------------------------------
  raise_stakes: {
    id: 'raise_stakes',
    name: 'Raise the Stakes',
    desc: 'Raise your own bid by 1. Hit the new bid exactly for a +10 bonus.',
    target: 'none',
    note: 'play phase only. targets no one, so nothing can block it',
  },
  all_in: {
    id: 'all_in',
    name: 'All In',
    desc: 'Coin flip at scoring: +15 points… or -15 points. A true 50/50 — and lose 3 flips in a row and the next one is guaranteed to land.',
    target: 'none',
    note: 'resolves at end of round. targets no one, so nothing can block it',
  },
  last_chance: {
    id: 'last_chance',
    name: 'Last Chance',
    desc: 'If you miss your bid by exactly 1: coin flip — score as if you hit it, or double the penalty.',
    target: 'none',
    note: 'resolves at end of round. targets no one, so nothing can block it',
  },
  crown: {
    id: 'crown',
    name: 'Claim the Crown',
    desc: 'Declare for the crown: if you win the FIRST trick this round, +10 points.',
    target: 'none',
    note: 'declare before the first trick ends. targets no one, so nothing can block it',
  },

  // ---- The Judge ----------------------------------------------------------
  verdict: {
    id: 'verdict',
    name: 'Verdict',
    desc: 'Change another player’s bid by +1 or -1. Their REAL bid — it counts at scoring.',
    target: 'other',
    extra: 'direction',
    note: 'play phase only. a Guardian’s Nullify or Bid Lock can cancel it',
  },
  sabotage: {
    id: 'sabotage',
    name: 'Sabotage',
    desc: 'Mark a player: if they hit their bid exactly, they lose 10 points. But if they MISS, the sabotage backfires and YOU lose 5.',
    target: 'other',
    note: 'resolves at end of round — risky. a Guardian’s Nullify can cancel it',
  },
  magnet: {
    id: 'magnet',
    name: 'Trick Magnet',
    desc: 'Steal one trick another player has already won. It becomes yours.',
    target: 'other',
    note: 'play phase only, target must have won a trick. a Guardian’s Nullify can cancel it',
  },
  imposter: {
    id: 'imposter',
    name: 'Imposter',
    desc: 'Disguise a bid — YOUR OWN or anyone else’s. The table sees a FALSE number until scoring. Use it while bidding is still going and everyone after you bids against a lie.',
    target: 'any',
    note: 'usable during bidding or play, on a bid that’s been placed. hide your own and nothing can block it; aim it at someone else and a Guardian’s Nullify or Bid Lock can cancel it',
  },

  // ---- The Guardian -------------------------------------------------------
  shield: {
    id: 'shield',
    name: 'Shield',
    desc: 'If you miss your bid by exactly 1 this round, score as if you hit it.',
    target: 'none',
    note: 'resolves at end of round',
  },
  lock: {
    id: 'lock',
    name: 'Bid Lock',
    desc: 'Your bid can’t be changed, swapped, or disguised for the rest of the round.',
    target: 'none',
    note: 'protects your bid',
  },
  nullify: {
    id: 'nullify',
    name: 'Nullify',
    desc: 'The next ability aimed at you this round fizzles into nothing.',
    target: 'none',
    note: 'one-time reactive shield',
  },
  gravekeeper: {
    id: 'gravekeeper',
    name: 'Gravekeeper',
    desc: 'Curse a player: the next trick they win this round doesn’t count.',
    target: 'other',
    note: 'triggers on their next trick win. a Guardian’s Nullify can cancel it',
  },

  // ---- The Mirrorer (rare) ------------------------------------------------
  mirror_bet: {
    id: 'mirror_bet',
    name: 'Mirror Bet',
    desc: 'Secretly bet on another player. At scoring: +3 for every trick they won, -1 for every trick they didn’t.',
    target: 'other',
    note: 'bidding phase only — bet before the first card falls. a Guardian’s Nullify stops the bet for THAT ROUND only; you get a fresh one next deal',
  },
}

export const roles: Record<string, RoleDef> = {
  detective: {
    id: 'detective',
    name: 'The Detective',
    emoji: '🕵️',
    tagline: 'Knowledge is power.',
    blurb:
      'The information role. Read the whole table a card at a time, or name a suit and see what never got dealt — then bid like a prophet. When knowing isn’t enough, cast an Illusion to rattle them, or Set the Pace to decide who opens the next trick.',
    color: '#66BEFF',
    abilities: ['read_table', 'illusion', 'fortune', 'set_pace'],
  },
  joker: {
    id: 'joker',
    name: 'The Joker',
    emoji: '🃏',
    tagline: 'Chaos favors the bold.',
    blurb:
      'The chaos role. Swap cards, hands, and bids — but every swap only lands 75% of the time, and a failed roll is gone. Get BLOCKED by a Guardian, though, and you get one more go at a different player. Strongest from the BOTTOM of the scoreboard.',
    color: '#C47EF0',
    abilities: ['hand_swap', 'card_theft', 'bid_chaos', 'fate_swap'],
  },
  gambler: {
    id: 'gambler',
    name: 'The Gambler',
    emoji: '🎲',
    tagline: 'Fortune favors… someone.',
    blurb:
      'High risk, high reward. Raise your own stakes and flip coins with fate. For players who KNOW they’ve got this.',
    color: '#FFB052',
    abilities: ['raise_stakes', 'all_in', 'last_chance', 'crown'],
  },
  judge: {
    id: 'judge',
    name: 'The Judge',
    emoji: '⚖️',
    tagline: 'Your bid is what I say it is.',
    blurb:
      'The interference role. Bend other players’ bids, steal their tricks, and poison their information.',
    color: '#E96E6E',
    abilities: ['verdict', 'sabotage', 'magnet', 'imposter'],
  },
  guardian: {
    id: 'guardian',
    name: 'The Guardian',
    emoji: '🛡️',
    tagline: 'Not today.',
    blurb:
      'The defensive role. Nullify cancels ANY ability aimed at you — a swap, a verdict, a curse, a Detective forcing you into the lead, even a Mirrorer’s bet — for that round. Bid Lock shuts down bid tampering on top of that.',
    color: '#7ADE8E',
    abilities: ['shield', 'lock', 'nullify', 'gravekeeper'],
  },
  mirrorer: {
    id: 'mirrorer',
    name: 'The Mirrorer',
    emoji: '🪞',
    tagline: 'Your fate is my fate.',
    blurb:
      'RARE. One permanent ability, every round: bet on a player and ride their tricks — their wins pay you, their losses cost you. A Guardian’s Nullify can stop a bet cold, but only for that round — the next deal hands you the ability back.',
    color: '#B2D2E0',
    abilities: ['mirror_bet'],
    rare: true,
  },
}

/** Stable order for the lobby gallery. */
export const roleOrder = ['detective', 'joker', 'gambler', 'judge', 'guardian', 'mirrorer']

/** The non-rare roles RoleManager deals from by default. */
export const standardRoleOrder = ['detective', 'joker', 'gambler', 'judge', 'guardian']

export function getRole(roleId: string | null | undefined): RoleDef | null {
  if (!roleId) return null
  return roles[roleId] ?? null
}

export function getAbility(abilityId: string | null | undefined): AbilityDef | null {
  if (!abilityId) return null
  return abilities[abilityId] ?? null
}
