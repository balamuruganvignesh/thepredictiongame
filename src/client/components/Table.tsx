// The game screen: top bar, docked score sheet, the trick in the middle, your
// hand along the bottom, and the modals that take over when it's your move.
// This is the layout half of the client; the state half lives in useGame.

import { useEffect, useMemo, useState } from 'react'
import type { Card } from '@shared/cards'
import { BiddingModal, type BidRow } from './BiddingModal'
import { ChatPanel } from './ChatPanel'
import { EffectLayer } from './EffectLayer'
import { EmoteBar } from './EmoteBar'
import { EmoteLayer } from './EmoteLayer'
import { GameAnnouncer } from './GameAnnouncer'
import { ReplayViewer } from './ReplayViewer'
import { GameEnd } from './GameEnd'
import { Hand } from './Hand'
import { RoleBanner } from './RoleBanner'
import { QuickAbility } from './QuickAbility'
import { RebidModal } from './RebidModal'
import { RolePanel } from './RolePanel'
import { Scoreboard } from './Scoreboard'
import { SettingsMenu } from './SettingsMenu'
import { TopBar, type ChipData } from './TopBar'
import { TrickArea } from './TrickArea'
import { useEffectsEnabled } from '../effectsSettings'
import { useScoresheetShortcut } from '../useScoresheetShortcut'
import type { GameActions, Store } from '../useGame'

const isWideScreen = () => window.matchMedia('(min-width: 1100px)').matches

