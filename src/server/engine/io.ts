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
}
