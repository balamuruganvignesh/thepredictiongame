// Posts uncaught server errors to a webhook (Sentry's inbound webhook relay,
// a Discord/Slack channel, whatever collects alerts for you). Optional: with
// ERROR_WEBHOOK_URL unset this is a no-op, same as discord.ts's game-result
// webhook. Deliberately dependency-free -- the official Sentry Node SDK
// pulls in the full OpenTelemetry auto-instrumentation stack (tracing for
// databases and frameworks this app doesn't use) for a 256mb single-instance
// deployment, which costs far more than the alerting is worth here.

const WEBHOOK_URL = process.env.ERROR_WEBHOOK_URL

export function captureError(kind: 'uncaughtException' | 'unhandledRejection', error: unknown) {
  if (!WEBHOOK_URL) return

  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, message, time: new Date().toISOString() }),
  }).catch((err) => {
    console.error('[errorTracking] failed to post error alert:', err)
  })
}
