// Mint, list and revoke redeem codes.
//
//   npx tsx scripts/codes.ts list
//   npx tsx scripts/codes.ts add --coverage 1
//   npx tsx scripts/codes.ts add --coverage 0.5 --uses 20 --days 7
//   npx tsx scripts/codes.ts add --coins 500 --code LAUNCHDAY
//   npx tsx scripts/codes.ts rm ABCD-EFGH
//
// Writes DIRECTLY to the SQLite file at DATABASE_PATH (./data/game.db by
// default), which makes it a LOCAL tool: production's database is the Fly
// volume, so use the /admin/codes routes for the live game rather than
// pointing this at it. Same reasoning as every other script in here -- a
// convenience for the person running the server, not a deploy step.
//
// TypeScript rather than .mjs on purpose, like the playtests: it imports the
// same db/codes.ts the server uses, so a code minted here can never disagree
// with a code the server would accept.

import { describeGrant, formatCode } from '../src/server/codes'
import { createCode, deleteCode, listCodes, type CodeRow } from '../src/server/db/codes'

const [command, ...rest] = process.argv.slice(2)

/** `--flag value` pairs, plus the first bare word as the positional. */
function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith('--')) flags[token.slice(2)] = argv[++i] ?? ''
    else positional.push(token)
  }
  return { flags, positional }
}

function describeRow(row: CodeRow): string {
  const grant = describeGrant(row)
  const uses = row.max_uses == null ? `${row.uses} uses` : `${row.uses}/${row.max_uses} uses`
  const expiry =
    row.expires_at == null
      ? ''
      : row.expires_at < Date.now()
        ? ', EXPIRED'
        : `, expires ${new Date(row.expires_at).toISOString().slice(0, 10)}`
  return `${formatCode(row.code).padEnd(10)}  ${grant.padEnd(26)}  ${uses}${expiry}`
}

const usage = `Usage:
  codes.ts list
  codes.ts add [--coverage <0-1> | --coins <n>] [--code X] [--label "..."] [--uses <n>] [--days <n>]
  codes.ts rm <code>`

if (command === 'list') {
  const rows = listCodes()
  if (rows.length === 0) console.log('No codes.')
  else rows.forEach((row) => console.log(describeRow(row)))
} else if (command === 'add') {
  const { flags } = parseArgs(rest)
  const days = flags.days ? Number(flags.days) : null
  const result = createCode({
    code: flags.code ?? null,
    coverage: flags.coverage != null ? Number(flags.coverage) : null,
    coins: flags.coins != null ? Number(flags.coins) : null,
    label: flags.label ?? null,
    maxUses: flags.uses != null ? Number(flags.uses) : null,
    expiresAt: days ? Date.now() + days * 24 * 60 * 60 * 1000 : null,
  })
  if (!result.ok) {
    console.error(result.error)
    process.exit(1)
  }
  console.log(`created ${formatCode(result.code.code)} — ${describeGrant(result.code)}`)
} else if (command === 'rm') {
  const { positional } = parseArgs(rest)
  const target = positional[0]
  if (!target) {
    console.error(usage)
    process.exit(1)
  }
  if (!deleteCode(target)) {
    console.error(`No such code: ${target}`)
    process.exit(1)
  }
  console.log(`revoked ${formatCode(target)}`)
  // Redemptions already granted are left in place deliberately -- they are
  // the record of a grant that really happened, and clearing them would let
  // those players redeem a re-minted code a second time.
} else {
  console.log(usage)
  process.exit(command ? 1 : 0)
}
