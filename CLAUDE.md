# The Prediction Game — project context

🎴 A multiplayer trick-taking card game. Players predict exactly how many
tricks they'll win each round, then play them out. Hit the prediction, score
big; miss, and the score drops.

Node + Socket.IO server, React + Vite client, one `src/shared/` folder imported
by both. See README.md for the player-facing rules.

## Workflow

- `npm run dev` runs both halves (server on :3001, Vite on :5173 proxying the
  socket). `npm run build && npm start` is the production shape: one process
  serving the built client and the socket from the same origin.
- `npm run typecheck` before committing. There is no linter configured.
- **Verify rules changes with `node scripts/playtest.mjs <classic|chaos> <n>`.**
  It drives N bot clients through a full game against a running server and
  prints the standings plus every rule rejection. A 10-player game takes ~10
  minutes of wall clock, most of it the 5s post-bid Double window.
- To play against bots in a browser: open a table, then
  `node scripts/joinbots.mjs <CODE> 3`.
- Commit after each accepted chunk of work (user expects it).

## Architecture

Server-authoritative; the client is render-only. Nothing affecting scoring or
legality is decided in the browser.

- `src/shared/` — imported by BOTH sides. `config.ts` (tunables), `cards.ts`
  (trick resolution, follow-suit legality), `scoring.ts`, `roleDefs.ts` (chaos
  data), `protocol.ts` (the Socket.IO event map — the single source of truth
  for every message).
- `src/server/room.ts` — one table: roster, lobby, and the round loop. Every
  table is a Socket.IO room keyed by its 4-letter code, and ALL state is
  instance state, because one process hosts many tables.
- `src/server/engine/` — `bidding.ts`, `tricks.ts`, `scoring.ts`, `roles.ts`,
  `deck.ts`. Phase managers talk to clients only through the narrow `EngineIO`
  interface in `io.ts`.
- `src/client/useGame.ts` — all display state; a reducer fed by socket events.
- `src/client/components/` — one per panel. `styles/tokens.css` is the design
  system: every color, font and radius comes from there, so restyling the whole
  game means editing those tokens.

**Blocking phases are async.** `runBiddingPhase` / `runPlayPhase` await a
promise that the socket handler resolves when the player acts. A seat that
disconnects resolves it with an auto-play instead, so a round can never hang on
an empty chair.

## Rules as implemented

- 2–10 players; card sequence 5,4,3,2,1,1,2,3,4,5; trump rotates
  Spades→Diamonds→Clubs→Hearts→NoTrump. (10×5 = 50 ≤ 52, so the deal always
  fits a standard deck.)
- Last bidder can't make bids sum to the trick count; exact bid → 10+bid,
  miss → −|diff|.
- **Double**: offered only in a 5s window right after you bid, before the next
  player bids. One click, FINAL. Hit doubled → 2×(10+bid); MISS doubled →
  −(10+bid) flat, regardless of how far off (not −2×diff).
- **No turn timers, ever** (explicit user requirement — never skip a turn on
  time). Auto-play only for disconnected seats. The 5s Double window is the one
  timer, and it only closes an optional side bet.
- Host = first joiner: guests ready up, the host has the only START button. No
  auto-start countdown.

## Chaos mode

Host toggles classic/chaos on a lobby card. All role logic lives in
`server/engine/roles.ts` + `shared/roleDefs.ts` (data) + `client/components/
RolePanel.tsx`, gated behind the mode so the classic path is untouched.

- **EVERY seat gets a role**, dealt round-robin from a shuffled pool, so past
  the pool size roles repeat. 5 standard roles (Detective/Joker/Gambler/Judge/
  Guardian) + RARE Mirrorer, which only joins the pool 20% of games.
- **Duplicate role holders are supported and must stay that way.** Every
  per-player effect is keyed by player id. The two effects keyed by TARGET must
  ACCUMULATE, never overwrite: `armedSabotageBy` is a LIST of saboteurs per
  target and `armedGravekeeper` is a COUNT. `disguisedBids` is deliberately
  last-write-wins — a bid can only display one number.
- One ability per round, use-it-or-lose-it (two-target abilities never dealt
  with <3 seats). All options start equally likely, but the ability you were
  just dealt is weighted `0.4^streak` against 1.0 for the rest.
- Conflict order: Nullify beats all targeted abilities, Bid Lock beats bid
  tampering. Sabotage cuts both ways: mark hits their bid → −10 them, mark
  misses → −5 the Judge (resolved in `prepareScoring`, called before the
  per-seat loop because the penalty lands on a different seat).
