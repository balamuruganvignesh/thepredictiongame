import type { ServerToClientEvents } from '@shared/protocol'
import type { Seat } from '../types'

/** Every server->client event carries exactly one payload argument. */
type Payload<K extends keyof ServerToClientEvents> = Parameters<ServerToClientEvents[K]>[0]

/**
 * The two ways the engine talks to clients. Room implements this; the phase
 * managers only ever see this narrow surface, which keeps them free of any
 * Socket.IO detail (and trivially testable).
 */
export interface EngineIO {
  broadcast<K extends keyof ServerToClientEvents>(event: K, payload: Payload<K>): void
  send<K extends keyof ServerToClientEvents>(seat: Seat, event: K, payload: Payload<K>): void
  /**
   * Emit to everyone WATCHING the table (they hold no Seat, so `send` can't
   * reach them). Needed wherever a payload is personalised per seat -- bids
   * are, because a disguised bid must still look real to its owner -- since
   * those paths deliberately skip `broadcast`.
   */
  sendSpectators<K extends keyof ServerToClientEvents>(event: K, payload: Payload<K>): void
}
