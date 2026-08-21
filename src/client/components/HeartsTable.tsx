// The Hearts game screen. Same furniture as the Prediction Game's table -- top
// bar, docked score sheet, trick in the middle, hand along the bottom, chat in
// the dock -- with the bidding modal replaced by the pass, and no roles.

import { useEffect, useMemo, useState } from 'react'
import type { Card } from '@shared/cards'
import { isLegalHeartsPlay } from '@shared/heartsRules'
import { ChatPanel } from './ChatPanel'
import { EmoteBar } from './EmoteBar'
import { EmoteLayer } from './EmoteLayer'
import { GameAnnouncer } from './GameAnnouncer'
import { ReplayViewer } from './ReplayViewer'
import { GameEnd } from './GameEnd'
import { Hand } from './Hand'
import { HeartsScoresheet } from './HeartsScoresheet'
import { HeartsTopBar } from './HeartsTopBar'
import { PassModal, PassWaiting } from './PassModal'
import { SettingsMenu } from './SettingsMenu'
import { TrickArea } from './TrickArea'
import { useScoresheetShortcut } from '../useScoresheetShortcut'
import type { GameActions, Store } from '../useGame'

const isWideScreen = () => window.matchMedia('(min-width: 1100px)').matches

export function HeartsTable({ store, actions }: { store: Store; actions: GameActions }) {
  const [scoresOpen, setScoresOpen] = useState(isWideScreen)
  const [chatOpen, setChatOpen] = useState(false)
  const [replayOpen, setReplayOpen] = useState(false)

  useScoresheetShortcut(() => setScoresOpen((open) => !open))

  useEffect(() => {
    if (chatOpen) actions.markChatRead()
  }, [chatOpen, store.chat.length, actions])

  const order = store.order.length > 0 ? store.order : store.turnOrder
  const nameFor = (id: string) => store.names[id] ?? 'Player'

  const players = useMemo(
    () => order.map((id) => ({ id, name: store.names[id] ?? 'Player' })),
    [order, store.names],
  )

  const { hearts } = store
  const isMyTurn = store.currentTurnId != null && store.currentTurnId === store.meId

  // The client's legality must match the server's exactly, so it comes from the
  // same shared function with the same context.
  const isPlayable = (card: Card, hand: Card[]) =>
    isLegalHeartsPlay(card, hand, {
      leadSuit: store.leadSuit,
      heartsBroken: hearts.heartsBroken,
      isFirstTrick: hearts.isFirstTrick,
      mustLeadCard: store.leadSuit == null ? hearts.mustLeadCard : null,
    })

  return (
    <div className="table">
      <GameAnnouncer store={store} />

      <EmoteLayer
        emotes={store.emotes}
        names={store.names}
        onDismiss={actions.dismissEmote}
      />

      <HeartsTopBar
        roundNumber={store.roundNumber}
        trickNumber={store.trickNumber}
        totalTricks={store.totalTricks}
        heartsBroken={hearts.heartsBroken}
        targetScore={hearts.targetScore}
        profiles={store.profiles}
        players={players.map((player) => ({
          ...player,
          penalty: hearts.penalties[player.id] ?? 0,
          total: store.totals[player.id] ?? 0,
          isTurn: player.id === store.currentTurnId,
        }))}
      />

      {scoresOpen && (
        <HeartsScoresheet
          players={players}
          history={store.history}
          totals={store.totals}
          currentRound={store.roundNumber}
          targetScore={hearts.targetScore}
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

      {store.spectating ? (
        <p className="turn-banner turn-banner--spectating">
          👁 SPECTATING — you'll be seated when this game ends
        </p>
      ) : (
        <Hand
          hand={store.hand}
          isMyTurn={isMyTurn && store.phase === 'playing'}
          leadSuit={store.leadSuit}
          isPlayable={isPlayable}
          onPlay={actions.playCard}
        />
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
        />
      )}

      {/* The pass: the modal while you still owe three cards, then a waiting
          state, because everyone chooses at once rather than in turn. */}
      {store.phase === 'passing' && !store.spectating && hearts.direction !== 'none' && (
        hearts.passPending ? (
          <PassModal
            hand={store.hand}
            direction={hearts.direction}
            toName={hearts.passToId ? nameFor(hearts.passToId) : null}
            onPass={actions.passCards}
          />
        ) : (
          <PassWaiting direction={hearts.direction} />
        )
      )}

      {store.view === 'gameover' && store.standings && (
        <GameEnd standings={store.standings} lowestWins={store.lowestWins} tournament={store.tournamentEnded} />
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
