// Spades' version of the top bar. The glyph slot carries the broken-spades
// state; each chip shows this player's tricks won over their bid (Nil shown
// as "Nil"), colored by team rather than individually -- what matters in
// Spades is the PARTNERSHIP's number, not any one seat's.

import type { SpadesBid } from '@shared/spadesRules'
import { Avatar } from './Avatar'

type Props = {
  handNumber: number
  trickNumber: number
  totalTricks: number
  spadesBroken: boolean
  targetScore: number
  bags: [number, number]
  players: {
    id: string
    name: string
    team: 0 | 1
    bid: SpadesBid | null
    tricksWon: number
    isTurn: boolean
  }[]
  /** Per-player profile logos, keyed by player id. See useGame's `profiles`. */
  profiles: Record<string, { avatar?: string; avatarUrl?: string }>
}

export function SpadesTopBar({
  handNumber,
  trickNumber,
  totalTricks,
  spadesBroken,
  targetScore,
  bags,
  players,
  profiles,
}: Props) {
  return (
    <div className={`topbar${players.length >= 7 ? ' topbar--big' : ''}`}>
      <div className="topbar__info">
        <span
          className="topbar__trump"
          style={{ opacity: spadesBroken ? 1 : 0.45 }}
          title={spadesBroken ? 'spades are broken' : 'spades not broken yet'}
        >
          ♠️
        </span>
        <span className="topbar__round">
          Hand {handNumber} · to {targetScore}
        </span>
        <span className="topbar__hand" title="Bags: every 10 costs a team 100 points">
          {trickNumber > 0 ? `Trick ${trickNumber} of ${totalTricks}` : 'Bidding…'} · bags {bags[0]}·
          {bags[1]}
        </span>
      </div>

      {players.map((player) => (
        <div
          key={player.id}
          data-player-id={player.id}
          className={`chip${player.isTurn ? ' chip--turn' : ''} chip--team${player.team}`}
          title={`${player.name} (team ${player.team === 0 ? 'A' : 'B'}): ${player.tricksWon} tricks, bid ${
            player.bid == null ? '—' : player.bid === 'nil' ? 'Nil' : player.bid
          }`}
        >
          <span className="chip__id">
            <Avatar
              playerId={player.id}
              name={player.name}
              avatar={profiles[player.id]?.avatar}
              avatarUrl={profiles[player.id]?.avatarUrl}
              size="sm"
            />
            <span className="chip__name">{player.name}</span>
          </span>
          <span className="chip__score">
            <span key={player.tricksWon} className="score-pop">
              {player.tricksWon}/{player.bid == null ? '?' : player.bid === 'nil' ? 'Nil' : player.bid}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
