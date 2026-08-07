# The Prediction Game — project context

🎴 A multiplayer trick-taking card game. Players predict exactly how many
tricks they'll win each round, then play them out. Hit the prediction, score
big; miss, and the score drops.

**Three games live here.** The landing screen picks which game a NEW table
opens on (carried on the `join` payload, applied by `Room.openOn` — only valid
before anyone is seated), and a lobby card lets the host switch it afterwards
between The Prediction Game, **Hearts**, and **Golf** — see the Hearts and
Golf sections below. They share the table (roster, codes, chat, spectators,
reconnect) and nothing else; the round loop forks once, in `Room.runGameLoop`.

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
- `node scripts/spectate-test.mjs` (~25s) asserts that neither a spectator
  joining nor a player reconnecting knocks the table out of a running game.
  Run it after touching join / reconnect / lobby broadcasting.
- `node scripts/restart-vote-test.mjs` (~25s) drives a mid-game restart vote:
  the tally reaching everyone, a majority dropping the table back to the lobby
  WITHOUT standings, and the spectator being seated. Run it after touching the
  vote, `Room.abandonGame`, or any phase manager's `cancel()`.
- **In-process tests, no server needed, all under a second — prefer these to a
  playtest when the change is to chaos mode.** A playtest only exercises the
  roles the deal happened to hand out (a 6-player game doesn't contain all 7),
  so it can pass while a whole role is untouched.
  - `npx tsx scripts/roles-test.ts` — role assignment: no duplicates while the
    table fits the pool, every role still gets dealt, and a player rarely draws
    the same role in back-to-back games at that table (measured against a
    control that has no history — rarer than chance, never impossible).
  - `npx tsx scripts/abilities-test.ts` — the Time Traveler's and Angel's
    abilities, by re-rolling the deal until the seat holds the exact ability.
  - `npx tsx scripts/rewind-test.ts` — Rewind unwinding the live play loop.
  - `npx tsx scripts/hearts-test.ts` — every Hearts rule that is pure: the deck
    trim per table size, the forced opening club, the legality matrix, moon
    scoring, the passing cycle.
  - `npx tsx scripts/golf-test.ts` — every Golf rule that is pure: card values
    (including the Joker's -2 and a lone King's 0), column-match cancellation,
    a worked-example grid score.
- **Hearts end-to-end: `npx tsx scripts/hearts-playtest.ts <n> <target>`** (~1–3
  min). TypeScript rather than `.mjs` on purpose — the bots pick cards with the
  same shared `isLegalHeartsPlay` the browser uses, so **any rejection means the
  client and server disagree and a real round would hang**. Zero rejections is
  the pass condition.
- **Golf end-to-end: `npx tsx scripts/golf-playtest.ts <n>`** (~1–2 min for a
  full 9-hole game). Same TypeScript-on-purpose reasoning as Hearts' playtest,
  and the same zero-rejections pass condition.
- All socket-driven scripts take `PORT=` to hit a second server instance when
  :3001 is busy with a dev server you'd rather not disturb.
- Commit after each accepted chunk of work (user expects it).

## Architecture

Server-authoritative; the client is render-only. Nothing affecting scoring or
legality is decided in the browser.

- `src/shared/` — imported by BOTH sides. `config.ts` (tunables, incl.
  `HeartsConfig`), `cards.ts` (trick resolution, follow-suit legality),
  `scoring.ts`, `roleDefs.ts` (chaos data), `heartsRules.ts` (every pure Hearts
  rule), `protocol.ts` (the Socket.IO event map — the single source of truth
  for every message).
- `src/server/room.ts` — one table: roster, lobby, and the round loop. Every
  table is a Socket.IO room keyed by its 4-letter code, and ALL state is
  instance state, because one process hosts many tables.
- `src/server/engine/` — `bidding.ts`, `tricks.ts`, `scoring.ts`, `roles.ts`,
  `deck.ts`, plus `hearts/` (`deck.ts`, `passing.ts`, `play.ts`, `scoring.ts`)
  and `golf/` (`deck.ts`, `reveal.ts`, `turns.ts`, `scoring.ts`). Phase
  managers talk to clients only through the narrow `EngineIO` interface in
  `io.ts` — which is what lets all three games share one Room.
- `src/client/useGame.ts` — all display state; a reducer fed by socket events.
- `src/client/components/` — one per panel. `styles/tokens.css` is the design
  system: every color, font and radius comes from there, so restyling the whole
  game means editing those tokens.

**Blocking phases are async.** `runBiddingPhase` / `runPlayPhase` await a
promise that the socket handler resolves when the player acts. A seat that
disconnects resolves it with an auto-play instead, so a round can never hang on
an empty chair.

## Rules as implemented (The Prediction Game)

- 2–10 players; card sequence 5,4,3,2,1,1,2,3,4,5; trump rotates
  Spades→Diamonds→Clubs→Hearts→NoTrump. (10×5 = 50 ≤ 52, so the deal always
  fits a standard deck.)
- Last bidder can't make bids sum to the trick count; exact bid → 10+bid,
  miss → −|diff|.
- **Never derive the last-bidder constraint from the displayed bids.** In chaos
  a Judge's Imposter disguises them, so the client is handed a separate
  `bidSum` (the TRUE total) and must use only that. Summing the displayed map
  forbids the wrong chip, the server then rejects the bid the UI allowed, and
  because there are no turn timers the round hangs there forever.
- **Double**: offered only in a 5s window right after you bid, before the next
  player bids. One click, FINAL. Hit doubled → 2×(10+bid); MISS doubled →
  −(10+bid) flat, regardless of how far off (not −2×diff). **Doubling is
  SILENT** — no chat line, no feed card. It only surfaces in the ScoreUpdate at
  the end of the round. Don't re-add an announcement: it printed the real bid,
  which spammed the table and handed away a Judge's Imposter disguise.
- **No turn timers, ever** (explicit user requirement — never skip a turn on
  time). Auto-play only for disconnected seats. The 5s Double window is the one
  timer, and it only closes an optional side bet.
- **`Config.playPause` (3s) sits between a card landing and the next player's
  turn opening**, so a trick can be watched. It is a PAUSE, never a skip: the
  turn is already cleared when it starts, so nobody is on the clock and no hand
  is live. `TrickManager` takes it as a constructor arg (default `Config.playPause`)
  purely so `rewind-test.ts` can pass 0 — it asserts the state machine, not the
  pacing. Hearts does NOT have it: its rounds are 4x longer already.
- **A Rewind fired during that pause is HELD, not refused.** The card is still
  on the table and the trick hasn't resolved, so `canRewind` / `lastPlayer`
  accept the moment (`inPlayPause`), the pause is cut short, and
  `waitForCardPlay` spends the held rewind through the existing REWIND branch.
  Between TRICKS both flags are false and a rewind is still refused for real —
  that trick has been scored. Refusing mid-pause made a 3s hole where a
  perfectly good ability bounced.
- Host = first joiner: guests ready up, the host has the only START button. No
  auto-start countdown.

## Chaos mode

Host toggles classic/chaos on a lobby card. All role logic lives in
`server/engine/roles.ts` + `shared/roleDefs.ts` (data) + `client/components/
RolePanel.tsx`, gated behind the mode so the classic path is untouched.

- **EVERY seat gets a role**, dealt round-robin from a shuffled pool. All 8
  roles (Detective/Joker/Gambler/Judge/Guardian/Time Traveler/Angel/Mirrorer)
  are equally likely — none is rarer than the others.
- **Round-robin off a shuffled pool IS the no-duplicates rule** — `pool[i %
  pool.length]` is distinct for as long as the pool lasts, so any table of 8 or
  fewer is guaranteed no repeated roles, and only 9+ players see one twice.
  Never replace it with an independent random pick per seat.
- **Which seat gets which of those slots is weighted by `roleHistory`** — the
  one piece of RoleManager state that survives `resetGame`, so a player who was
  the Judge last game is heavily outweighed off the Judge this game
  (`ROLE_RECENCY_WEIGHTS`, three games deep, multiplied on a second sighting).
  Weights are never zero: a repeat is RARE, not banned, and a zero could leave
  a seat with no assignable slot. The pool is built FIRST and untouched by any
  of this, so the no-duplicates guarantee above is unaffected. History is keyed
  by seat id — the same id localStorage keeps — so it survives a refresh and
  resets only for a genuinely new player.
- **Duplicate role holders are supported and must stay that way.** Every
  per-player effect is keyed by player id. The two effects keyed by TARGET must
  ACCUMULATE, never overwrite: `armedSabotageBy` is a LIST of saboteurs per
  target, `armedGravekeeper` is a COUNT, `armedNullify` is a COUNT (an Angel's
  Intercede arms the same shield a Guardian's Nullify does, and two shields must
  block two abilities), and `armedBlessingBy` / `armedHaloBy` are lists. `disguisedBids` is deliberately
  last-write-wins — a bid can only display one number.
- **Never deal an ability this round can't use.** `startRound` filters the
  options: two-target abilities with <3 seats, a spent Big Swap, and **Rewind in
  a 1-card round** (pulling the play back leaves that seat holding the one card
  they just played, so `canRewind` always refuses). The two paths that HAND OVER
  an ability — Alternate Universe and the Mirrorer's Mimic — filter the same way.
- One ability per round, use-it-or-lose-it (two-target abilities never dealt
  with <3 seats). The Time Traveler's **Alternate Universe is the one exception**:
  it REPLACES your ability (a random one from a role you name) and returns
  `keepAbility`, so the round's action is still ahead of you. All options start equally likely, but the ability you were
  just dealt is weighted `0.4^streak` against 1.0 for the rest.
- **The Mirrorer is a full role (4 abilities), dealt as often as any other.**
  Every one of them rides somebody else: Mirror Bet (their tricks), Mimic (their ability), Twin
  Fate (the better of your two rounds, to both of you), Two-Way Mirror (your two
  rounds trade places). Mimic returns `keepAbility` like Alternate Universe — it
  REPLACES your ability without spending the turn — and must keep refusing to
  copy itself, or a seat re-copies for free forever. The two score-benders
  settle in `settleMirror`, a post-pass beside `settleGrace`: both need two
  FINISHED round scores, so neither can live in the per-seat `adjustScore` loop,
  and every pair is READ before any is written so two Mirrorers pointed at each
  other can't resolve off a number the other already moved.
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
- **The Angel's Grace is a SECRET mechanic.** Its abilities only ever help other
  players; +5 to the Angel per kindness that actually landed (+15 for
  Sacrifice), told privately at scoring and NEVER announced. Grace is only
  banked when the effect changed something — blessing a player who was never in
  danger pays nothing, which is what stops an Angel farming one safe ally. It
  settles in `settleGrace` AFTER every seat has been through `adjustScore`,
  because a blessing is only banked as the BLESSED seat is scored and the Angel
  may sit earlier in seat order.
- **Rewind only ever undoes the MOST RECENT play**, and that is load-bearing:
  undoing an earlier card could change the lead suit under players who already
  followed it. Who it hits is decided by timing, not by a picker. `canRewind()`
  is checked BEFORE the target's shield so an impossible rewind can't strip a
  Nullify for free.
- **Reverse Time can rewrite a bid while bidding is still going**, so the last
  bidder's forbidden number must never come off a cached running total.
  `BiddingManager.sumExcluding()` recomputes it live, and `syncBids()` ships the
  true `bidSum` on every `roleSync`. Get this wrong and the UI forbids the wrong
  chip, the server rejects the bid the UI allowed, and the round hangs forever.
- Every ability's `note` states whether a Guardian can cancel it — keep that
  accurate when adding or changing abilities. Announcements name the role,
  never the player; roles are revealed on the final standings.

## Hearts

The second game. Host toggles it on the same lobby card row as classic/chaos;
switching to Hearts forces the mode back to classic, because **chaos roles are
a Prediction Game feature and Hearts ships without any**. The Hearts engine
takes no RoleManager — if a Hearts role set is ever added, inject it into
`PassManager` / `HeartsTrickManager` the way `RoleManager` is injected into
`BiddingManager` / `TrickManager`.

Golf (below) is the third game, added the same way: its own `golf*` protocol
events, its own `src/server/engine/golf/` phase managers, its own
`GolfTable.tsx`, no RoleManager either.

- **3–7 players.** The whole deck is dealt every round, so a bigger table gets
  hands too short for the penalty cards to move. `Room.limits` returns the
  ACTIVE game's min/max — the seat cap on join stays at 10, and `canStart()` is
  what refuses an over-large Hearts table.
- **The deck is trimmed to divide evenly** (`trimmedDeck`), dropping the lowest
  NON-scoring cards. All 13 hearts and the Q♠ always survive: 26 points must be
  on the table at every size. Trimming can take the 2♣, which is why the opening
  lead comes from `openingCard()` (lowest club left) and never a hardcoded 2♣.
- **The pass is simultaneous, not turn-based.** One promise per seat,
  `Promise.all`. Every outgoing card leaves its hand BEFORE any incoming card
  lands, or a card just received could be passed straight on. Same no-turn-timer
  rule as everywhere else: only a disconnected seat gets picked for.
- **`passDirection` collapses "across" to no-pass at 3 players** — across is the
  same seat as left or right there. `hearts-test.ts` asserts every passing round
  is a permutation with no self-pass.
- **Client legality MUST come from `isLegalHeartsPlay`**, the same function the
  server validates with (`HeartsTable` passes it to `Hand` via `isPlayable`).
  Reimplementing it in the UI is how you get a card the UI offered and the
  server refuses — and with no turn timers, that hangs the round forever. The
  playtest's zero-rejection rule exists to catch exactly this.
- Trick resolution reuses `resolveTrickWinnerIndex` with `trumpSuit:
  'NoTrump'`, which already means "only the led suit can win". Don't write a
  second winner function.
- Scores are golf: `gameEnded` carries `lowestWins` and the standings are sorted
  ascending. The game runs until a seat crosses the host-chosen target
  (50/100/200) and always finishes that round.

## Golf

The third game: six-card grids, nine holes, lowest cumulative total wins
(`GolfConfig`, `src/shared/golfRules.ts`). Fixed round count like the
Prediction Game (`runGolfGame` loops `GolfConfig.totalHoles`), not Hearts'
"until someone crosses a target".

- **2–6 players.** `Room.limits` adds Golf as a third branch alongside
  Hearts/Prediction; the join-time seat cap still stays at `Config.maxPlayers`
  (10), same as it does for Hearts — `canStart()` is what actually refuses an
  over-large Golf table.
- **The one privacy model this app doesn't otherwise have: nobody sees their
  own face-down cards either.** Every other game always shows a player their
  own full hand privately; Golf's live state (`golfState`) is almost entirely
  PUBLIC — every seat's grid, with `null` standing in for any slot still
  face-down, the same shape for the grid's own owner as for everyone else. The
  one private moment is the card you just drew (`golfDrawResult`, sent only to
  the acting seat), before you decide what to do with it.
- **A turn is two sequential waits, not one** — `GolfTurnManager.runTurnPhase`
  chains `waitForDraw` (stock or discard) into `waitForResolve` (swap into a
  slot, or discard-and-flip a still-face-down one), the same two-stage shape
  `BiddingManager` already uses for bid-then-double-window. No turn timers
  either wait: a disconnected seat auto-draws from stock, then auto-resolves
  via the "swap in if it beats your worst known card, else learn something
  with a flip, else you have to swap it in somewhere" heuristic
  (`autoResolve`) — the same "least damaging" spirit as Hearts' `autoPlay`.
- **`discardAndFlip` is only legal on a card drawn from stock.** A card taken
  from the discard pile is already known information and must be placed
  (`swap`) — the standard rule that stops an infinite pass-through, enforced
  in `GolfTurnManager.handleResolve` by checking `pendingSource`.
- **The stock and discard piles live on `GolfTurnManager`, never on `Seat`** —
  they're table furniture, like the Prediction Game's deck. If the stock ever
  runs dry mid-hole, `reshuffleDiscardIntoStock` keeps the current discard top
  where it is and shuffles everything under it into a fresh stock; the total
  card count across both piles never actually changes turn to turn (a draw
  always returns exactly one card to the discard pile), so this is a rare
  path, not a required one.
- **The "last lap"**: the moment any seat's `golfRevealed` is all `true`,
  `finalLapTriggeredBy` locks in and every OTHER seat gets exactly one more
  turn (`finalLapRemaining`, one entry per remaining seat) before
  `scoreGolfHole` runs. The trigger check is guarded on
  `!this.finalLapTriggeredBy`, so a second seat completing its own grid during
  its final-lap turn never re-triggers or extends the lap.
- **Column scoring**: `golfRules.gridScore` sums 3 columns
  (`grid[i]`/`grid[i+3]` for `i` in 0-2); two cards of the same RANK in a
  column cancel it to 0, even two Kings (which would already be 0 on their
  own — the cancellation is about the match, not the value). Card values:
  Joker −2, King 0, Ace 1, 2–10 face value, J/Q 10 (`cardValue`). At
  `scoreGolfHole`, every remaining face-down card is revealed (win or lose,
  the whole grid is shown) before the total is added to `seat.totalScore` —
  **Golf reuses the Prediction/Hearts `totalScore`/`lastRoundScore` fields
  directly rather than adding a new score field**, since the shape is
  identical.
- Jokers are dealt IN, always, regardless of table size — a permanent Golf
  rule (`dealGolfGrids` calls `buildFullDeck(true)`), unlike the Prediction
  Game's overflow-only joker logic.

## UI conventions (user-driven, keep these)

- Dark "paper note" theme, slight card rotations, no ruled lines. Fonts:
  Bangers (titles) / Fredoka (headings) / Nunito (body) / a serif for card
  indices.
- **Card faces are Kenney's CC0 pixel-art deck** in `src/client/public/cards/`
  (~22KB for all 55), cropped to the artwork so each sprite IS the card. They
  render as `<img class="card__face">` with `image-rendering: pixelated` — the
  upscale is deliberate, so never "fix" it with smoothing. The sprites' true
  ratio is 60/42 = 1.4286; `--card-aspect` deliberately does NOT pin to that
  everywhere any more. On desktop it defaults to 1.524 (a ~7% stretch) to
  restore the taller "og size" of the original 82x125 reference deck that
  predates these sprites; the `@media (max-width: 720px)` block overrides it
  back to the true 1.4286 because mobile has no room to spare for a stretch
  nobody asked for there. Everything AROUND the face (radius, shadow,
  winner/playable rings, muted + illusion veils) is still CSS on the `.card`
  wrapper, and everything scales off `--card-w`. (This replaced an earlier
  all-CSS deck — no pip layouts or court panels now.)
- **Three card states, three distinct looks.** `--muted` (illegal): the real
  face, darkened right down but still readable — you must be able to see your
  own hand. `--barred` (a Rewind): red-ringed, genuinely unclickable.
  `--illusion`: the face is blacked out COMPLETELY, an opaque panel with a `?`,
  because a Detective's Illusion is now concealment, not a bluff — the holder
  can still play the card, they just don't know what it is. (It used to be
  pixel-identical to `--muted`; it deliberately isn't any more.)
- **An Illusion also reshuffles EVERY hand at the table** (`scrambleHands`),
  including seats it didn't touch and the Detective's own. Hands are dealt
  sorted, so a blacked-out card between the 9♠ and the 5♠ names itself; and if
  only the marks were shuffled, the shuffle would be the tell. For the same
  reason `TrickManager`'s Rewind pushes the card back WITHOUT re-sorting.
- Chat is for what PLAYERS say. Game events (doubling, ability announcements)
  go to the floating feed via `roleAnnounce`, never `systemChat`. Only presence
  lines — joined / left / watching / took a seat — belong in chat.
- Score sheet docked LEFT (row per round + trump icon, column per player,
  totals bar), open by default on desktop, on demand on touch; Tab or the
  SCORES menu item toggles it.
- Top bar: trump glyph, Round X/Y, Hand K/M, per-player "won / bid" chips
  (green on-target / red off, accent ring = turn).
- **The dock is deliberately small: SETTINGS + CHAT in every game, plus ROLE
  and ABILITY in chaos.** Everything that isn't a moment-to-moment action —
  which card art renders, the score sheet toggle, the restart vote — lives
  behind `SettingsMenu.tsx`, a popover opened from one SETTINGS button and
  shared by every game's table. A live restart vote still shows through as a
  badge on the closed SETTINGS button (`restart.votes.length`), so a vote
  in progress is never missed just because it's tucked in the menu.
- **`.quick` (chaos's ROLE + ABILITY column) docks top-right, the same corner
  chat opens in.** `ChatPanel` takes a `raised` prop (`Table.tsx` passes it
  whenever the ROLE/ABILITY buttons are rendered) that drops its top edge
  below `.quick` instead of opening underneath it — mirrors the old
  bottom-corner clearance trick, just flipped to the top edge, because
  `.quick`'s WIDTH is unbounded (ability names vary a lot) but its HEIGHT is
  capped at two stacked buttons, so vertical clearance is the stable axis.
  `.quick` itself sits above chat in z-index too, as a second line of defense.
  `SettingsMenu` no longer needs any of this — it's back in its own
  bottom-right corner with nothing sharing it.
- **ROLE and ABILITY are two separate, always-available buttons in chaos**,
  stacked in `.quick` top-right. `QuickAbility` renders only the ABILITY
  button (first, so its popover opens downward beneath it) and disappears
  once the ability is spent (or nothing was dealt) — it does NOT collapse into
  a ROLE button anymore. The ROLE button is rendered by `Table.tsx` itself,
  always present alongside it, opening `RolePanel` so a player can read their
  role and this round's ability (including ones already spent) to plan what
  card to play. `QuickAbility`'s popover still has NO backdrop on purpose —
  the trick stays visible while you aim — and still punts to `RolePanel` for
  the two-target abilities and the
  two that need a gallery (Alternate Universe's roles, Time Branches' hand).
- **The panel's private log is a LIST (`store.abilityLog`), never "the latest
  one".** Your own ability's result and whatever another player quietly did TO
  you both arrive on the same `abilityResult` channel — keeping one slot meant a
  secret Sacrifice landing on you erased the hand-read you spent your ability
  on. It clears on each new deal, and a refresh loses it (private lines aren't
  stored server-side). The roles gallery opens from inside the panel too, as a
  SIBLING of its backdrop so one click doesn't dismiss both.
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
- **`broadcastLobby()` must never fire mid-game — it early-returns unless
  `gameState === 'Lobby'`, and that guard is load-bearing.** `lobbyUpdate` goes
  to the whole room and the client reads it as "we're in the lobby now": it
  resets `view` and drops the round's history, order and role. Both a spectator
  joining AND a player reconnecting after a dropped connection call it, so
  without the guard either one throws the ENTIRE table out of the game — which
  is exactly the "someone's wifi died and it kicked us all out" bug.
  `scripts/spectate-test.mjs` covers both paths.
- **The restart vote is how a spectator gets a chair without waiting out the
  game.** Any seated player can toggle `voteRestart`; a majority of CONNECTED
  seats calls it, and `Room.abandonGame()` sets `aborted` and calls `cancel()`
  on all four phase managers. That cancel is load-bearing: there are no turn
  timers, so without it the round loop would sit forever on the turn of someone
  who is already looking at the lobby. The abandoned round is never scored and
  NO `gameEnded` goes out — the table just reappears in the lobby, where
  `seatSpectators()` does the actual seating. Votes from seats that drop are
  discarded, and the bar drops with them, so a disconnect can be what carries a
  vote that was one short.
- `index.ts` installs `uncaughtException` / `unhandledRejection` handlers that
  LOG and keep serving. One process hosts every table, so Node's default of
  exiting would drop every game at once — and because the round loop's phases
  are async, a throw in there is otherwise completely silent.
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
