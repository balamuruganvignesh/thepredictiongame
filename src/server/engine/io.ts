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

/**
 * The slice of TrickManager the Time Traveler's Rewind needs. Declared here
 * rather than imported so RoleManager never depends on TrickManager directly --
 * TrickManager already depends on RoleManager, and this keeps that one-way.
 */
export interface TrickHost {
  /** Which trick is on the table (0 between tricks). Rewind is once per trick. */
  currentTrickNumber(): number
  /** The seat whose card is currently the LAST one on the table, if any. */
  lastPlayer(): Seat | null
  /**
   * Whether the last play COULD be pulled back, without doing it. Split from
   * the execution so the caller can reject an impossible rewind before it has
   * burned the target's shield on it.
   */
  canRewind(): { ok: boolean; error?: string }
  /**
   * Pulls that card back off the table: it returns to their hand and they play
   * again, barred from repeating it. Only call after canRewind() said yes.
   */
  rewindLastPlay(): void
}
