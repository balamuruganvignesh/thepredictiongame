// Service-worker registration and the home-screen install prompt.
//
// Kept out of main.tsx so the entry point stays three lines of React, and out
// of any component so registration happens once per page load rather than
// once per mount.

const SW_URL = '/sw.js'

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  // Dev is Vite's own server with HMR; a worker caching the shell in front of
  // it is pure confusion for no benefit. `process.env.NODE_ENV` rather than
  // `import.meta.env` because that's what the rest of the client already uses
  // (see useGame.ts) and it needs no change to tsconfig's `types`.
  if (process.env.NODE_ENV !== 'production') return

  // After load, so registration never competes with the first paint or the
  // socket handshake for bandwidth.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SW_URL).catch(() => {
      // A failed registration means no offline shell. That's a degraded
      // experience, not a broken one -- the game itself needs the network
      // anyway, so there is nothing useful to tell the player here.
    })
  })
}

/**
 * Chrome and friends fire `beforeinstallprompt` when the app qualifies for
 * installation, and the event is the ONLY handle on the native prompt --
 * there's no way to summon one later from scratch. So it's captured here at
 * module scope, before any component has mounted, and handed out on request.
 *
 * iOS Safari never fires it at all; there, installing is Share -> Add to Home
 * Screen and no button we could draw would do it.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: InstallPromptEvent | null = null
const listeners = new Set<(available: boolean) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's own mini-infobar so the offer appears where it
    // makes sense (the landing screen) rather than over the table.
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
    for (const listener of listeners) listener(true)
  })

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    for (const listener of listeners) listener(false)
  })
}

export function installAvailable(): boolean {
  return deferredPrompt != null
}

export function onInstallAvailabilityChange(listener: (available: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Shows the native install prompt. One shot: the event can't be reused. */
export async function promptInstall(): Promise<boolean> {
  const prompt = deferredPrompt
  if (!prompt) return false
  deferredPrompt = null
  for (const listener of listeners) listener(false)
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  return outcome === 'accepted'
}
