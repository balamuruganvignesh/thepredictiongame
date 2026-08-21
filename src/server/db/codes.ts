// The redeem-code table: authoring, listing and revoking. The REDEEMING half
// lives in shop.ts beside the ledger it writes to, since a redemption is a
// coin grant first and a code lookup second.
//
// Codes live here rather than in source so minting one is a command
// (scripts/codes.ts) or a request (/admin/codes) rather than an edit and a
// redeploy. server/codes.ts keeps only the format and the built-in seeds.

import { BUILTIN_CODES, generateCode, normalizeCode, type CodeDefinition } from '../codes'
import { db } from './index'
import { log } from '../logger'

export type CodeRow = {
  code: string
  coverage: number | null
  coins: number | null
  label: string
  max_uses: number | null
  uses: number
  expires_at: number | null
  created_at: number
}

const selectCode = db.prepare(`SELECT * FROM redeem_codes WHERE code = ?`)
const selectAllCodes = db.prepare(`SELECT * FROM redeem_codes ORDER BY created_at DESC`)
const insertCode = db.prepare(`
  INSERT INTO redeem_codes (code, coverage, coins, label, max_uses, uses, expires_at, created_at)
  VALUES (@code, @coverage, @coins, @label, @maxUses, 0, @expiresAt, @now)
`)
const deleteCodeRow = db.prepare(`DELETE FROM redeem_codes WHERE code = ?`)
/**
 * Bumped inside the redemption transaction in shop.ts, never on its own --
 * a use count that can drift from the grants it counts is worse than no
 * count at all.
 */
export const bumpCodeUses = db.prepare(`UPDATE redeem_codes SET uses = uses + 1 WHERE code = ?`)

export function getCode(raw: string): CodeRow | undefined {
  return selectCode.get(normalizeCode(raw)) as CodeRow | undefined
}

export function listCodes(): CodeRow[] {
  return selectAllCodes.all() as CodeRow[]
}

export type CreateCodeResult = { ok: true; code: CodeRow } | { ok: false; error: string }

/**
 * Mints a code. Everything is optional: with no `code` one is generated, and
 * with no `label` one is derived from the grant, so the common case is a
 * single flag.
 *
 * Validation is real rather than advisory because both callers are trusted
 * but fat-fingerable -- a coverage of 100 (meaning "100%") would otherwise
 * mint a code worth a hundred shops.
 */
export function createCode(input: {
  code?: string | null
  coverage?: number | null
  coins?: number | null
  label?: string | null
  maxUses?: number | null
  expiresAt?: number | null
}): CreateCodeResult {
  const hasCoverage = input.coverage != null
  const hasCoins = input.coins != null
  if (hasCoverage === hasCoins) {
    return { ok: false, error: 'Give exactly one of coverage or coins.' }
  }
  if (hasCoverage && !(input.coverage! > 0 && input.coverage! <= 1)) {
    return { ok: false, error: 'Coverage must be a fraction between 0 and 1 (0.5 is half the shop).' }
  }
  if (hasCoins && !(Number.isInteger(input.coins) && input.coins! > 0)) {
    return { ok: false, error: 'Coins must be a positive whole number.' }
  }
  if (input.maxUses != null && !(Number.isInteger(input.maxUses) && input.maxUses > 0)) {
    return { ok: false, error: 'Uses must be a positive whole number, or left off for unlimited.' }
  }

  const code = normalizeCode(input.code || generateCode())
  if (code.length < 4) return { ok: false, error: 'A code needs at least 4 letters or digits.' }
  if (getCode(code)) return { ok: false, error: `${code} already exists.` }

  const label =
    input.label ||
    (hasCoverage
      ? input.coverage! >= 1
        ? 'the whole shop'
        : `${Math.round(input.coverage! * 100)}% of the shop`
      : `${input.coins} coins`)

  insertCode.run({
    code,
    coverage: hasCoverage ? input.coverage : null,
    coins: hasCoins ? input.coins : null,
    label,
    maxUses: input.maxUses ?? null,
    expiresAt: input.expiresAt ?? null,
    now: Date.now(),
  })
  log.info('code.created', { code, label })
  return { ok: true, code: getCode(code)! }
}

/**
 * Revokes a code. The `redeemed_codes` rows it already granted are left
 * alone -- they are the audit trail of a grant that really happened, and
 * deleting them would let a player re-redeem a re-minted code.
 */
export function deleteCode(raw: string): boolean {
  return deleteCodeRow.run(normalizeCode(raw)).changes > 0
}

/**
 * Puts the built-in codes in the table if they aren't there. Runs on every
 * boot and is idempotent by the primary key, so an EXISTING row is never
 * overwritten -- editing BUILTIN_CODES will not change a code that has
 * already been seeded, and nothing you mint by hand is ever touched by a
 * deploy.
 *
 * The one thing to know: revoking a built-in re-seeds it on the next boot,
 * since "revoked" and "not yet seeded" both look like an absent row. To
 * retire one for good, drop it from BUILTIN_CODES as well.
 */
function seedBuiltinCodes(): void {
  for (const definition of BUILTIN_CODES as readonly CodeDefinition[]) {
    const code = normalizeCode(definition.code)
    if (getCode(code)) continue
    insertCode.run({
      code,
      coverage: definition.coverage ?? null,
      coins: definition.coins ?? null,
      label: definition.label,
      maxUses: definition.maxUses ?? null,
      expiresAt: definition.expiresAt ?? null,
      now: Date.now(),
    })
  }
}

seedBuiltinCodes()
