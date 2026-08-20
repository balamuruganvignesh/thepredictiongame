// CI entry point for the fast, in-process rule tests documented in
// CLAUDE.md. Those scripts (scripts/*-test.ts) already assert every pure
// rule with no server involved and finish in well under a second each --
// this file doesn't reimplement any of that, it just runs each one as a
// subprocess and turns its exit code into a vitest pass/fail so `npm test`
// has a single entry point for CI. The slower socket-driven playtests
// (scripts/*-playtest.ts, scripts/playtest.mjs, spectate-test.mjs,
// restart-vote-test.mjs) need a running server and stay a manual/CI-separate
// step per CLAUDE.md.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'

const run = promisify(execFile)

const FAST_SCRIPTS = [
  'roles-test.ts',
  'abilities-test.ts',
  'rewind-test.ts',
  'hearts-test.ts',
  'golf-test.ts',
  'blackjack-test.ts',
]

describe('pure-logic scripts', () => {
  for (const script of FAST_SCRIPTS) {
    it(
      script,
      async () => {
        await run('npx', ['tsx', `scripts/${script}`], { timeout: 30_000 })
      },
      30_000,
    )
  }
})
