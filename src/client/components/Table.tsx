// The game screen: top bar, docked score sheet, the trick in the middle, your
// hand along the bottom, and the modals that take over when it's your move.
// This is the layout half of the client; the state half lives in useGame.

import { useEffect, useMemo, useState } from 'react'
import type { Card } from '@shared/cards'
import { BiddingModal, type BidRow } from './BiddingModal'
import { ChatPanel } from './ChatPanel'
import { DeckToggleButton } from './DeckToggle'
import { GameEnd } from './GameEnd'
import { Hand } from './Hand'
import { RoleBanner } from './RoleBanner'
import { QuickAbility } from './QuickAbility'
import { RebidModal } from './RebidModal'
import { RestartVoteButton } from './RestartVote'
import { RolePanel } from './RolePanel'
import { Scoreboard } from './Scoreboard'
import { TopBar, type ChipData } from './TopBar'
import { TrickArea } from './TrickArea'
import type { GameActions, Store } from '../useGame'

const isWideScreen = () => window.matchMedia('(min-width: 1100px)').matches

export function Table({ store, actions }: { store: Store; actions: GameActions }) {
  // The score sheet is open by default on desktop and opened on demand on
  // phones, where it would otherwise eat the table.
  const [scoresOpen, setScoresOpen] = useState(isWideScreen)
  const [chatOpen, setChatOpen] = useState(false)
  const [roleOpen, setRoleOpen] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(0)

  // Tab toggles the score sheet. Skipped while the caret is in a text field,
  // so typing in chat doesn't flip panels.
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

  // Opening the chat clears the unread badge.
  useEffect(() => {
    if (chatOpen) actions.markChatRead()
  }, [chatOpen, store.chat.length, actions])

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
      <TopBar
        roundNumber={store.roundNumber}
        trickNumber={store.trickNumber}
        totalTricks={store.totalTricks}
        trumpSuit={store.trumpSuit}
        players={chips}
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
          />
        ) : (
          store.phase == null &&
          store.view === 'game' && <p className="table__interlude">shuffling the next round…</p>
        )}
      </main>

      {isMyTurn && store.phase === 'playing' && <p className="turn-banner">YOUR TURN</p>}

      {/* Spectators have no hand to render -- they watch the trick area and the
          score sheet, and get a chair when this game ends. */}
      {store.spectating ? (
        <p className="turn-banner turn-banner--spectating">
          👁 SPECTATING — you'll be seated when this game ends
        </p>
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

      {/* Fire the ability without the modal covering the trick. Sits just above
          the dock; the full panel is still a tap away for the ones that need
          more room. */}
      {chaosActive && !store.spectating && store.roleState && (
        <QuickAbility
          roleState={store.roleState}
          players={players}
          meId={store.meId}
          onUse={actions.useAbility}
          onOpenPanel={() => setRoleOpen(true)}
        />
      )}

      <div className="dock">
        {/* No ROLE button here: QuickAbility above the dock is the one door to
            the ability AND to the panel, so there's only ever one thing to
            press. */}
        <button className="dock__button" onClick={() => setChatOpen((open) => !open)}>
          CHAT
          {store.unreadChat > 0 && !chatOpen && (
            <span className="dock__badge">{store.unreadChat > 9 ? '9+' : store.unreadChat}</span>
          )}
        </button>
        <button className="dock__button" onClick={() => setScoresOpen((open) => !open)}>
          SCORES
        </button>
        <DeckToggleButton />
        {/* Ends the game early by majority vote, so people waiting as
            spectators get a chair without the game being played out. */}
        <RestartVoteButton
          restart={store.restart}
          meId={store.meId}
          spectating={store.spectating}
          onVote={actions.voteRestart}
        />
      </div>

      {chatOpen && (
        <ChatPanel
          messages={store.chat}
          meId={store.meId}
          onSend={actions.sendChat}
          onClose={() => setChatOpen(false)}
        />
      )}

      {store.phase === 'bidding' && !store.spectating && (
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

      {store.view === 'gameover' && store.standings && <GameEnd standings={store.standings} />}
    </div>
  )
}
