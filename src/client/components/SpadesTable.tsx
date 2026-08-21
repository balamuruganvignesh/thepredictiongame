// The Spades game screen. Same furniture as Hearts' table -- top bar, docked
// score sheet, trick in the middle, hand along the bottom, chat in the dock
// -- with the pass replaced by a Nil-capable bid, and teams instead of solo
// scoring.

import { useEffect, useMemo, useState } from 'react'
import type { Card } from '@shared/cards'
import { isLegalSpadesPlay } from '@shared/spadesRules'
import { ChatPanel } from './ChatPanel'
import { GameAnnouncer } from './GameAnnouncer'
import { GameEnd } from './GameEnd'
import { Hand } from './Hand'
import { SettingsMenu } from './SettingsMenu'
import { SpadesBidModal, type SpadesBidRow } from './SpadesBidModal'
import { SpadesScoresheet } from './SpadesScoresheet'
import { SpadesTopBar } from './SpadesTopBar'
import { TrickArea } from './TrickArea'
import { useScoresheetShortcut } from '../useScoresheetShortcut'
import type { GameActions, Store } from '../useGame'

const isWideScreen = () => window.matchMedia('(min-width: 1100px)').matches

export function SpadesTable({ store, actions }: { store: Store; actions: GameActions }) {
  const [scoresOpen, setScoresOpen] = useState(isWideScreen)
  const [chatOpen, setChatOpen] = useState(false)

  useScoresheetShortcut(() => setScoresOpen((open) => !open))

  useEffect(() => {
    if (chatOpen) actions.markChatRead()
  }, [chatOpen, store.chat.length, actions])

  const order = store.order.length > 0 ? store.order : store.turnOrder
  const nameFor = (id: string) => store.names[id] ?? 'Player'
  const teamFor = (id: string) => store.spades.teams[id] ?? 0

  const players = useMemo(
    () => order.map((id) => ({ id, name: store.names[id] ?? 'Player', team: teamFor(id) })),
    [order, store.names, store.spades.teams],
  )

  const { spades } = store
  const isMyTurn = store.currentTurnId != null && store.currentTurnId === store.meId
  const isMyBidTurn = spades.biddingTurnId != null && spades.biddingTurnId === store.meId

  const isPlayable = (card: Card, hand: Card[]) =>
    isLegalSpadesPlay(card, hand, { leadSuit: store.leadSuit, spadesBroken: spades.spadesBroken })

  const bidRows: SpadesBidRow[] = players.map((player) => ({
    id: player.id,
    name: player.name,
    team: player.team,
    bid: spades.bids[player.id] ?? null,
    isCurrentTurn: player.id === spades.biddingTurnId,
  }))

  return (
    <div className="table">
      <GameAnnouncer store={store} />

      <SpadesTopBar
        handNumber={store.roundNumber}
        trickNumber={store.trickNumber}
        totalTricks={store.totalTricks}
        spadesBroken={spades.spadesBroken}
        targetScore={spades.targetScore}
        bags={spades.bags}
        players={players.map((player) => ({
          ...player,
          bid: spades.bids[player.id] ?? null,
          tricksWon: store.tricksWon[player.id] ?? 0,
          isTurn: player.id === store.currentTurnId,
        }))}
      />

      {scoresOpen && (
        <SpadesScoresheet
          players={players}
          history={store.history}
          totals={store.totals}
          currentRound={store.roundNumber}
          targetScore={spades.targetScore}
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
          store.view === 'game' && <p className="table__interlude">shuffling the next hand…</p>
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

      {store.phase === 'bidding' && !store.spectating && (
        <SpadesBidModal
          isMyTurn={isMyBidTurn}
          hasBid={store.meId != null && spades.bids[store.meId] != null}
          myBid={store.meId ? (spades.bids[store.meId] ?? null) : null}
          rows={bidRows}
          currentTurnName={spades.biddingTurnId ? nameFor(spades.biddingTurnId) : null}
          bags={spades.bags}
          onBid={actions.submitSpadesBid}
        />
      )}

      {store.view === 'gameover' && store.standings && (
        <GameEnd
          standings={store.standings}
          tournament={store.tournamentEnded}
        />
      )}
    </div>
  )
}
