import { useEffect } from 'react'
import { BackgroundFX } from './components/BackgroundFX'
import { Feed } from './components/Feed'
import { Join } from './components/Join'
import { Lobby } from './components/Lobby'
import { HeartsTable } from './components/HeartsTable'
import { Table } from './components/Table'
import { useGame } from './useGame'

export default function App() {
  const { store, actions } = useGame()

  // Keep the URL on the table code, so the address bar is a shareable invite.
  useEffect(() => {
    const path = store.roomCode ? `/${store.roomCode}` : '/'
    if (window.location.pathname !== path) window.history.replaceState({}, '', path)
  }, [store.roomCode])

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
          onSendChat={actions.sendChat}
          onChatRead={actions.markChatRead}
        />
      )}

      {(store.view === 'game' || store.view === 'gameover') &&
        (store.gameType === 'hearts' ? (
          <HeartsTable store={store} actions={actions} />
        ) : (
          <Table store={store} actions={actions} />
        ))}

      <Feed cards={store.feed} />

      {store.toast && <div className="toast">{store.toast}</div>}

      {!store.connected && store.view !== 'join' && (
        <div className="toast toast--warn">reconnecting…</div>
      )}
    </>
  )
}