- ALL FOUR Joker swaps only land 75% of the time (`SWAP_SUCCESS`). Two
  different failure paths, deliberately NOT the same:
  - **Fizzle** (losing the 75% roll) → announced publicly, ability spent
    immediately, turn over.
  - **Blocked** (Nullify / Bid Lock) → `retryAfterBlock` grants one more
    attempt at a **fresh** target; `MAX_SWAP_TRIES` (2) makes the second
    attempt final. The fresh-target rule is waived once the table runs out of
    untried players so it can't strand the ability.
- Big Swap is additionally once per game and only while (tied-)lowest score —
  its `handSwapUsed` gate is only set when the sequence actually ends, so a
  blocked retry keeps it. Gambler's All In is a true 50/50 with a pity floor:
  3 losses in a row forces the next win.
- Every ability's `note` states whether a Guardian can cancel it — keep that
  accurate when adding or changing abilities. Announcements name the role,
  never the player; roles are revealed on the final standings.

## UI conventions (user-driven, keep these)

- Dark "paper note" theme, slight card rotations, no ruled lines. Fonts:
  Bangers (titles) / Fredoka (headings) / Nunito (body) / a serif for card
  indices.
- **Card faces are Kenney's CC0 pixel-art deck** in `src/client/public/cards/`
  (~22KB for all 55), cropped to the artwork so each sprite IS the card. They
  render as `<img class="card__face">` with `image-rendering: pixelated` — the
  upscale is deliberate, so never "fix" it with smoothing. `--card-h` is pinned
  to the sprites' 60/42 ratio; changing it stretches the art. Everything AROUND
  the face (radius, shadow, winner/playable rings, muted + illusion veils) is
  still CSS on the `.card` wrapper, and everything scales off `--card-w`.
  (This replaced an earlier all-CSS deck — no pip layouts or court panels now.)
- Chat is for what PLAYERS say. Game events (doubling, ability announcements)
  go to the floating feed via `roleAnnounce`, never `systemChat`. Only presence
  lines — joined / left / watching / took a seat — belong in chat.
- Score sheet docked LEFT (row per round + trump icon, column per player,
  totals bar), open by default on desktop, on demand on touch; Tab or the
  SCORES button toggles it.
- Top bar: trump glyph, Round X/Y, Hand K/M, per-player "won / bid" chips
  (green on-target / red off, accent ring = turn).
- Bidding = centered modal, circular bid chips, forbidden bid crossed out,
  DOUBLE DOWN pill. Trick area: display name above each card, crown + green
  ring on winner, losers veiled.
- One canonical player order everywhere (top bar, score sheet, bid pills,
  target pickers), locked at round 1.

## Web specifics

- Tables have 4-letter codes (no I/O/1/0); `/ABCD` is a working invite link.
- The seat token lives in `localStorage`: a refresh mid-round re-attaches to
  the same chair. The client re-emits `join` on socket reconnect — without
  that the player is orphaned and the server auto-plays their hand.
- `Room.detach` ignores a disconnect whose socket id no longer matches the
  seat, because a reconnect can land before the old socket's disconnect event.
- **Joining a table mid-game makes you a SPECTATOR, not an error.** Spectators
  hold no `Seat` — just a `Spectator` in the Socket.IO room, so every broadcast
  reaches them while `withSeat` silently drops every gameplay event they could
  send. They get a snapshot with no hand and no role, can chat, and are turned
  into real seats by `seatSpectators()` when the game loop returns to the lobby.
- All state is in memory. Restarting the server drops tables in progress.

## Deployment

Fly.io, via `Dockerfile` + `fly.toml`. **Pushing to `main` auto-deploys** via
`.github/workflows/fly-deploy.yml` (uses the `FLY_API_TOKEN` repo secret); `fly
deploy --ha=false` from the repo root does the same thing by hand. The
Dockerfile multi-stage builds (`npm run build`) then runs `node
dist/server/index.js`, the same always-on Node process that serves the built
client AND the socket from one origin, so there is nothing to proxy and no
separate static host.

**`fly.toml` pins `auto_stop_machines = false` and `min_machines_running = 1`
on purpose — do not change either.** Tables live in one process's memory:
autostop would drop every game in progress the moment traffic goes quiet, and
more than one machine would strand half the players at a table the other
machine can't see. For the same reason a redeploy drops games in progress —
ship between rounds.

**Machine count must stay at 1, not just the floor.** `fly deploy`/`fly
launch` default to 2 machines for HA regardless of `min_machines_running` (that
setting is only the autoscale floor, not a cap). Always deploy with `fly
deploy --ha=false`; if a deploy ever leaves 2 machines running, `fly scale
count 1` fixes it.

Static hosts (Firebase Hosting, Netlify, Pages) CANNOT host this: a catch-all
rewrite swallows `/socket.io/**` and the socket never connects, which looks
exactly like players being kicked the moment they join.
