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
