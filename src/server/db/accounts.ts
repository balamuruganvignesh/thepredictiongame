// Accounts and sessions. The design rule that keeps this small: an account
// OWNS a player id, it does not replace one. Every existing system -- Room's
// seat matching, chaos roleHistory weighting, game_result_players, the
// leaderboard -- keeps keying off `playerId` and needs no knowledge that auth
// exists. Signing in only decides WHICH playerId a browser uses.
//
// That is also the entire cross-device mechanism: Room.join already
// re-attaches an existing seat by `seatById.get(playerId)`, so once a second
// device presents the same canonical id it lands back in the same chair with
// no new reconnect machinery at all.

import crypto from 'node:crypto'
import { db } from './index'
import { log } from '../logger'

export type Account = {
  id: number
  googleSub: string
  email: string | null
  name: string | null
  picture: string | null
  playerId: string
  coins: number
}

type AccountRow = {
  id: number
  google_sub: string
  email: string | null
  name: string | null
  picture: string | null
  player_id: string
  coins: number
}

const toAccount = (row: AccountRow): Account => ({
  id: row.id,
  googleSub: row.google_sub,
  email: row.email,
  name: row.name,
  picture: row.picture,
  playerId: row.player_id,
  coins: row.coins,
})

const selectBySub = db.prepare(`SELECT * FROM accounts WHERE google_sub = ?`)
const selectByPlayerId = db.prepare(`SELECT * FROM accounts WHERE player_id = ?`)
const selectById = db.prepare(`SELECT * FROM accounts WHERE id = ?`)

const insertAccount = db.prepare(`
  INSERT INTO accounts (google_sub, email, name, picture, player_id, coins, created_at, last_login)
  VALUES (@googleSub, @email, @name, @picture, @playerId, 0, @now, @now)
`)

const touchAccount = db.prepare(`
  UPDATE accounts SET email = @email, name = @name, picture = @picture, last_login = @now
  WHERE id = @id
`)

export type GoogleProfile = {
  sub: string
  email?: string
  name?: string
  picture?: string
}

/**
 * Resolve a Google profile to an account, creating one on first sight.
 *
 * The merge step is the one genuinely subtle piece here. A browser signing in
 * for the first time is usually already carrying an anonymous playerId with
 * real game history behind it, so we ADOPT that id as the account's canonical
 * one and every past game, stat and coin comes along for free.
 *
 * We deliberately do NOT merge when that anonymous id already belongs to a
 * different account (someone signed in on a shared browser). Rewriting
 * game_result_players.player_id across historical rows is a data migration
 * with real failure modes, for a genuinely rare case -- so the account simply
 * keeps the identity it already has and the stray anonymous id is abandoned.
 */
export const upsertAccount = db.transaction(
  (profile: GoogleProfile, anonPlayerId: string | null): Account => {
    const now = Date.now()
    const existing = selectBySub.get(profile.sub) as AccountRow | undefined

    if (existing) {
      touchAccount.run({
        id: existing.id,
        email: profile.email ?? null,
        name: profile.name ?? null,
        picture: profile.picture ?? null,
        now,
      })
      return toAccount({
        ...existing,
        email: profile.email ?? null,
        name: profile.name ?? null,
        picture: profile.picture ?? null,
      })
    }

    const claimed = anonPlayerId ? selectByPlayerId.get(anonPlayerId) : undefined
    const playerId = anonPlayerId && !claimed ? anonPlayerId : crypto.randomUUID()

    const { lastInsertRowid } = insertAccount.run({
      googleSub: profile.sub,
      email: profile.email ?? null,
      name: profile.name ?? null,
      picture: profile.picture ?? null,
      playerId,
      now,
    })

    log.info('account.created', { adoptedAnonId: playerId === anonPlayerId })
    return toAccount(selectById.get(lastInsertRowid) as AccountRow)
  },
)

// ---- Sessions ----------------------------------------------------------------

const SESSION_DAYS = 30

const insertSession = db.prepare(`
  INSERT INTO sessions (token, account_id, created_at, expires_at)
  VALUES (@token, @accountId, @now, @expiresAt)
`)

const selectSession = db.prepare(`
  SELECT a.* FROM sessions s
  JOIN accounts a ON a.id = s.account_id
  WHERE s.token = ? AND s.expires_at > ?
`)

const deleteSession = db.prepare(`DELETE FROM sessions WHERE token = ?`)
const deleteExpired = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`)

export function createSession(accountId: number): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  insertSession.run({
    token,
    accountId,
    now,
    expiresAt: now + SESSION_DAYS * 24 * 60 * 60 * 1000,
  })
  return token
}

export const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60

export function accountForSession(token: string | null | undefined): Account | null {
  if (!token) return null
  const row = selectSession.get(token, Date.now()) as AccountRow | undefined
  return row ? toAccount(row) : null
}

export function destroySession(token: string): void {
  deleteSession.run(token)
}

/**
 * Called from the existing 10-minute room-TTL sweep in index.ts rather than
 * on an interval of its own -- one heartbeat is enough for a process that
 * hosts every table.
 */
export function reapExpiredSessions(): void {
  try {
    deleteExpired.run(Date.now())
  } catch (error) {
    log.error('sessions.reap.failed', { error: String(error) })
  }
}

/** Parses a Cookie header. Five lines beats a cookie-parser dependency. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}