export function Table({ store, actions }: { store: Store; actions: GameActions }) {
  // The score sheet is open by default on desktop and opened on demand on
  // phones, where it would otherwise eat the table.
  const [scoresOpen, setScoresOpen] = useState(isWideScreen)
  const { enabled: effectsEnabled } = useEffectsEnabled()
  const [chatOpen, setChatOpen] = useState(false)
  const [replayOpen, setReplayOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(0)

  useScoresheetShortcut(() => setScoresOpen((open) => !open))

  // Opening the chat clears the unread badge.
  useEffect(() => {
    if (chatOpen) actions.markChatRead()
  }, [chatOpen, store.chat.length, actions])

  // The bidding phase can end the instant YOUR bid lands -- you're the last
  // to act, so the server flips everyone straight to playing. Unmounting the
  // modal that fast cuts its own chip-selection flourish off before it can
  // play a single frame, so hold it mounted a beat past the phase change
  // instead of tying its lifetime directly to store.phase.
  const [showBidding, setShowBidding] = useState(store.phase === 'bidding')
  useEffect(() => {
    if (store.phase === 'bidding') {
      setShowBidding(true)
      return
    }
    const timer = setTimeout(() => setShowBidding(false), 500)
    return () => clearTimeout(timer)
  }, [store.phase])

  // THE one display order for player lists: locked in at round 1, so the top
  // bar, score sheet, bid pills and target pickers always agree.
  const order = store.order.length > 0 ? store.order : store.turnOrder
  const nameFor = (id: string) => store.names[id] ?? 'Player'

  const players = useMemo(
    () => order.map((id) => ({ id, name: store.names[id] ?? 'Player' })),
    [order, store.names],
  )

  const chips: ChipData[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    bid: store.bids[player.id] ?? null,
    won: store.tricksWon[player.id] ?? 0,
    isTurn: player.id === store.currentTurnId,
  }))

  const isMyTurn = store.currentTurnId != null && store.currentTurnId === store.meId
  const myBid = store.meId ? (store.bids[store.meId] ?? null) : null

  const bidRows: BidRow[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    bid: store.bids[player.id] ?? null,
    isCurrentTurn: player.id === store.currentTurnId,
  }))

  // Straight from the server, NOT summed from store.bids: those may carry a
  // Judge's Imposter disguise, and a forbidden bid computed off a fake number
  // disables the wrong chip and gets the real bid rejected.
  const sumSoFar = store.bidSum
  const isLastBidder =
    store.turnOrder.length > 0 && store.turnOrder[store.turnOrder.length - 1] === store.meId

  const chaosActive = store.roleState?.active === true && store.roleState.roleId != null
  const showBanner =
    chaosActive &&
    store.roleState?.abilityId != null &&
    store.roleBannerKey > 0 &&
    store.roleBannerKey !== bannerDismissed

  const play = (card: Card) => actions.playCard(card)

  return (
    <div className="table">
      <GameAnnouncer store={store} />

      <EmoteLayer
        emotes={store.emotes}
        names={store.names}
        onDismiss={actions.dismissEmote}
      />

      <TopBar
        roundNumber={store.roundNumber}
        trickNumber={store.trickNumber}
        totalTricks={store.totalTricks}
        trumpSuit={store.trumpSuit}
        players={chips}
        profiles={store.profiles}
      />

      <EffectLayer
        effects={store.activeEffects}
        onDismiss={actions.dismissEffect}
        enabled={effectsEnabled}
      />

      {scoresOpen && (
        <Scoreboard
          players={players}
          history={store.history}
          totals={store.totals}
          currentRound={store.roundNumber}
          onClose={() => setScoresOpen(false)}
        />
      )}

      <main className="table__center">
        {store.phase === 'playing' ? (
          <TrickArea
            plays={store.plays}
            names={store.names}
            currentTurnName={store.currentTurnId ? nameFor(store.currentTurnId) : null}
            leadSuit={store.leadSuit}
            trickNumber={store.trickNumber}
            totalTricks={store.totalTricks}
            winnerId={store.trickWinnerId}
            meId={store.meId}
          />
        ) : (
          store.phase == null &&
          store.view === 'game' && <p className="table__interlude">shuffling the next round…</p>
        )}
      </main>

      {isMyTurn && store.phase === 'playing' && <p className="turn-banner">YOUR TURN</p>}

      {/* Spectators have no hand of their own, but can peek at a seated
          player's read-only -- makes waiting out a mid-game join less dead.
          They get a real chair when this game ends. */}
      {store.spectating ? (
        <div className="spectator-watch">
          <p className="turn-banner turn-banner--spectating">
            👁 SPECTATING — you'll be seated when this game ends
          </p>
          {players.length > 0 && (
            <div className="spectator-watch__picker">
              <span className="spectator-watch__label">watch a hand:</span>
              {players.map((player) => {
                const active = store.watchedSeat?.seatId === player.id
                return (
                  <button
                    key={player.id}
                    type="button"
                    className={`spectator-watch__pick${active ? ' is-active' : ''}`}
                    onClick={() => actions.watchSeat(active ? null : player.id)}
                  >
                    {player.name}
                  </button>
                )
              })}
            </div>
          )}
          {store.watchedSeat && (
            <Hand
              hand={store.watchedSeat.hand}
              isMyTurn={false}
              leadSuit={store.leadSuit}
              label={`${store.watchedSeat.name}'s hand`}
              onPlay={() => {}}
            />
          )}
        </div>
      ) : (
        /* Your bidding turn is still "your turn", but no card is playable until
           the play phase -- otherwise the whole hand lights up during bidding. */
        <Hand
          hand={store.hand}
          isMyTurn={isMyTurn && store.phase === 'playing'}
          leadSuit={store.leadSuit}
          illusionCards={store.illusionCards}
          barredCard={store.barredCard}
          onPlay={play}
        />
      )}

      {/* ROLE always opens the full panel -- your role and this round's
          ability are worth reading even before you've decided to fire it, so
          you know what card to play toward it. ABILITY (from QuickAbility)
          fires it without the modal covering the trick, and disappears once
          it's spent -- ROLE is still there to read what it did. Both sit just
          above the dock. */}
      {chaosActive && !store.spectating && store.roleState && (
        <div className="quick">
          <QuickAbility
            roleState={store.roleState}
            players={players}
            meId={store.meId}
            onUse={actions.useAbility}
            onOpenPanel={() => setRoleOpen(true)}
          />
          <button className="dock__button dock__button--role" onClick={() => setRoleOpen(true)}>
            🎭 ROLE
          </button>
        </div>
      )}

      <div className="dock">
        <SettingsMenu
          scoresOpen={scoresOpen}
          onToggleScores={() => setScoresOpen((open) => !open)}
          restart={store.restart}
          meId={store.meId}
          spectating={store.spectating}
          onVoteRestart={actions.voteRestart}
          onOpenReplay={() => {
            actions.requestReplay()
            setReplayOpen(true)
          }}
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
          raised={chaosActive && !store.spectating && store.roleState != null}
        />
      )}

      {showBidding && !store.spectating && (
        <BiddingModal
          cardsDealt={store.cardsDealt}
          trumpSuit={store.trumpSuit}
          isMyTurn={isMyTurn}
          hasBid={myBid != null}
          myBid={myBid}
          isLastBidder={isLastBidder}
          sumSoFar={sumSoFar}
          rows={bidRows}
          currentTurnName={store.currentTurnId ? nameFor(store.currentTurnId) : null}
          doubleDeadline={store.doubleDeadline}
          doubled={store.doubled}
          onBid={actions.submitBid}
          onDouble={actions.declareDouble}
        />
      )}

      {roleOpen && store.roleState && !store.spectating && (
        <RolePanel
          roleState={store.roleState}
          players={players}
          meId={store.meId}
          hand={store.hand}
          log={store.abilityLog}
          onUse={actions.useAbility}
          onClose={() => setRoleOpen(false)}
        />
      )}

      {store.rebid && !store.spectating && (
        <RebidModal
          prompt={store.rebid}
          onBid={actions.submitRebid}
          onDismiss={actions.dismissRebid}
        />
      )}

      {showBanner && !store.spectating && store.roleState?.roleId && store.roleState.abilityId && (
        <RoleBanner
          key={store.roleBannerKey}
          roleId={store.roleState.roleId}
          abilityId={store.roleState.abilityId}
          excludeHandSwap={store.roleState.handSwapUsed}
          onDismiss={() => setBannerDismissed(store.roleBannerKey)}
        />
      )}

      {store.view === 'gameover' && store.standings && (
        <GameEnd standings={store.standings} tournament={store.tournamentEnded} />
      )}
      {replayOpen && (
        <ReplayViewer
          replay={store.replay}
          onClose={() => {
            setReplayOpen(false)
            actions.closeReplay()
          }}
        />
      )}
    </div>
  )
}
