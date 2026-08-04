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
   * HIGHEST / LOWEST picker, "scope" shows ONE PLAYER / EVERYONE and only
   * opens the target picker when ONE PLAYER is chosen, "role" shows the role
   * gallery, "card" shows your own hand.
   */
  extra?: 'direction' | 'suit' | 'peek' | 'scope' | 'role' | 'card'
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
    desc: 'Misdirection, and YOU choose the shape: blanket ONE player so their whole hand looks dead to them, or put one dead-looking card in EVERY other hand. The cards still play perfectly — they just look unplayable.',
    target: 'none',
    extra: 'scope',
    note: 'silent — nobody is told it was you, and nothing can block it. purely cosmetic, so all it costs them is nerve',
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
    note: 'silent — the table only finds out if someone wastes an ability on you',
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

  // ---- The Time Traveler --------------------------------------------------
  reverse_time: {
    id: 'reverse_time',
    name: 'Reverse Time',
    desc: 'Reopen a bid — your own or anyone else’s. THEY pick the new number, not you, and the usual last-bidder rule doesn’t apply to a rewrite.',
    target: 'any',
    note: 'they must have bid already. reopen your own and nothing can block it; reopen someone else’s and a Guardian’s Nullify or Bid Lock can cancel it',
  },
  rewind: {
    id: 'rewind',
    name: 'Rewind',
    desc: 'Pull the card that was JUST played back off the table. It returns to their hand and they must play something DIFFERENT. You don’t choose who — timing does.',
    target: 'none',
    note: 'play phase only, mid-trick, once per trick. a Guardian’s Nullify on whoever just played can cancel it',
  },
  alternate_universe: {
    id: 'alternate_universe',
    name: 'Alternate Universe',
    desc: 'Step sideways into another life. Name any ROLE and you’re dealt a random ability from ITS set — and this does NOT spend your turn. The new ability is the one you actually get to use.',
    target: 'none',
    extra: 'role',
    note: 'free — it replaces your ability instead of spending it. targets no one, so nothing can block it',
  },
  time_branches: {
    id: 'time_branches',
    name: 'Time Branches',
    desc: 'Rewind the deal itself: put ONE card back into the cards that were never dealt, and draw one of them at random in its place. Sight unseen — the branch you get may be worse.',
    target: 'none',
    extra: 'card',
    note: 'never mid-trick. the card you discard joins the undealt pile, where a Detective’s Fortune can read it. targets no one, so nothing can block it',
  },

  // ---- The Angel ----------------------------------------------------------
  guardian_angel: {
    id: 'guardian_angel',
    name: 'Guardian Angel',
    desc: 'Watch over another player: if they miss their bid by exactly 1 this round, they score as if they hit it.',
    target: 'other',
    note: 'resolves at end of round, and only if they actually needed it. a Guardian’s Nullify can cancel it',
  },
  intercede: {
    id: 'intercede',
    name: 'Intercede',
    desc: 'Step in front of another player: the next ability aimed at THEM this round fizzles into nothing.',
    target: 'other',
    note: 'one-time shield, given away. a Guardian’s Nullify can cancel it',
  },
  halo: {
    id: 'halo',
    name: 'Halo',
    desc: 'Hold a player up: their round score can’t go below zero this round, however badly it goes for them.',
    target: 'other',
    note: 'resolves at end of round. a Guardian’s Nullify can cancel it',
  },
  sacrifice: {
    id: 'sacrifice',
    name: 'Sacrifice',
    desc: 'Give another player 10 of your own points, no strings, no conditions. It always lands, and it always costs you.',
    target: 'other',
    note: 'resolves at end of round. a Guardian’s Nullify can cancel it',
  },

  // ---- The Mirrorer (rare) ------------------------------------------------
  mirror_bet: {
    id: 'mirror_bet',
    name: 'Mirror Bet',
    desc: 'Secretly bet on another player. At scoring: +3 for every trick they won, -1 for every trick they didn’t.',
    target: 'other',
    note: 'bidding phase only — bet before the first card falls. a Guardian’s Nullify stops the bet for THAT ROUND only; you get a fresh one next deal',
  },
  mimic: {
    id: 'mimic',
    name: 'Mimic',
    desc: 'Name anyone and reflect them: whatever ability they were dealt this round becomes yours too. They keep theirs, and using this doesn’t cost you your turn — you still get to fire the ability you just copied.',
    target: 'other',
    note: 'you’re picking blind — you find out what they hold as you take it. a Guardian’s Nullify can cancel it',
  },
  twin_fate: {
    id: 'twin_fate',
    name: 'Twin Fate',
    desc: 'Tie your round to another player’s. At scoring you BOTH take whichever of your two rounds went better — if either of you wins, you both win. Pick someone about to have a very good round.',
    target: 'other',
    note: 'resolves at end of round, after everything else has landed. it lifts them too. a Guardian’s Nullify can cancel it',
  },
  two_way_mirror: {
    id: 'two_way_mirror',
    name: 'Two-Way Mirror',
    desc: 'Put the glass between you and another player: at scoring your two round scores trade places. Their round becomes yours, and yours becomes theirs.',
    target: 'other',
    note: 'resolves at end of round, after everything else has landed — read the table wrong and you hand away a good round. a Guardian’s Nullify can cancel it',
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
  time_traveler: {
    id: 'time_traveler',
    name: 'The Time Traveler',
    emoji: '⏳',
    tagline: 'None of this is final.',
    blurb:
      'The undo role. Nothing that has already happened has to stay happened: reopen a bid, pull a played card back off the table, or rewind the deal itself and trade a card for one that was never dealt. And when your own ability is the wrong one, step into a universe where you drew a different role entirely.',
    color: '#5FD3C0',
    abilities: ['reverse_time', 'rewind', 'alternate_universe', 'time_branches'],
  },
  angel: {
    id: 'angel',
    name: 'The Angel',
    emoji: '😇',
    tagline: 'After you.',
    blurb:
      'The selfless role. Every ability you have spends itself on somebody ELSE — a save, a shield, a floor under their score, even a handful of your own points. Nothing here helps you win directly. They say kindness has a way of coming back around.',
    color: '#F2E3A6',
    abilities: ['guardian_angel', 'intercede', 'halo', 'sacrifice'],
  },
  mirrorer: {
    id: 'mirrorer',
    name: 'The Mirrorer',
    emoji: '🪞',
    tagline: 'Your fate is my fate.',
    blurb:
      'RARE. The reflection role, and it never plays its own game — it plays yours. Ride another player’s tricks, copy the ability they were dealt, tie your round to theirs so a win for either is a win for both, or trade rounds with them outright. Every single thing it does is pointed at somebody else’s game.',
    color: '#B2D2E0',
    abilities: ['mirror_bet', 'mimic', 'twin_fate', 'two_way_mirror'],
    rare: true,
  },
}

/** Stable order for the lobby gallery. */
export const roleOrder = [
  'detective',
  'joker',
  'gambler',
  'judge',
  'guardian',
  'time_traveler',
  'angel',
  'mirrorer',
]

/**
 * The non-rare roles RoleManager deals from by default. Its LENGTH is the
 * table's duplicate-free capacity: assignRoles deals round-robin, so any table
 * with this many seats or fewer gets all-distinct roles, and only a table
 * bigger than the pool sees a role repeat.
 */
export const standardRoleOrder = [
  'detective',
  'joker',
  'gambler',
  'judge',
  'guardian',
  'time_traveler',
  'angel',
]

export function getRole(roleId: string | null | undefined): RoleDef | null {
  if (!roleId) return null
  return roles[roleId] ?? null
}

export function getAbility(abilityId: string | null | undefined): AbilityDef | null {
  if (!abilityId) return null
  return abilities[abilityId] ?? null
}
