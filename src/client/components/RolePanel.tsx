// Chaos mode's role modal: your secret role and this round's rolled ability,
// with target / direction pickers and a USE button. Opened from the docked ROLE
// button; invisible in classic mode, so the base UI is untouched.

import { useEffect, useState } from 'react'
import * as RoleDefs from '@shared/roleDefs'
import type { Card, Suit } from '@shared/cards'
import { cardKey } from '@shared/cards'
import type { RoleState, UseAbilityPayload } from '@shared/protocol'
import { PlayingCard, cardLabel } from './PlayingCard'

/** The suits Fortune can name -- no Jokers, they aren't a suit anyone bids around. */
const SUITS: { suit: Suit; glyph: string }[] = [
  { suit: 'Spades', glyph: '♠' },
  { suit: 'Diamonds', glyph: '♦' },
  { suit: 'Clubs', glyph: '♣' },
  { suit: 'Hearts', glyph: '♥' },
]

type Props = {
  roleState: RoleState
  /** The whole table, in the same fixed order as the top bar / score sheet. */
  players: { id: string; name: string }[]
  meId: string | null
  /** Your own hand -- Time Branches picks the card to put back. */
  hand: Card[]
  lastResult: string | null
  onUse: (payload: UseAbilityPayload) => void
  onClose: () => void
}

