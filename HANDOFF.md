# Upgrade roadmap — handoff

Start-of-session note for picking this back up. **Read `CLAUDE.md` first** —
it's the canonical architecture doc and already covers everything shipped so
far in detail (Spades, Tournament mode, persistence, observability, etc. all
have their own sections there now). This file is just the punch list: what's
done, what's outstanding, and what to watch out for.

The original roadmap this all comes from is at
`~/.claude/plans/i-want-to-make-concurrent-wigderson.md` (5 phases, ordered by
dependency/risk). Phases 0–3 are done; 4 and 5 are not started.

## Immediate action items

1. **Two commits are local-only, not pushed:**
   - `96eeadf` — Tournament mode
   - `2ae349a` — Spades
   Push (`git push`) will trigger `fly-deploy.yml`'s auto-deploy. Confirm with
   the user before pushing, same as always.
2. **The Fly volume for SQLite persistence may still be unprovisioned.** If
   the deploy fails at a mount step, that's why. Fix:
   ```bash
   fly volumes create data --app thepredictiongame --region ewr --size 1
   ```
   This was flagged back when Phase 0 shipped (`6db38af`) — check with the
   user whether they've already done it before assuming it's still open.

## Done: Phase 0 (`6db38af`, pushed)

Test suite + CI (`vitest`, wraps the fast pure-logic scripts, runs in GitHub
Actions), structured logging, optional error-alert webhook, token-gated
`/admin/status`, SQLite persistence (`players` / `game_results` /
`game_result_players`) written fire-and-forget on every finished/abandoned
game.

## Done: Phase 1 (`6db38af`, pushed)

Leaderboard + per-player stats at `/leaderboard`, built on the Phase 0
persistence layer. REST endpoints (`/api/leaderboard`, `/api/players/:id/stats`),
deliberately NOT added to the Socket.IO protocol since they're not
table-scoped.

## Done: Phase 2 (`6db38af`, pushed) — PARTIAL BY DESIGN

Redis-backed Socket.IO adapter + a room directory, both fully opt-in via
`REDIS_URL` and no-ops otherwise (byte-for-byte unchanged behavior with it
unset — this is why it shipped without extra review risk).

**This does NOT lift the 1-machine constraint in `fly.toml`.** The piece
that's still missing is connection-level routing — ensuring a `join` for an
existing room lands on the machine that actually holds it in memory. Closing
that gap is genuinely Fly-proxy-specific work (`Fly-Replay` header timing
against the Socket.IO handshake) that wasn't attempted blind, because getting
it wrong reproduces the exact "kicked on join" bug the 1-machine pinning
exists to prevent. See CLAUDE.md's "Multi-machine groundwork" section before
touching machine count.

## Done: Phase 3 (`96eeadf`, `2ae349a`, **not pushed**)

- **Tournament mode**: host picks 2+ games to rotate through with combined,
  rank-based scoring (never raw scores — different games' scores live on
  incompatible scales). `Room.runGameLoop` recurses into itself per leg
  rather than being restructured, so the single-game path is provably
  unchanged when no tournament is configured.
- **Spades**: the 5th game. Chosen specifically because it's natively a 2v2
  partnership game, so it satisfied both the "5th game" and "team play"
  roadmap items in one build instead of two. Full engine (bidding with Nil,
  broken-suit trump legality, team scoring with bags), full client UI, a
  24-assertion pure-logic test, a bot-driven playtest, and a live browser
  verification pass (which found and fixed a real top-bar CSS bug).

Both were caught having real bugs during their own verification passes before
shipping — worth remembering that "looks done" and "is done" aren't the same
here; run the relevant playtest/test script after any further changes to
either.

## Not started: Phase 4 — UI/UX big swings

In priority order from the original roadmap (accessibility first since later
items should respect it from the start, not retrofit onto it):

1. **Accessibility pass** — screen-reader labels/roles, keyboard navigation
   for hand/bidding, colorblind-safe suit/role indicators, keyboard-only
   play end to end.
2. **Real card animations** — actual deal/flight/flip motion. Currently pure
   CSS transitions, no animation library. Introducing one (e.g. Framer
   Motion) touches every table view (`Table.tsx` and all five per-game table
   components now: Hearts/Golf/Blackjack/Spades + the base Prediction Game
   table). Sequence after accessibility so motion respects
   `prefers-reduced-motion` from the start.
3. **Replay viewer** — reconstruct a finished round trick-by-trick, in-memory
   only (current game, current server process) — no persistence dependency
   for v1. A "replay after restart" upgrade could follow later using the
   Phase 0 persistence layer, but that's explicitly out of scope for the
   first pass.
4. **Installable PWA** — offline app shell, home-screen install, better
   connection-loss UX. Builds on the existing reconnect-token flow
   (`Room.detach`, client re-emitting `join` on socket reconnect) — don't
   reinvent that part.

## Not started: Phase 5 — Social/meta polish

1. **Public table browser** — join a random open table instead of needing an
   invite code. Needs a host opt-in "public" flag on table creation (default
   OFF — a private game with friends shouldn't show up in a directory by
   default) plus a listing surface (REST, matching the Leaderboard's pattern,
   is the natural fit over a new Socket.IO event).
2. **Emote/reaction overlay** — quick non-chat reactions during play, kept
   architecturally distinct from the existing chat/`roleAnnounce` feed (see
   CLAUDE.md's chat-vs-feed separation — don't conflate the two).

## Conventions worth knowing before continuing

- **Commit after each accepted chunk** (explicit project convention, not just
  a Phase 3 habit) — don't let multiple unrelated features pile up in one
  commit.
- **New game engines follow an established shape**: `src/shared/<game>Rules.ts`
  (pure, imported by both sides — legality must come from here, never
  reimplemented client-side, or the client offers plays the server rejects
  and the round hangs since there are no turn timers), `src/server/engine/<game>/`
  (deck/bidding/tricks/scoring managers, each following the promise-per-turn
  pattern the Prediction Game's `BiddingManager`/`TrickManager` established),
  a client table component, and a `<game>-test.ts` + `<game>-playtest.ts`
  pair in `scripts/`.
- **Reuse the generic trick-play events** (`playCard`/`trickUpdate`/
  `trickResolved`) for anything that's genuinely simple trick-taking (Hearts
  and Spades both do this) rather than inventing prefixed duplicates — only
  give a new game its own events for what's actually game-specific.
- **`npm run typecheck`, `npm test`, and `npm run build` before every
  commit** — all three are fast (well under a minute combined) and this repo
  has caught real bugs via each of them during this session.
- Full command reference (all playtest/test scripts, their pass conditions,
  how to point sockets at a second server with `PORT=`) is in CLAUDE.md's
  Workflow section — don't re-derive any of this from scratch.
