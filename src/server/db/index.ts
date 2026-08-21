// A tiny always-on SQLite store for cross-game history. Fully separate from
// Room's in-memory state -- Room never reads this back, it's the durable
// trail Phase 1 features (profiles, leaderboards, rematch) will read from.
// Local dev writes to ./data/game.db (gitignored); production points
// DATABASE_PATH at the Fly volume mount so it survives a redeploy the way
// nothing else in this app currently does.

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const DEFAULT_PATH = path.join(process.cwd(), 'data', 'game.db')
const DB_PATH = process.env.DATABASE_PATH ?? DEFAULT_PATH

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// Narrow schema, scoped to exactly what a finished game produces today.
// Standings carry a stable player id (the same seat token localStorage
// persists across sessions), a display name, a final score, and a rank --
// that's the whole surface Phase 1's leaderboard needs to query against.
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    game_type TEXT NOT NULL,
    game_name TEXT NOT NULL,
    round_number INTEGER,
    aborted INTEGER NOT NULL DEFAULT 0,
    ended_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_result_players (
    game_result_id INTEGER NOT NULL REFERENCES game_results(id),
    player_id TEXT NOT NULL,
    player_name TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    rank INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_result_players_player
    ON game_result_players(player_id);
`)

// ---- Accounts, wallet and cosmetics ------------------------------------------
//
// Additive to everything above: an account does NOT replace the seat token,
// it OWNS one. `accounts.player_id` is the canonical id a signed-in browser
// adopts, so Room, roles.ts, stats.ts and the leaderboard all keep keying off
// `playerId` exactly as they did before and need no knowledge of auth at all.
//
// Same no-migration-framework posture as the tables above -- these are purely
// additive CREATE TABLE IF NOT EXISTS, so an existing game.db picks them up on
// the next boot with nothing to run by hand.
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub  TEXT NOT NULL UNIQUE,
    email       TEXT,
    name        TEXT,
    picture     TEXT,
    player_id   TEXT NOT NULL UNIQUE,
    coins       INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    last_login  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    account_id  INTEGER NOT NULL REFERENCES accounts(id),
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

  -- A ledger rather than a bare balance column, so a balance is always
  -- explainable and a double-award shows up as two visible rows instead of
  -- silently inflating a number. accounts.coins is a denormalized cache kept
  -- in the same transaction.
  CREATE TABLE IF NOT EXISTS coin_ledger (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id      TEXT NOT NULL,
    delta          INTEGER NOT NULL,
    reason         TEXT NOT NULL,
    game_result_id INTEGER,
    created_at     INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coin_ledger_player ON coin_ledger(player_id);

  -- Keyed by player_id, not account id: an anonymous player earns coins too,
  -- and if they later sign in and that id becomes canonical, the wallet comes
  -- with them. Signing in is a reward, never a prerequisite.
  CREATE TABLE IF NOT EXISTS owned_items (
    player_id  TEXT NOT NULL,
    item_id    TEXT NOT NULL,
    bought_at  INTEGER NOT NULL,
    PRIMARY KEY (player_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS equipped_items (
    player_id  TEXT PRIMARY KEY,
    theme      TEXT,
    cardback   TEXT
  );
`)

// ---- Additive column migrations ---------------------------------------------
//
// CREATE TABLE IF NOT EXISTS above only helps a table that does not exist yet.
// Once a table has shipped -- and equipped_items has, it is live on the Fly
// volume -- a new column needs a real ALTER. SQLite has no
// ADD COLUMN IF NOT EXISTS, so check PRAGMA table_info first; running the
// ALTER blind would throw "duplicate column name" on every boot after the
// first.
//
// Deliberately not a migration framework: these are additive, nullable
// columns with no backfill and no ordering between them, which is the only
// kind of schema change this app has ever needed.
function addColumnIfMissing(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

addColumnIfMissing('equipped_items', 'avatar', 'TEXT')
// Which card art renders. NULL is the free classic deck (shared/decks.ts).
addColumnIfMissing('equipped_items', 'deck', 'TEXT')

// Consumable items (powerups) are held in CHARGES, so one row can stand for
// several. owned_items' PRIMARY KEY (player_id, item_id) is what makes a
// quantity column the right shape here rather than one row per charge --
// and it keeps every non-consumable at its existing implicit quantity of 1.
addColumnIfMissing('owned_items', 'quantity', 'INTEGER NOT NULL DEFAULT 1')
