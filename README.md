# The Prediction Game

🎴 A multiplayer trick-taking card game where strategy beats luck. Predict
exactly how many tricks you'll win each round, then play them out. Hit your
prediction and you score big. Miss and your score drops.

2–10 players, in the browser, no accounts. Open a table, share the 4-letter
code, deal.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173. Vite serves the client on `:5173` and proxies the
socket to the game server on `:3001`, so the browser only ever talks to one
origin.

For a production-shaped run (one process serving both):

```bash
npm run build && npm start
```

…then open http://localhost:3001.

### Playing solo while developing

Open a table in the browser, note the 4-letter code, then fill it with bots:

```bash
node scripts/joinbots.mjs ABCD 3
```

To exercise the rules end-to-end with no browser at all:

```bash
node scripts/playtest.mjs chaos 4
```

That drives four bot clients through a whole game and prints the final
standings plus every rule rejection the server sent back.

## How to play

Each round you bid how many tricks you think you'll win, from 0 up to the
number of cards you were dealt. Once everyone has bid, play out the hand:
follow suit if you can, play trump or discard if you can't. Highest trump wins
the trick; with no trump played, the highest card of the led suit wins.

**Hit your bid exactly and you score `10 + bid`. Miss it and you lose the
difference.** Bidding 3 and winning 3 pays 13; bidding 3 and winning 1 costs 2.

- **10 rounds**, dealing 5-4-3-2-1-1-2-3-4-5 cards.
- **Trump rotates** every round: ♠ → ♦ → ♣ → ♥ → no trump.
- **The last bidder is squeezed**: they can't make the bids add up to the
  number of tricks, so somebody always misses.
- **Double**: right after you bid you get 5 seconds to double your stake. Hit
  it and you score `2 × (10 + bid)`. Miss it and you lose `10 + bid` flat, no
  matter how far off you were. One click, and it's final.
- **No turn timers, ever.** Nobody is ever skipped for thinking too long. The
  server only plays for a seat that has actually disconnected. That 5-second
  Double window is the one clock in the game, and all it closes is an optional
  side bet.

The first player at a table is the host: everyone else readies up, the host
picks the mode and starts. No auto-start countdown.

## Chaos mode

The host can flip a table from classic to chaos. Every seat is dealt a secret
role, and each round that role deals you **one** of its abilities at random —
use it or lose it.

| Role | | What it does |
| --- | --- | --- |
| The Peeker | 🔍 | Peek at hands, bids and the deck. Or seize the lead outright. |
| The Joker | 🃏 | Swap cards, hands and bids — but only 60% of swaps land. |
| The Gambler | 🎲 | Raise your own stakes and flip coins with fate. |
| The Judge | ⚖️ | Bend other players' bids, steal their tricks, disguise the truth. |
| The Guardian | 🛡️ | Nullify anything aimed at you; lock your bid against meddling. |
| The Mirrorer | 🪞 | **Rare.** Bet on another player and ride their tricks. |

Announcements name the *role*, never the player — working out who holds what is
half the game. Roles are revealed on the final standings.

Two design details that are load-bearing:

- **Duplicate role holders are supported and must stay that way.** Roles are
  dealt round-robin from a shuffled pool, so past the pool size they repeat.
  Every per-player effect is keyed by player id. The two effects keyed by
  *target* accumulate rather than overwrite: `armedSabotageBy` is a list (each
  Judge collects separately) and `armedGravekeeper` is a count (two curses void
  two tricks).
- **Blocked ≠ fizzled.** A Joker swap that loses its 60% roll is spent then and
  there. A swap *blocked* by a Guardian grants one more attempt at a fresh
  target, capped at two tries.

Every ability's note says whether a Guardian can cancel it. Keep that accurate
when adding or changing one.

## Architecture

Server-authoritative; the client is render-only. Nothing that affects scoring
or legality is decided in the browser.

```
src/
  shared/     imported by BOTH sides — config, card rules, scoring, role data,
              and protocol.ts, which is the Socket.IO event map
  server/
    room.ts   one table: roster, lobby, the round loop
    engine/   bidding, tricks, scoring, roles, deck
  client/
    useGame.ts    all display state; translates socket events into it
    components/   one per panel
    styles/       tokens.css is the design system — restyle from there
```

Each table is a Socket.IO room keyed by its 4-letter code, so one process hosts
many games at once. Blocking phases (`runBiddingPhase`, `runPlayPhase`) are
`async` and await a promise the socket handler resolves.

Your seat is remembered in `localStorage`, so a refresh mid-round puts you back
in the same chair rather than at a new one.

### The cards

Drawn entirely in CSS — no image assets to load or license. A white rounded face
with a hairline edge, a rank-over-suit index top-left mirrored upside-down
bottom-right, traditional pip arrangements for 2–10, one big pip for the Ace,
and a framed court panel for J/Q/K. Everything scales off one custom property:

```css
--card-w: clamp(52px, 6.2vw, 82px);
```

## Deploying

The game needs a persistent process for WebSockets, so serverless won't host it.
Anything that runs a long-lived Node process works — Fly.io, Railway, Render:

```bash
npm run build
PORT=8080 npm start
```

`npm start` serves the built client and the socket from the same origin, so no
CORS or proxy configuration is needed in production.

State is entirely in memory: restarting the server drops every table in
progress. That's a deliberate trade for a party game — no database, no accounts,
nothing to clean up — but it does mean deploys should wait for tables to empty.

## Known gaps

- Bidding at a full table is slow: the 5-second Double window is offered to
  every bidder in turn, so a 10-player round spends ~50s there. Shortening
  `doubleWindowSeconds` in `src/shared/config.ts` is the lever.
- No spectators — a game in progress can't be joined, only rejoined.
- No persistence, so no cross-session stats or leaderboards.

## Origins

This started life as a Roblox game (published there as *The Prediction Game* —
the name *Judgement* failed moderation). This is a from-scratch web port of it:
same rules, same look, same chaos mode, rebuilt on Node and React. The two
codebases share nothing — Luau and TypeScript can't — so the file layout here
deliberately mirrors the Roblox one to keep future rule changes symmetrical.
