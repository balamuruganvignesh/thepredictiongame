// The Blackjack game screen. Same furniture as the other tables -- top bar,
// docked score sheet, chat in the dock -- but the center of the table is the
// dealer's hand (vs-Dealer mode only) above a row of everyone's hands, since
// Blackjack has no bidding and no tricks. Unlike every other game, hands are
// dealt and stay face up: the only hidden card in the whole game is the
// dealer's hole card, rendered as a card back until the dealer plays.

import { useEffect, useState } from 'react'
import type { BlackjackHandPublic } from '@shared/protocol'
import { ChatPanel } from './ChatPanel'
import { GameEnd } from './GameEnd'
import { BlackjackScoresheet } from './BlackjackScoresheet'
import { CardBack, PlayingCard } from './PlayingCard'
import { SettingsMenu } from './SettingsMenu'
import type { GameActions, Store } from '../useGame'

const isWideScreen = () => window.matchMedia('(min-width: 1100px)').matches

function handBadge(hand: BlackjackHandPublic | undefined): string | null {
  if (!hand) return null
  if (hand.blackjack) return 'BLACKJACK!'
  if (hand.busted) return 'BUST'
  if (hand.done) return 'STAND'
  return null
}

export function BlackjackTable({ store, actions }: { store: Store; actions: GameActions }) {
  const [scoresOpen, setScoresOpen] = useState(isWideScreen)
  const [chatOpen, setChatOpen] = useState(false)

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

  const bj = store.blackjack
  const order = store.order.length > 0 ? store.order : store.turnOrder
  const players = order.map((id) => ({ id, name: store.names[id] ?? 'Player' }))

  const myId = store.meId
  const isMyTurn = bj.currentTurnId != null && bj.currentTurnId === myId
  const myHand = myId ? bj.hands[myId] : undefined
  const canDouble = isMyTurn && myHand != null && myHand.cards.length === 2 && !myHand.doubled

  return (
    <div className="table">
      <div className="topbar">
        <div className="topbar__info">
          <span className="topbar__trump" title="round">
            🂡
          </span>
          <span className="topbar__round">
            Round {bj.roundNumber} / {bj.totalRounds}
          </span>
          <span className="topbar__hand">
            {bj.currentTurnId
              ? `${store.names[bj.currentTurnId] ?? 'Player'}'s turn`
              : bj.mode === 'dealer'
                ? 'dealer plays…'
                : 'settling the round…'}
          </span>
        </div>

        {players.map((player) => (
          <div
            key={player.id}
            className={`chip${player.id === bj.currentTurnId ? ' chip--turn' : ''}`}
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
        <BlackjackScoresheet
          players={players}
          history={store.history}
          totals={store.totals}
          currentRound={bj.roundNumber}
          totalRounds={bj.totalRounds}
          onClose={() => setScoresOpen(false)}
        />
      )}

      <main className="table__center">
        <div className="blackjack-board">
          {bj.mode === 'dealer' && (
            <div className="note blackjack-dealer">
              <span className="blackjack-dealer__name">DEALER</span>
              <div className="blackjack-hand">
                {(bj.dealerHand ?? []).map((card, i) =>
                  card ? <PlayingCard key={i} card={card} /> : <CardBack key={i} />,
                )}
              </div>
              <span className="blackjack-dealer__total">
                {bj.dealerTotal != null &&
                  (bj.dealerBusted ? `${bj.dealerTotal} — BUST` : bj.dealerTotal)}
              </span>
            </div>
          )}

          <div className="blackjack-hands">
            {players.map((player) => {
              const hand = bj.hands[player.id]
              const badge = handBadge(hand)
              return (
                <div
                  key={player.id}
                  className={`note blackjack-panel${
                    player.id === bj.currentTurnId ? ' blackjack-panel--turn' : ''
                  }`}
                >
                  <span className="blackjack-panel__name">
                    {player.name}
                    {player.id === myId && ' (you)'}
                  </span>
                  <div className="blackjack-hand">
                    {(hand?.cards ?? []).map((card, i) => (
                      <PlayingCard key={i} card={card} />
                    ))}
                  </div>
                  <span className="blackjack-panel__total">
                    {hand && (hand.soft ? `${hand.total} (soft)` : hand.total)}
                    {hand?.doubled && ' ×2'}
                  </span>
                  {badge && <span className="blackjack-panel__badge">{badge}</span>}
                  <span className="blackjack-panel__score">{store.totals[player.id] ?? 0} pts</span>
                </div>
              )
            })}
          </div>
        </div>
      </main>

      {isMyTurn && (
        <div className="blackjack-actions">
          <button
            type="button"
            className="button button--accent"
            onClick={() => actions.blackjackAction('hit')}
          >
            HIT
          </button>
          <button type="button" className="button" onClick={() => actions.blackjackAction('stand')}>
            STAND
          </button>
          {canDouble && (
            <button
              type="button"
              className="button"
              onClick={() => actions.blackjackAction('double')}
            >
              DOUBLE
            </button>
          )}
        </div>
      )}

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

      {store.view === 'gameover' && store.standings && (
        <GameEnd standings={store.standings} lowestWins={store.lowestWins} />
      )}
    </div>
  )
}
