// Tracks which process instance currently holds each room code in memory,
// in Redis, keyed by room code. No-op if Redis isn't configured -- same
// no-op-if-unset pattern as everywhere else in this app.
//
// This is groundwork only: nothing currently reads it back to route an
// incoming connection to the instance that actually holds the room (that
// needs connection-level routing, which isn't built -- see redis.ts and
// CLAUDE.md's "Persistence & observability" section for exactly what that
// gap is). Today this only makes each room's owning instance visible for a
// future routing layer, or for the admin endpoint, to use.

import { redis, instanceId } from './redis'

const KEY_PREFIX = 'roomdir:'
// Comfortably longer than the room-reap sweep interval in index.ts (10 min),
// so a still-live room's entry can't expire between two sweep passes even if
// one refresh is delayed.
const TTL_SECONDS = 20 * 60

export function registerRoom(code: string) {
  if (!redis) return
  redis.set(`${KEY_PREFIX}${code}`, instanceId, 'EX', TTL_SECONDS).catch((err) => {
    console.error('[roomDirectory] register failed:', err)
  })
}

export const refreshRoom = registerRoom

export function removeRoom(code: string) {
  if (!redis) return
  redis.del(`${KEY_PREFIX}${code}`).catch((err) => {
    console.error('[roomDirectory] remove failed:', err)
  })
}
