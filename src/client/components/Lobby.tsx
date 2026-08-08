// Pre-game lobby, laid out like a wall of paper notes:
//   * info cards on the LEFT (title/status, how to play, mode, roles)
//   * one box per player on the right, each with a ready circle -- click YOUR
//     box to ready up; it fills with a tick
//   * the host doesn't ready -- their box shows a crown, and they get the big
//     START button once everyone else is ready
// The table code and share link live here: players arrive by URL.

import { useState } from 'react'
import { BlackjackConfig, GolfConfig, HeartsConfig } from '@shared/config'
import type { BlackjackMode, ChatMessage, GameType, LobbyUpdate } from '@shared/protocol'
import { ChatPanel } from './ChatPanel'
import { RolesGallery } from './RolesGallery'

type Props = {
  lobby: LobbyUpdate
  meId: string | null
  chat: ChatMessage[]
  unreadChat: number
  onToggleReady: (ready: boolean) => void
  onStart: () => void
  onSetMode: (mode: 'classic' | 'chaos') => void
  onSetGameType: (gameType: GameType) => void
  onSetTargetScore: (score: number) => void
  onSetHoleCount: (holes: number) => void
  onSetBlackjackMode: (mode: BlackjackMode) => void
  onSetBlackjackRounds: (rounds: number) => void
  onSendChat: (text: string) => void
  onChatRead: () => void
}

