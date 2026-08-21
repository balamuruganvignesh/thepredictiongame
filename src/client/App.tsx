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
import { Shop } from './components/Shop'
import { SpadesTable } from './components/SpadesTable'
import { Table } from './components/Table'
import { useGame } from './useGame'

export default function App() {
  const { store, actions } = useGame()
  const isIrlScoresheet = window.location.pathname === '/scoresheet'
  const isLeaderboard = window.location.pathname === '/leaderboard'
  const isShop = window.location.pathname === '/shop'

  // The game is a fixed-viewport table, so tokens.css locks the document at
  // 100% height with `overflow: hidden`. These three standalone pages are
  // ordinary long DOCUMENTS, and that lock silently clipped them: content
  // below the fold existed but no wheel or touch gesture could reach it.
  // Flagging the document mode on <html> lets CSS unlock scrolling for
  // exactly these pages, using the same data-attribute convention
  // data-deck / data-theme / data-motion already follow.
  const isDocumentPage = isIrlScoresheet || isLeaderboard || isShop
  useEffect(() => {
    if (isDocumentPage) document.documentElement.setAttribute('data-page', 'document')
    else document.documentElement.removeAttribute('data-page')
  }, [isDocumentPage])

  // Keep the URL on the table code, so the address bar is a shareable invite.
  useEffect(() => {
    if (isDocumentPage) return
    const path = store.roomCode ? `/${store.roomCode}` : '/'
    if (window.location.pathname !== path) window.history.replaceState({}, '', path)
  }, [store.roomCode, isDocumentPage])

  if (isIrlScoresheet) return <IrlScoresheet />
  if (isLeaderboard) return <Leaderboard />
  if (isShop) return <Shop />

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
          onSetPublic={actions.setPublic}
          onSetPowerups={actions.setPowerups}
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
