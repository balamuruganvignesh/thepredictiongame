// Optional Redis connection, no-op if REDIS_URL is unset -- same pattern as
// discord.ts / errorTracking.ts. This is groundwork for running more than
// one machine (see CLAUDE.md's "Persistence & observability" section for
// exactly what it does and does NOT yet enable): it lets Socket.IO fan
// broadcasts out across instances and lets instances see which room codes
// the others are holding. It does NOT by itself make it safe to raise
// fly.toml's machine count -- that also needs connection-level routing so a
// join for an existing room reaches the machine that already holds it,
// which isn't built yet.

import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL

export const redis = REDIS_URL ? new Redis(REDIS_URL) : null

// The redis-adapter needs its own dedicated subscriber connection, separate
// from any connection used for ordinary commands (ioredis connections can't
// multiplex a subscription with regular GET/SET traffic).
export const redisSub = REDIS_URL ? new Redis(REDIS_URL) : null

if (redis) {
  redis.on('error', (err) => console.error('[redis]', err))
}
if (redisSub) {
  redisSub.on('error', (err) => console.error('[redis:sub]', err))
}

/** Stable per-process id: Fly sets FLY_MACHINE_ID; anywhere else, one per boot. */
export const instanceId = process.env.FLY_MACHINE_ID ?? crypto.randomUUID()
