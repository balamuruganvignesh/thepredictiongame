import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/protocol'

/**
 * One socket for the whole app. In dev Vite proxies /socket.io to the game
 * server on :3001; in production the same Node process serves both, so an
 * origin-relative connection is correct either way.
 */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
})

const PLAYER_ID_KEY = 'prediction-game:playerId'
const NAME_KEY = 'prediction-game:name'

/**
 * The seat token. Kept in localStorage so a refresh mid-round re-attaches to
 * the same chair instead of walking away from the table.
 */
export const storedPlayerId = () => localStorage.getItem(PLAYER_ID_KEY)
export const rememberPlayerId = (id: string) => localStorage.setItem(PLAYER_ID_KEY, id)

/**
 * The same token, minted on the spot if this browser has never had one.
 *
 * `storedPlayerId` stays nullable because the JOIN path is allowed to arrive
 * without an id -- the server mints the seat then. The wallet has no such
 * moment: someone can open /shop before they have ever sat at a table, and
 * an anonymous wallet has to be keyed by SOMETHING durable to be spendable at
 * all. Minting here writes the same id the next join would have claimed, so
 * the coins and the seat still belong to one person.
 */
export const walletPlayerId = (): string => {
  const existing = storedPlayerId()
  if (existing) return existing
  const minted =
    // randomUUID is unavailable in an insecure context (a LAN IP over plain
    // http, which is how people play this on a shared wifi).
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  rememberPlayerId(minted)
  return minted
}

export const storedName = () => localStorage.getItem(NAME_KEY) ?? ''

/**
 * The avatar an anonymous player picked. A signed-in player's avatar lives on
 * their account instead and the server ignores what's sent here -- same rule
 * as playerId, and for the same reason.
 */
const AVATAR_KEY = 'prediction-game:avatar'
export const storedAvatar = () => localStorage.getItem(AVATAR_KEY)
export const rememberAvatar = (id: string) => localStorage.setItem(AVATAR_KEY, id)
export const rememberName = (name: string) => localStorage.setItem(NAME_KEY, name)
