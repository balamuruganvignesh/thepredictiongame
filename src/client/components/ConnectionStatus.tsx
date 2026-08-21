// What's showing when the socket isn't connected.
//
// This used to be one line -- "reconnecting…" -- which is true but unhelpful:
// it looks identical whether your wifi dropped, the server is redeploying, or
// you walked into a lift, and it gives you nothing to do. Since a table is
// held open for a disconnected seat (Room.detach) and the client re-emits
// `join` with the stored seat token the moment the socket comes back, the
// honest message is "your chair is being held", plus a way to stop waiting
// for the automatic retry.
//
// The reconnect mechanism itself is untouched: socket.io's own backoff still
// does the work, and the button just asks it to try now.

import { useEffect, useState } from 'react'
import { socket } from '../socket'

export function ConnectionStatus({ inGame }: { inGame: boolean }) {
  // navigator.onLine only ever proves the NEGATIVE reliably: false means
  // there is definitely no network, true means "there is an interface", which
  // is not the same as "the server is reachable". So it's used only to pick
  // the wording, never to decide whether to reconnect.
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return (
    <div className="connection" role="status" aria-live="polite">
      <span className="connection__dot" aria-hidden="true" />
      <span className="connection__text">
        {online ? 'reconnecting to the table…' : "you're offline"}
        {inGame && <span className="connection__sub">your seat is being held</span>}
      </span>
      <button
        type="button"
        className="connection__retry"
        onClick={() => {
          // connect() on an already-connecting socket is a no-op, so this is
          // safe to mash.
          socket.connect()
        }}
      >
        retry now
      </button>
    </div>
  )
}