export function Lobby({
  lobby,
  meId,
  chat,
  unreadChat,
  onToggleReady,
  onStart,
  onSetMode,
  onSetGameType,
  onSetTargetScore,
  onSetHoleCount,
  onSetBlackjackMode,
  onSetBlackjackRounds,
  onSendChat,
  onChatRead,
}: Props) {
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)

  const isHost = lobby.hostId === meId
  const me = lobby.roster.find((entry) => entry.id === meId)
  const missing = lobby.minPlayers - lobby.roster.length
  const isChaos = lobby.mode === 'chaos'
  const isHearts = lobby.gameType === 'hearts'
  const isGolf = lobby.gameType === 'golf'
  const isBlackjack = lobby.gameType === 'blackjack'
  const tooMany = lobby.roster.length > lobby.maxPlayers
  const compact = lobby.roster.length > 6

  // Cycle prediction -> hearts -> golf -> blackjack -> prediction. A binary
  // toggle doesn't scale past two games.
  const GAME_CYCLE: GameType[] = ['prediction', 'hearts', 'golf', 'blackjack']
  const nextGameType = GAME_CYCLE[(GAME_CYCLE.indexOf(lobby.gameType) + 1) % GAME_CYCLE.length]

  const status = () => {
    // Hearts, Golf and Blackjack all seat fewer players than the Prediction
    // Game, so a big table can be over the limit rather than under it.
    if (tooMany) {
      return `too many players for ${isHearts ? 'hearts' : isGolf ? 'golf' : isBlackjack ? 'blackjack' : 'this game'} — ${lobby.maxPlayers} max`
    }
    if (missing > 0) return `waiting for ${missing} more player${missing === 1 ? '' : 's'}`
    if (!lobby.canStart) return 'waiting for everyone to ready up…'
    return isHost ? "everyone's in. hit start!" : 'waiting for the host to start…'
  }

  const share = async () => {
    const url = `${window.location.origin}/${lobby.roomCode}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The code
      // is on screen anyway, so this is a nice-to-have, not a failure path.
      setCopied(false)
    }
  }

  return (
    <div className="lobby">
      <div className="lobby__left">
        <section className="note lobby__title-card">
          <h1 className="lobby__title">
            {isHearts ? 'HEARTS' : isGolf ? 'GOLF' : isBlackjack ? 'BLACKJACK' : 'THE PREDICTION GAME'}
          </h1>
          <p className="lobby__subtitle">
            {isHearts
              ? 'take no tricks worth taking'
              : isGolf
                ? 'lowest grid wins'
                : isBlackjack
                  ? 'get closer to 21'
                  : '5 up 5 down'}
          </p>

          <button className="code-chip" onClick={share} title="Copy the invite link">
            <span className="code-chip__label">table code</span>
            <span className="code-chip__value">{lobby.roomCode}</span>
            <span className="code-chip__hint">{copied ? 'link copied ✓' : 'tap to copy link'}</span>
          </button>

          <p className="lobby__status">{status()}</p>
          <p className="lobby__count">
            {lobby.roster.length} / {lobby.maxPlayers} at the table
          </p>
        </section>

        <section className="note lobby__how">
          <header className="note__header">how to play</header>
          {isHearts ? (
            <p>
              pass three cards, then duck every trick worth points.
              <br />
              each ♥ is 1 point, the Q♠ is 13 — and points are BAD.
              <br />
              take all 26 and you shoot the moon: everyone else eats them.
              <br />
              lowest score when someone hits {lobby.targetScore} wins.
            </p>
          ) : isGolf ? (
            <p>
              six cards each, dealt face down — flip two to start.
              <br />
              on your turn, draw and swap it in, or flip a card instead.
              <br />
              match both cards in a column and it scores zero.
              <br />
              lowest total after {lobby.holeCount} holes wins.
            </p>
          ) : isBlackjack ? (
            <p>
              hit, stand, or double, trying to land closer to 21 than{' '}
              {lobby.blackjackMode === 'dealer' ? 'the dealer' : 'everyone else'} without busting.
              <br />
              hands are dealt face up — everyone can see everyone's cards.
              <br />
              a natural blackjack settles on the spot; doubling doubles the swing.
              <br />
              most points after {lobby.blackjackRounds} rounds wins.
            </p>
          ) : (
            <p>
              bid how many hands you’ll win each round.
              <br />
              hit your bid exactly to score big.
              <br />
              miss it and you lose points.
              <br />
              feeling brave? double down — 5 seconds to decide.
            </p>
          )}
        </section>

        <div className="lobby__small-cards">
          <button
            className={`note lobby__mode${isHearts ? ' is-hearts' : ''}${isGolf ? ' is-golf' : ''}${isBlackjack ? ' is-blackjack' : ''}`}
            onClick={() => isHost && onSetGameType(nextGameType)}
            disabled={!isHost}
          >
            <span className="lobby__mode-kicker">game</span>
            <span className="lobby__mode-value">
              {isHearts ? 'HEARTS ♥' : isGolf ? 'GOLF ⛳' : isBlackjack ? 'BLACKJACK 🂡' : 'PREDICTION'}
            </span>
            <span className="lobby__mode-hint">
              {isHost ? 'tap to switch' : 'host picks the game'}
            </span>
          </button>

          {/* Chaos roles are a Prediction Game feature; a Hearts, Golf, or
              Blackjack table swaps that card for the choice(s) that game
              plays to instead. */}
          {isHearts ? (
            <button
              className="note lobby__mode"
              onClick={() => {
                if (!isHost) return
                const options = HeartsConfig.targetScoreOptions as readonly number[]
                const next = options[(options.indexOf(lobby.targetScore) + 1) % options.length]
                onSetTargetScore(next)
              }}
              disabled={!isHost}
            >
              <span className="lobby__mode-kicker">play to</span>
              <span className="lobby__mode-value">{lobby.targetScore}</span>
              <span className="lobby__mode-hint">
                {isHost ? 'tap to change' : 'lowest score wins'}
              </span>
            </button>
          ) : isGolf ? (
            <button
              className="note lobby__mode"
              onClick={() => {
                if (!isHost) return
                const options = GolfConfig.holeCountOptions as readonly number[]
                const next = options[(options.indexOf(lobby.holeCount) + 1) % options.length]
                onSetHoleCount(next)
              }}
              disabled={!isHost}
            >
              <span className="lobby__mode-kicker">play to</span>
              <span className="lobby__mode-value">{lobby.holeCount} holes</span>
              <span className="lobby__mode-hint">
                {isHost ? 'tap to change' : 'lowest total wins'}
              </span>
            </button>
          ) : isBlackjack ? (
            <>
              <button
                className="note lobby__mode"
                onClick={() =>
                  isHost && onSetBlackjackMode(lobby.blackjackMode === 'dealer' ? 'players' : 'dealer')
                }
                disabled={!isHost}
              >
                <span className="lobby__mode-kicker">mode</span>
                <span className="lobby__mode-value">
                  {lobby.blackjackMode === 'dealer' ? 'VS DEALER' : 'VS PLAYERS'}
                </span>
                <span className="lobby__mode-hint">
                  {isHost ? 'tap to switch' : 'host picks the mode'}
                </span>
              </button>
              <button
                className="note lobby__mode"
                onClick={() => {
                  if (!isHost) return
                  const options = BlackjackConfig.roundOptions as readonly number[]
                  const next =
                    options[(options.indexOf(lobby.blackjackRounds) + 1) % options.length]
                  onSetBlackjackRounds(next)
                }}
                disabled={!isHost}
              >
                <span className="lobby__mode-kicker">play to</span>
                <span className="lobby__mode-value">{lobby.blackjackRounds} rounds</span>
                <span className="lobby__mode-hint">
                  {isHost ? 'tap to change' : 'most points wins'}
                </span>
              </button>
            </>
          ) : (
            <button
              className={`note lobby__mode${isChaos ? ' is-chaos' : ''}`}
              onClick={() => isHost && onSetMode(isChaos ? 'classic' : 'chaos')}
              disabled={!isHost}
            >
              <span className="lobby__mode-kicker">game mode</span>
              <span className="lobby__mode-value">{isChaos ? 'CHAOS 🃏' : 'CLASSIC'}</span>
              <span className="lobby__mode-hint">
                {isHost ? 'tap to switch' : 'host picks the mode'}
              </span>
            </button>
          )}

          {!isHearts && !isGolf && !isBlackjack && (
            <button className="note lobby__roles" onClick={() => setGalleryOpen(true)}>
              <span className="lobby__roles-title">🎭 THE ROLES</span>
              <span className="lobby__mode-hint">tap to browse chaos roles</span>
            </button>
          )}
        </div>
      </div>

      <div className="lobby__right">
        <ul className={`seats${compact ? ' seats--compact' : ''}`}>
          {lobby.roster.map((entry, index) => {
            const isMe = entry.id === meId
            const clickable = isMe && !entry.isHost
            const Tag = clickable ? 'button' : 'div'
            return (
              <li key={entry.id}>
                <Tag
                  className={`seat${isMe ? ' seat--me' : ''}${
                    entry.connected ? '' : ' seat--gone'
                  }`}
                  style={{ '--tilt': `${index % 2 === 0 ? 0.8 : -0.8}deg` } as React.CSSProperties}
                  {...(clickable
                    ? { onClick: () => onToggleReady(!entry.ready), type: 'button' as const }
                    : {})}
                >
                  <span className="seat__name">
                    {entry.name}
                    {isMe && <span className="seat__you"> (you)</span>}
                  </span>
                  {entry.isHost ? (
                    <span className="seat__crown" title="host">
                      👑
                    </span>
                  ) : (
                    <span className={`seat__ready${entry.ready ? ' is-ready' : ''}`}>
                      {entry.ready ? '✓' : ''}
                    </span>
                  )}
                </Tag>
              </li>
            )
          })}
        </ul>

        <div className="lobby__actions">
          {isHost ? (
            <>
              <button
                className="button button--accent lobby__start"
                onClick={onStart}
                disabled={!lobby.canStart}
              >
                START GAME
              </button>
              {!lobby.canStart && (
                <p className="lobby__hint">
                  {tooMany
                    ? `${isHearts ? 'hearts' : isGolf ? 'golf' : isBlackjack ? 'blackjack' : 'this game'} seats ${lobby.maxPlayers} at most`
                    : missing > 0
                      ? 'need more players…'
                      : 'everyone must ready up first'}
                </p>
              )}
            </>
          ) : (
            <p className="lobby__hint">
              {me?.ready ? 'ready — waiting for the host' : 'click your box to ready up'}
            </p>
          )}
        </div>
      </div>

      <div className="dock">
        <button
          className="dock__button"
          onClick={() => {
            setChatOpen((open) => !open)
            onChatRead()
          }}
        >
          CHAT
          {unreadChat > 0 && !chatOpen && (
            <span className="dock__badge">{unreadChat > 9 ? '9+' : unreadChat}</span>
          )}
        </button>
      </div>

      {chatOpen && (
        <ChatPanel
          messages={chat}
          meId={meId}
          onSend={onSendChat}
          onClose={() => setChatOpen(false)}
        />
      )}

      {galleryOpen && <RolesGallery onClose={() => setGalleryOpen(false)} />}
    </div>
  )
}