export function RolePanel({ roleState, players, meId, hand, lastResult, onUse, onClose }: Props) {
  const role = RoleDefs.getRole(roleState.roleId)
  const def = RoleDefs.getAbility(roleState.abilityId)

  const [selected, setSelected] = useState<string[]>([])
  const [direction, setDirection] = useState<1 | -1>(1)
  const [suit, setSuit] = useState<Suit | null>(null)
  const [peek, setPeek] = useState<'high' | 'low' | null>(null)
  const [scope, setScope] = useState<'one' | 'all' | null>(null)
  const [pickedRole, setPickedRole] = useState<string | null>(null)
  const [pickedCard, setPickedCard] = useState<string | null>(null)
  const [nag, setNag] = useState(false)

  // A new ability (new round, or a retry that kept it live) clears the pickers.
  // Alternate Universe relies on this: it swaps abilityId out from under the
  // panel without spending the turn, and the new ability's pickers must be
  // empty rather than carrying the role you just named.
  useEffect(() => {
    setSelected([])
    setSuit(null)
    setPeek(null)
    setScope(null)
    setPickedRole(null)
    setPickedCard(null)
    setNag(false)
  }, [roleState.abilityId, roleState.used, lastResult])

  if (!role) return null

  // A scoped ability targets nobody until you say ONE PLAYER -- picking
  // EVERYONE is the whole answer on its own, so the target picker stays shut.
  const scoped = def?.extra === 'scope'
  const needed = scoped
    ? scope === 'one'
      ? 1
      : 0
    : def?.target === 'two'
      ? 2
      : def?.target === 'other' || def?.target === 'any'
        ? 1
        : 0
  // "any" abilities can be aimed at yourself, so you stay in the picker.
  const pickable = def?.target === 'any' ? players : players.filter((p) => p.id !== meId)

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id)
      const next = [...current, id]
      // Keep only the most recent `needed` picks.
      return next.slice(Math.max(0, next.length - needed))
    })
  }

  const use = () => {
    if (roleState.used) return
    // Every picker the ability shows has to be answered before it fires --
    // the server rejects a half-filled payload anyway.
    if (
      selected.length < needed ||
      (def?.extra === 'suit' && !suit) ||
      (def?.extra === 'peek' && !peek) ||
      (def?.extra === 'role' && !pickedRole) ||
      (def?.extra === 'card' && !pickedCard) ||
      (scoped && !scope)
    ) {
      setNag(true)
      return
    }
    setNag(false)
    onUse({
      targetId: selected[0],
      targetId2: selected[1],
      direction,
      suit: suit ?? undefined,
      peek: peek ?? undefined,
      scope: scope ?? undefined,
      roleId: pickedRole ?? undefined,
      cardKey: pickedCard ?? undefined,
    })
  }

  return (
    <div className="backdrop" onClick={onClose} role="presentation">
      <div
        className="note modal modal--role"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Your role"
      >
        <header className="note__header modal__title" style={{ color: role.color }}>
          {role.emoji} {role.name.toUpperCase()}
          <button className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <p className="role__tagline">{role.tagline} — your role is secret. use it well.</p>

        <p className="role__kicker">
          {role.abilities.length > 1 ? "THIS ROUND'S ABILITY" : 'YOUR PERMANENT ABILITY'}
        </p>
        <h3 className="role__ability">{def?.name ?? '—'}</h3>
        <p className="role__desc">{def?.desc}</p>
        {def?.note && <p className="role__note">⚙️ {def.note}</p>}

        {scoped && !roleState.used && (
          <>
            <p className={`role__picker-label${nag && !scope ? ' is-nagging' : ''}`}>
              {nag && !scope ? 'call it first!' : 'who sees it'}
            </p>
            <div className="role__extra">
              {(['one', 'all'] as const).map((option) => (
                <button
                  key={option}
                  className={`role__target${scope === option ? ' is-selected' : ''}`}
                  onClick={() => {
                    setScope(option)
                    // EVERYONE takes no target; drop anything already picked so
                    // a stale selection can't ride along in the payload.
                    if (option === 'all') setSelected([])
                  }}
                >
                  {option === 'one' ? 'ONE PLAYER' : 'EVERYONE'}
                </button>
              ))}
            </div>
          </>
        )}

        {needed > 0 && !roleState.used && (
          <>
            <p
              className={`role__picker-label${nag && selected.length < needed ? ' is-nagging' : ''}`}
            >
              {nag && selected.length < needed
                ? needed === 2
                  ? 'pick TWO players first!'
                  : 'pick a target first!'
                : needed === 2
                  ? 'pick two players'
                  : 'pick a target'}
            </p>
            <div className={`role__targets${pickable.length > 6 ? ' is-big' : ''}`}>
              {pickable.map((target) => (
                <button
                  key={target.id}
                  className={`role__target${selected.includes(target.id) ? ' is-selected' : ''}`}
                  onClick={() => toggle(target.id)}
                >
                  {target.id === meId ? `${target.name} (you)` : target.name}
                </button>
              ))}
            </div>
          </>
        )}

        {def?.extra === 'direction' && !roleState.used && (
          <div className="role__direction">
            {([1, -1] as const).map((dir) => (
              <button
                key={dir}
                className={`role__target${direction === dir ? ' is-selected' : ''}`}
                onClick={() => setDirection(dir)}
              >
                {dir === 1 ? '+1' : '-1'}
              </button>
            ))}
          </div>
        )}

        {def?.extra === 'suit' && !roleState.used && (
          <>
            <p className={`role__picker-label${nag && !suit ? ' is-nagging' : ''}`}>
              {nag && !suit ? 'name a suit first!' : 'name a suit'}
            </p>
            <div className="role__extra">
              {SUITS.map((option) => (
                <button
                  key={option.suit}
                  className={`role__target${suit === option.suit ? ' is-selected' : ''}`}
                  onClick={() => setSuit(option.suit)}
                >
                  {option.glyph} {option.suit}
                </button>
              ))}
            </div>
          </>
        )}

        {def?.extra === 'peek' && !roleState.used && (
          <>
            <p className={`role__picker-label${nag && !peek ? ' is-nagging' : ''}`}>
              {nag && !peek ? 'call it first!' : 'call it'}
            </p>
            <div className="role__extra">
              {(['high', 'low'] as const).map((end) => (
                <button
                  key={end}
                  className={`role__target${peek === end ? ' is-selected' : ''}`}
                  onClick={() => setPeek(end)}
                >
                  {end === 'high' ? 'HIGHEST' : 'LOWEST'}
                </button>
              ))}
            </div>
          </>
        )}

        {def?.extra === 'role' && !roleState.used && (
          <>
            <p className={`role__picker-label${nag && !pickedRole ? ' is-nagging' : ''}`}>
              {nag && !pickedRole ? 'name a role first!' : 'name a role — you get a RANDOM one of its abilities'}
            </p>
            <div className="role__targets is-big">
              {RoleDefs.roleOrder.map((id) => {
                const option = RoleDefs.getRole(id)
                if (!option) return null
                return (
                  <button
                    key={id}
                    className={`role__target${pickedRole === id ? ' is-selected' : ''}`}
                    style={pickedRole === id ? { color: option.color } : undefined}
                    onClick={() => setPickedRole(id)}
                  >
                    {option.emoji} {option.name.replace('The ', '')}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {def?.extra === 'card' && !roleState.used && (
          <>
            <p className={`role__picker-label${nag && !pickedCard ? ' is-nagging' : ''}`}>
              {nag && !pickedCard ? 'pick a card first!' : 'pick the card to put back'}
            </p>
            <div className="role__cards">
              {hand.map((card) => {
                const key = cardKey(card)
                return (
                  <button
                    key={key}
                    type="button"
                    className={`role__card${pickedCard === key ? ' is-selected' : ''}`}
                    onClick={() => setPickedCard(key)}
                    aria-label={`Put back the ${cardLabel(card)}`}
                    aria-pressed={pickedCard === key}
                  >
                    <PlayingCard card={card} />
                  </button>
                )
              })}
            </div>
          </>
        )}

        {lastResult && <p className="role__result">{lastResult}</p>}

        <button
          className={`button ${roleState.used ? 'button--spent' : 'button--primary'} role__use`}
          onClick={use}
          disabled={roleState.used || !def}
        >
          {roleState.used ? 'USED THIS ROUND ✓' : 'USE ABILITY'}
        </button>
      </div>
    </div>
  )
}
