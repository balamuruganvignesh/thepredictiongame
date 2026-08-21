import { useEffect } from 'react'
import { BackgroundFX } from './components/BackgroundFX'
import { ConnectionStatus } from './components/ConnectionStatus'
import { Feed } from './components/Feed'
import { Join } from './components/Join'
import { Lobby } from './components/Lobby'
import { BlackjackTable } from './components/BlackjackTable'
import { GolfTable } from './components/GolfTable'
import { HeartsTable } from './components/HeartsTable'
import { IrlScoresheet } from './components/IrlScoresheet'
import { Leaderboard } from './components/Leaderboard'
import { SpadesTable } from './components/SpadesTable'
import { Table } from './components/Table'
import { useGame } from './useGame'

export default function App() {
  const { store, actions } = useGame()
  const isIrlScoresheet = window.location.pathname === '/scoresheet'
  const isLeaderboard = window.location.pathname === '/leaderboard'

  // Keep the URL on the table code, so the address bar is a shareable invite.
  useEffect(() => {
    if (isIrlScoresheet || isLeaderboard) return
    const path = store.roomCode ? `/${store.roomCode}` : '/'
    if (window.location.pathname !== path) window.history.replaceState({}, '', path)
  }, [store.roomCode, isIrlScoresheet, isLeaderboard])

  if (isIrlScoresheet) return <IrlScoresheet />
  if (isLeaderboard) return <Leaderboard />

  return (
    <>
      <BackgroundFX />

      {store.view === 'join' && (
        <Join connected={store.connected} error={store.joinError} onJoin={actions.join} />
      )}

      {store.view === 'lobby' && store.lobby && (
        <Lobby
          lobby={store.lobby}
          meId={store.meId}
          chat={store.chat}
          unreadChat={store.unreadChat}
          onToggleReady={actions.toggleReady}
          onStart={actions.startGame}
          onSetMode={actions.setMode}
          onSetGameType={actions.setGameType}
          onSetTargetScore={actions.setTargetScore}
          onSetHoleCount={actions.setHoleCount}
          onSetSpadesTargetScore={actions.setSpadesTargetScore}
          onSetTournamentGames={actions.setTournamentGames}
          onSetBlackjackMode={actions.setBlackjackMode}
          onSetBlackjackRounds={actions.setBlackjackRounds}
          onSendChat={actions.sendChat}
          onChatRead={actions.markChatRead}
        />
      )}

      {(store.view === 'game' || store.view === 'gameover') &&
        (store.gameType === 'hearts' ? (
          <HeartsTable store={store} actions={actions} />
        ) : store.gameType === 'golf' ? (
          <GolfTable store={store} actions={actions} />
        ) : store.gameType === 'blackjack' ? (
          <BlackjackTable store={store} actions={actions} />
        ) : store.gameType === 'spades' ? (
          <SpadesTable store={store} actions={actions} />
        ) : (
          <Table store={store} actions={actions} />
        ))}

      <Feed cards={store.feed} />

      {store.toast && <div className="toast">{store.toast}</div>}

      {!store.connected && store.view !== 'join' && (
        <ConnectionStatus inGame={store.view === 'game' || store.view === 'gameover'} />
      )}
    </>
  )
}
