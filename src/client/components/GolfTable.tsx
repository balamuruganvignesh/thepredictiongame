// The Golf game screen. Same furniture as the other two tables -- top bar,
// docked score sheet, chat in the dock -- but the center of the table is a
// board of everyone's grids plus the stock/discard piles, since Golf has no
// bidding and no tricks. The one thing genuinely different from every other
// table: nobody sees their own face-down cards either, so a player's own
// grid renders exactly like everyone else's -- real cards where revealed,
// card backs everywhere else.

import { useEffect, useMemo, useState } from 'react'
import { GolfConfig } from '@shared/config'
import type { Card } from '@shared/cards'
import type { GolfResolveAction } from '@shared/protocol'
import { ChatPanel } from './ChatPanel'
import { GameEnd } from './GameEnd'
import { GolfScoresheet } from './GolfScoresheet'
import { CardBack, DeckStack, PlayingCard } from './PlayingCard'
import { SettingsMenu } from './SettingsMenu'
import type { GameActions, Store } from '../useGame'

const isWideScreen = () => window.matchMedia('(min-width: 1100px)').matches

export function GolfTable({ store, actions }: { store: Store; actions: GameActions }) {
  const [scoresOpen, setScoresOpen] = useState(isWideScreen)
  const [chatOpen, setChatOpen] = useState(false)
  const [resolveMode, setResolveMode] = useState<'swap' | 'flip'>('swap')
  const [revealPicks, setRevealPicks] = useState<number[]>([])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      if (event.target instanceof HTMLInputElement) return
      event.preventDefault()
      setScoresOpen((open) => !open)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (chatOpen) actions.markChatRead()
  }, [chatOpen, store.chat.length, actions])

  const golf = store.golf
  // A fresh hole (or a fresh drawn card) starts these choices over.
  useEffect(() => setRevealPicks([]), [golf.holeNumber])
  useEffect(() => setResolveMode('swap'), [golf.pendingDraw])

  const order = store.order.length > 0 ? store.order : store.turnOrder
  const nameFor = (id: string) => store.names[id] ?? 'Player'
  const players = useMemo(
    () => order.map((id) => ({ id, name: store.names[id] ?? 'Player' })),
    [order, store.names],
  )

  const myId = store.meId
  const emptyGrid: (Card | null)[] = new Array(6).fill(null)
  const myGrid = (myId ? golf.grids[myId] : undefined) ?? emptyGrid
  const myRevealedCount = myGrid.filter((c) => c != null).length
  const needsInitialReveal = !store.spectating && store.phase === 'passing' && myRevealedCount < 2
  const isMyTurn = golf.currentTurnId != null && golf.currentTurnId === myId
  const awaitingMyResolve = isMyTurn && golf.awaitingResolve && golf.pendingDraw != null
  const canDraw = isMyTurn && !golf.awaitingResolve && !needsInitialReveal

  const toggleRevealPick = (slot: number) => {
    setRevealPicks((current) => {
      if (current.includes(slot)) return current.filter((s) => s !== slot)
      return current.length >= 2 ? current : [...current, slot]
    })
  }

  const confirmReveal = () => {
    if (revealPicks.length !== 2) return
    actions.revealInitial([revealPicks[0], revealPicks[1]])
  }

  const resolveSlot = (i: number, faceDown: boolean) => {
    const action: GolfResolveAction =
      resolveMode === 'flip' ? { type: 'discardAndFlip', slot: i } : { type: 'swap', slot: i }
    if (resolveMode === 'flip' && !faceDown) return
    actions.golfResolve(action)
  }

  return (
    <div className="table">
      <div className="topbar">
        <div className="topbar__info">
          <span className="topbar__trump" title="hole">
            ⛳
          </span>
          <span className="topbar__round">
            Hole {golf.holeNumber} / {GolfConfig.totalHoles}
          </span>
          <span className="topbar__hand">
            {golf.finalLap
              ? 'Last lap!'
              : golf.currentTurnId
                ? `${nameFor(golf.currentTurnId)}'s turn`
                : 'flipping starting cards…'}
          </span>
        </div>

        {players.map((player) => (
          <div
            key={player.id}
            className={`chip${player.id === golf.currentTurnId ? ' chip--turn' : ''}`}
            title={`${player.name}: ${store.totals[player.id] ?? 0} total`}
          >
            <span className="chip__name">{player.name}</span>
            <span className="chip__score">
              <span key={store.totals[player.id]} className="score-pop">
                {store.totals[player.id] ?? 0}
              </span>
            </span>
          </div>
        ))}
      </div>

      {scoresOpen && (
        <GolfScoresheet
          players={players}
          history={store.history}
          totals={store.totals}
          currentHole={golf.holeNumber}
          onClose={() => setScoresOpen(false)}
        />
      )}

      <main className="table__center">
        <div className="golf-board">
          <div className="golf-piles">
            <div className="golf-pile">
              <span className="golf-pile__label">stock</span>
              {golf.stockCount > 0 ? (
                <button
                  type="button"
                  className="golf-pile__button"
                  disabled={!canDraw}
                  onClick={() => actions.golfDraw('stock')}
                  aria-label="Draw from the stock"
                >
                  <DeckStack />
                </button>
              ) : (
                <div className="golf-pile__empty">—</div>
              )}
              <span className="golf-pile__count">{golf.stockCount} left</span>
            </div>

            <div className="golf-pile">
              <span className="golf-pile__label">discard</span>
              {golf.discardTop ? (
                <button
                  type="button"
                  className="golf-pile__button"
                  disabled={!canDraw}
                  onClick={() => actions.golfDraw('discard')}
                  aria-label="Take the discard pile's top card"
                >
                  <PlayingCard card={golf.discardTop} />
                </button>
              ) : (
                <div className="golf-pile__empty">empty</div>
              )}
              <span className="golf-pile__count">&nbsp;</span>
            </div>
          </div>

          <div className="golf-grids">
            {players.map((player) => {
              const grid = golf.grids[player.id] ?? emptyGrid
              return (
                <div
                  key={player.id}
                  className={`note golf-panel${player.id === golf.currentTurnId ? ' golf-panel--turn' : ''}`}
                >
                  <span className="golf-panel__name">
                    {player.name}
                    {player.id === myId && ' (you)'}
                  </span>
                  <div className="golf-grid">
                    {grid.map((card, i) => (
                      <div key={i}>{card ? <PlayingCard card={card} /> : <CardBack />}</div>
                    ))}
                  </div>
                  <span className="golf-panel__score">{store.totals[player.id] ?? 0} pts</span>
                </div>
              )
            })}
          </div>
        </div>
      </main>

      {canDraw && <p className="turn-banner">YOUR TURN — draw from the stock or discard pile</p>}
      {golf.finalLap && !isMyTurn && <p className="turn-banner">🏁 LAST LAP</p>}

      {store.spectating && (
        <p className="turn-banner turn-banner--spectating">
          👁 SPECTATING — you'll be seated when this game ends
        </p>
      )}

      <div className="dock">
        <SettingsMenu
          scoresOpen={scoresOpen}
          onToggleScores={() => setScoresOpen((open) => !open)}
          restart={store.restart}
          meId={store.meId}
          spectating={store.spectating}
          onVoteRestart={actions.voteRestart}
        />
        <button className="dock__button" onClick={() => setChatOpen((open) => !open)}>
          CHAT
          {store.unreadChat > 0 && !chatOpen && (
            <span className="dock__badge">{store.unreadChat > 9 ? '9+' : store.unreadChat}</span>
          )}
        </button>
      </div>

      {chatOpen && (
        <ChatPanel
          messages={store.chat}
          meId={store.meId}
          onSend={actions.sendChat}
          onClose={() => setChatOpen(false)}
        />
      )}

      {needsInitialReveal && (
        <div className="backdrop backdrop--bidding">
          <div
            className="note modal modal--pass"
            role="dialog"
            aria-modal="true"
            aria-label="Pick your starting cards"
          >
            <header className="note__header modal__title">FLIP TWO CARDS</header>
            <p className="modal__round">
              pick 2 of your 6 to see before play begins — {revealPicks.length}/2 picked
            </p>
            <div className="golf-grid golf-grid--interactive">
              {myGrid.map((_, i) => {
                const picked = revealPicks.includes(i)
                return (
                  <button
                    key={i}
                    type="button"
                    className={`card-button ${picked ? 'card-button--picked' : 'card-button--playable'}`}
                    onClick={() => toggleRevealPick(i)}
                    aria-pressed={picked}
                    aria-label={`Flip card ${i + 1}`}
                  >
                    <CardBack />
                  </button>
                )
              })}
            </div>
            <button
              className="button button--accent"
              onClick={confirmReveal}
              disabled={revealPicks.length !== 2}
            >
              {revealPicks.length === 2 ? 'FLIP THESE TWO' : `PICK ${2 - revealPicks.length} MORE`}
            </button>
          </div>
        </div>
      )}

      {awaitingMyResolve && golf.pendingDraw && (
        <div className="backdrop backdrop--bidding">
          <div
            className="note modal modal--pass"
            role="dialog"
            aria-modal="true"
            aria-label="Place your drawn card"
          >
            <header className="note__header modal__title">YOU DREW</header>
            <div className="golf-resolve__card">
              <PlayingCard card={golf.pendingDraw.card} />
              <span className="golf-resolve__card-label">from the {golf.pendingDraw.source}</span>
            </div>

            {golf.pendingDraw.source === 'stock' && (
              <div className="golf-resolve__hint">
                <button
                  type="button"
                  className={`button ${resolveMode === 'swap' ? 'button--accent' : ''}`}
                  onClick={() => setResolveMode('swap')}
                >
                  SWAP IN
                </button>
                <button
                  type="button"
                  className={`button ${resolveMode === 'flip' ? 'button--accent' : ''}`}
                  onClick={() => setResolveMode('flip')}
                >
                  DISCARD &amp; FLIP
                </button>
              </div>
            )}

            <p className="modal__round">
              {resolveMode === 'swap'
                ? 'pick a slot to swap it into'
                : 'pick a face-down card to reveal instead'}
            </p>

            <div className="golf-grid golf-grid--interactive">
              {myGrid.map((card, i) => {
                const faceDown = card == null
                const disabled = resolveMode === 'flip' && !faceDown
                return (
                  <button
                    key={i}
                    type="button"
                    className={`card-button ${disabled ? 'card-button--muted' : 'card-button--playable'}`}
                    disabled={disabled}
                    onClick={() => resolveSlot(i, faceDown)}
                    aria-label={`${resolveMode === 'swap' ? 'Swap into' : 'Flip'} card ${i + 1}`}
                  >
                    {card ? <PlayingCard card={card} /> : <CardBack />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {store.view === 'gameover' && store.standings && (
        <GameEnd standings={store.standings} lowestWins={store.lowestWins} />
      )}
    </div>
  )
}
