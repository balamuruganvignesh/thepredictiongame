// Posts final standings to a Discord channel via an incoming webhook. Optional:
// with DISCORD_WEBHOOK_URL unset this is a no-op, so tables work fine without
// Discord configured. Fire-and-forget on purpose -- a slow or unreachable
// webhook must never delay the game loop's return to the lobby.

import type { Standing } from '@shared/protocol'

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const MEDALS = ['🥇', '🥈', '🥉']

function standingLines(standings: Standing[]): string[] {
  return standings.map((s, i) => {
    const rank = MEDALS[i] ?? `${i + 1}.`
    const role = s.roleEmoji && s.roleName ? ` — ${s.roleEmoji} ${s.roleName}` : ''
    return `${rank} **${s.name}** — ${s.totalScore}${role}`
  })
}

function postEmbed(embed: Record<string, unknown>) {
  if (!WEBHOOK_URL) return
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch((err) => {
    console.error('[discord] failed to post game result:', err)
  })
}

export function postGameEndedToDiscord(opts: { code: string; gameName: string; standings: Standing[] }) {
  const { code, gameName, standings } = opts
  const winner = standings[0]
  if (!winner) return

  postEmbed({
    title: `${gameName} finished — table ${code}`,
    description: `🏆 **${winner.name}** wins!\n\n${standingLines(standings).join('\n')}`,
    color: 0xf5c518,
  })
}

/**
 * The table voted to abandon a game in progress -- no winner, since it never
 * finished, but the standings as they stood are still worth a record of what
 * happened so far.
 */
export function postGameAbandonedToDiscord(opts: {
  code: string
  gameName: string
  roundNumber: number
  standings: Standing[]
}) {
  const { code, gameName, roundNumber, standings } = opts
  if (standings.length === 0) return

  postEmbed({
    title: `${gameName} restarted — table ${code}`,
    description: `🔄 Table voted to restart during round ${roundNumber}. Standings so far:\n\n${standingLines(standings).join('\n')}`,
    color: 0x808080,
  })
}
