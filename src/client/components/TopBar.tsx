// Top-of-screen game bar: a round/hand info block with the trump glyph, then
// one chip per player showing live "tricks won / bid". Chips go green when a
// player is exactly on their bid and red when they've missed it (or haven't
// reached it yet); the current turn's chip gets an accent ring.

import { TOTAL_ROUNDS } from '@shared/config'
import { trumpGlyph } from '../useGame'
import { Avatar } from './Avatar'

export type ChipData = {
  id: string
  name: string
  bid: number | null
  won: number
  isTurn: boolean
}

type Props = {
  roundNumber: number
  trickNumber: number
  totalTricks: number
  trumpSuit: string
  /** Per-player profile logos, keyed by player id. See useGame's `profiles`. */
  profiles: Record<string, { avatar?: string; avatarUrl?: string }>
  players: ChipData[]
}

export function TopBar({ roundNumber, trickNumber, totalTricks, trumpSuit, players, profiles }: Props) {
  const isRedTrump = trumpSuit === 'Hearts' || trumpSuit === 'Diamonds'

  return (
    <div className={`topbar${players.length >= 7 ? ' topbar--big' : ''}`}>
      <div className="topbar__info">
        <span
          className={`topbar__trump${trumpSuit === 'NoTrump' ? ' topbar__trump--nt' : ''}`}
          style={isRedTrump ? { color: '#eb6064' } : undefined}
        >
          {trumpGlyph(trumpSuit)}
        </span>
        <span className="topbar__round">
          Round {roundNumber}/{TOTAL_ROUNDS}
        </span>
        <span className="topbar__hand">
          {trickNumber > 0 ? `Hand ${trickNumber} of ${totalTricks}` : 'Bidding…'}
        </span>
      </div>

      {players.map((player) => {
        const onTarget = player.bid != null && player.won === player.bid
        return (
          <div
            key={player.id}
            data-player-id={player.id}
            className={`chip${player.isTurn ? ' chip--turn' : ''}`}
            title={`${player.name}: ${player.won} won / ${player.bid ?? '—'} bid`}
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
            <span
              className={`chip__score${
                player.bid == null ? ' chip__score--none' : onTarget ? ' is-good' : ' is-bad'
              }`}
            >
              <span key={`${player.won}-${player.bid}`} className="score-pop">
                {player.bid == null ? '—' : `${player.won} / ${player.bid}`}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
