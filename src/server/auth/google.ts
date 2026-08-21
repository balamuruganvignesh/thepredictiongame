// Google sign-in, hand-rolled against the OAuth 2.0 authorization-code flow.
//
// No google-auth-library, and no JWKS signature verification -- deliberately.
// The `code` is exchanged over a direct server-to-server HTTPS call to
// Google's token endpoint, so the id_token arrives on that TLS response
// rather than via the browser. A signature check exists to prove an untrusted
// carrier didn't forge the token; there is no untrusted carrier here. This is
// the standard rule for a confidential-client code exchange.
//
// DO NOT "fix" this by dropping in an auth SDK -- it would pull a dependency
// tree onto a 256mb single-process box to re-verify something we received
// directly, the same call this repo already makes for logger.ts (not a
// logging framework) and errorTracking.ts (not the Sentry SDK).
//
// The whole surface is off unless both env vars are set, so a fork or a local
// dev box with no Google project configured behaves exactly as before.

import { log } from '../logger'
import type { GoogleProfile } from '../db/accounts'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET

/** Where Google sends the browser back. Must match the console exactly. */
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ??
  (process.env.NODE_ENV === 'production'
    ? 'https://thepredictiongame.fly.dev/auth/google/callback'
    : 'http://localhost:3001/auth/google/callback')

export const googleConfigured = Boolean(CLIENT_ID && CLIENT_SECRET)

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // A card game does not need offline access, and asking for it turns a
    // one-tap consent screen into a scarier one.
    prompt: 'select_account',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Decodes a JWT payload. See the note at the top on why we don't verify it. */
function decodePayload(idToken: string): Record<string, unknown> {
  const segment = idToken.split('.')[1]
  if (!segment) throw new Error('malformed id_token')
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
}

export async function exchangeCode(code: string): Promise<GoogleProfile | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID!,
        client_secret: CLIENT_SECRET!,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) {
      log.error('auth.google.exchange.failed', { status: response.status })
      return null
    }

    const body = (await response.json()) as { id_token?: string }
    if (!body.id_token) {
      log.error('auth.google.exchange.noIdToken')
      return null
    }

    const claims = decodePayload(body.id_token)
    const sub = typeof claims.sub === 'string' ? claims.sub : null
    if (!sub) return null

    return {
      sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      name: typeof claims.name === 'string' ? claims.name : undefined,
      picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    }
  } catch (error) {
    log.error('auth.google.exchange.threw', { error: String(error) })
    return null
  }
}
