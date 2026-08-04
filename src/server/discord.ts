// Posts final standings to a Discord channel via an incoming webhook. Optional:
// with DISCORD_WEBHOOK_URL unset this is a no-op, so tables work fine without
// Discord configured. Fire-and-forget on purpose -- a slow or unreachable
// webhook must never delay the game loop's return to the lobby.

import type { Standing } from '@shared/protocol'

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const MEDALS = ['🥇', '🥈', '🥉']

export function postGameEndedToDiscord(opts: {
  code: string
  gameName: string
  standings: Standing[]
}) {
  if (!WEBHOOK_URL) return

  const { code, gameName, standings } = opts
  const winner = standings[0]
  if (!winner) return

  const lines = standings.map((s, i) => {
    const rank = MEDALS[i] ?? `${i + 1}.`
    const role = s.roleEmoji && s.roleName ? ` — ${s.roleEmoji} ${s.roleName}` : ''
    return `${rank} **${s.name}** — ${s.totalScore}${role}`
  })

  const embed = {
    title: `${gameName} finished — table ${code}`,
    description: `🏆 **${winner.name}** wins!\n\n${lines.join('\n')}`,
    color: 0xf5c518,
  }

  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  }).catch((err) => {
    console.error('[discord] failed to post game result:', err)
  })
}
