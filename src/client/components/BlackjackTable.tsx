// The Blackjack game screen. Same furniture as the other tables -- top bar,
// docked score sheet, chat in the dock -- but the center of the table is the
// dealer's hand (vs-Dealer mode only) above a row of everyone's hands, since
// Blackjack has no bidding and no tricks. Unlike every other game, hands are
// dealt and stay face up: the only hidden card in the whole game is the
// dealer's hole card, rendered as a card back until the dealer plays.

import { useEffect, useRef, useState } from 'react'
import { cardKey } from '@shared/cards'
import type { BlackjackHandPublic } from '@shared/protocol'
import { ChatPanel } from './ChatPanel'
import { EmoteBar } from './EmoteBar'
import { EmoteLayer } from './EmoteLayer'
import { GameAnnouncer } from './GameAnnouncer'
import { GameEnd } from './GameEnd'
import { BlackjackScoresheet } from './BlackjackScoresheet'
import { CardBack, PlayingCard } from './PlayingCard'
import { SettingsMenu } from './SettingsMenu'
import { useScoresheetShortcut } from '../useScoresheetShortcut'
import { dealIn, flipIn } from '../animation'
import { useEnterAnimation } from '../useEnterAnimation'
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

  useScoresheetShortcut(() => setScoresOpen((open) => !open))

  useEffect(() => {
    if (chatOpen) actions.markChatRead()
  }, [chatOpen, store.chat.length, actions])

  const bj = store.blackjack
  const order = store.order.length > 0 ? store.order : store.turnOrder
  const players = order.map((id) => ({ id, name: store.names[id] ?? 'Player' }))

  // Which dealer slots have been showing a card BACK. Blackjack's one hidden
  // card is the hole card, and "was a back a moment ago" is the only thing
  // that separates a card being turned over from a card being dealt -- both
  // are just a new card appearing in the array. Slot index alone won't do it:
  // the hole card's position is a convention, not a guarantee.
  const wasFaceDown = useRef(new Set<number>())
  ;(bj.dealerHand ?? []).forEach((card, i) => {
    if (card == null) wasFaceDown.current.add(i)
  })

  const onDealerEnter = useEnterAnimation(
    (bj.dealerHand ?? []).flatMap((card, i) => (card ? [`dealer-${i}-${cardKey(card)}`] : [])),
  )
  const onHandEnter = useEnterAnimation(
    players.flatMap((player) =>
      (bj.hands[player.id]?.cards ?? []).map((card, i) => `${player.id}-${i}-${cardKey(card)}`),
    ),
  )

  const myId = store.meId
  const isMyTurn = bj.currentTurnId != null && bj.currentTurnId === myId
  const myHand = myId ? bj.hands[myId] : undefined
  const canDouble = isMyTurn && myHand != null && myHand.cards.length === 2 && !myHand.doubled

  return (
    <div className="table">
      <GameAnnouncer store={store} />

      <EmoteLayer
        emotes={store.emotes}
        names={store.names}
        onDismiss={actions.dismissEmote}
      />

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
                  card ? (
                    <span
                      key={i}
                      className="card-flight"
                      ref={onDealerEnter(`dealer-${i}-${cardKey(card)}`, (el) =>
                        wasFaceDown.current.has(i) ? flipIn(el) : dealIn(el, i),
                      )}
                    >
                      <PlayingCard card={card} />
                    </span>
                  ) : (
                    <CardBack key={i} />
                  ),
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
                  data-player-id={player.id}
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
                      <span
                        key={i}
                        className="card-flight"
                        ref={onHandEnter(`${player.id}-${i}-${cardKey(card)}`, (el) =>
                          dealIn(el, i),
                        )}
                      >
                        <PlayingCard card={card} />
                      </span>
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
        {!store.spectating && <EmoteBar onEmote={actions.sendEmote} />}
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
        <GameEnd standings={store.standings} lowestWins={store.lowestWins} tournament={store.tournamentEnded} />
      )}
    </div>
  )
}
