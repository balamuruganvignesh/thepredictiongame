// Landing screen: pick a name and a game, then either open a new table or type
// a friend's 4-letter code. The game choice only applies to a NEW table --
// joining by code puts you in whatever game that table is already set to.

import { useEffect, useState } from 'react'
import { BlackjackConfig, Config, GolfConfig, HeartsConfig, SpadesConfig } from '@shared/config'
import type { GameType } from '@shared/protocol'
import { DeckStack } from './PlayingCard'
import { TableBrowser } from './TableBrowser'
import { storedName } from '../socket'
import { installAvailable, onInstallAvailabilityChange, promptInstall } from '../pwa'
import { useDeckStyle } from '../deckStyle'
import { loginHref, useAuth } from '../auth'

type Props = {
  connected: boolean
  error: string | null
  onJoin: (name: string, roomCode: string | null, gameType?: GameType) => void
}

/**
 * Sign in, or who you're signed in as. Sits in the footer link stack rather
 * than beside the name field on purpose: anonymous play is the supported
 * default and a 4-letter invite link has to stay the fastest way in, so
 * signing in reads as an upgrade, not a gate.
 *
 * Hidden entirely when the server has no Google credentials configured --
 * a permanently dead button is worse than no button, the same call the PWA
 * install prompt already makes.
 */
function AccountLink() {
  const { account, loginAvailable, ready, logout } = useAuth()
  if (!ready || !loginAvailable) return null

  if (account) {
    return (
      <span className="join__account">
        {account.picture && <img src={account.picture} alt="" className="join__avatar" />}
        <span>
          {account.name ?? 'Signed in'} · 🪙 {account.coins}
        </span>
        <button type="button" className="join__signout" onClick={() => void logout()}>
          sign out
        </button>
      </span>
    )
  }

  return (
    <a className="join__irl-link" href={loginHref()}>
      🔐 Sign in with Google — keep your scores across devices →
    </a>
  )
}

export function Join({ connected, error, onJoin }: Props) {
  // Only offered when the browser has actually said the app is installable
  // (see ../pwa.ts) -- a permanently-visible "install" button that does
  // nothing on iOS, or on a browser that already installed it, is worse than
  // no button.
  const [canInstall, setCanInstall] = useState(installAvailable)
  useEffect(() => onInstallAvailabilityChange(setCanInstall), [])

  const [name, setName] = useState(storedName)
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'create' | 'join' | 'browse'>('create')
  const [game, setGame] = useState<GameType>('prediction')
  const isHearts = game === 'hearts'
  const isGolf = game === 'golf'
  const isBlackjack = game === 'blackjack'
  const isSpades = game === 'spades'
  const creating = mode === 'create'
  const { deck, setDeck } = useDeckStyle()

  // A shared link like /ABCD drops you straight into the join form.
  useEffect(() => {
    const fromPath = window.location.pathname.replace(/\W/g, '').toUpperCase()
    if (fromPath.length === 4) {
      setCode(fromPath)
      setMode('join')
    }
  }, [])

  const trimmedName = name.trim()
  const ready = connected && trimmedName.length > 0 && (mode === 'create' || code.length === 4)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!ready) return
    // The game is only ours to choose when we're the ones opening the table.
    onJoin(trimmedName, mode === 'join' ? code.toUpperCase() : null, mode === 'create' ? game : undefined)
  }

  /**
   * Picking a table out of the browser joins it directly rather than filling
   * in the code box and waiting for another click -- you already chose.
   */
  const joinListed = (listedCode: string) => {
    if (!connected || trimmedName.length === 0) return
    onJoin(trimmedName, listedCode, undefined)
  }

  return (
    <div className="join">
      <form className="note join__card" onSubmit={submit}>
        <div className="join__deck">
          <DeckStack />
        </div>

        <div className="segmented segmented--small" role="tablist" aria-label="Card deck">
          <button
            type="button"
            role="tab"
            aria-selected={deck === 'pixel'}
            className={`segmented__option${deck === 'pixel' ? ' is-active' : ''}`}
            onClick={() => setDeck('pixel')}
          >
            pixel deck
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={deck === 'classic'}
            className={`segmented__option${deck === 'classic' ? ' is-active' : ''}`}
            onClick={() => setDeck('classic')}
          >
            classic deck
          </button>
        </div>

        {/* Joining by code: the table already has a game, so this screen
            stops advertising one and says so instead. */}
        <h1 className="join__title">
          {creating
            ? isHearts
              ? 'HEARTS'
              : isGolf
                ? 'GOLF'
                : isBlackjack
                  ? 'BLACKJACK'
                  : isSpades
                    ? 'SPADES'
                    : 'THE PREDICTION GAME'
            : mode === 'browse'
              ? 'OPEN TABLES'
              : 'JOIN A TABLE'}
        </h1>
        <p className="join__subtitle">
          {creating
            ? isHearts
              ? 'take no tricks worth taking'
              : isGolf
                ? 'lowest grid wins'
                : isBlackjack
                  ? 'get closer to 21'
                  : isSpades
                    ? 'bid it, make it, bag it'
                    : '5 up 5 down'
            : mode === 'browse'
              ? 'pull up a chair anywhere'
              : 'five games, one table'}
        </p>
        <p className="join__blurb">
          {mode === 'browse' ? (
            <>
              Tables their hosts have listed publicly, still in the lobby with a chair free. Put
              your name in and pick one — or take pot luck.
            </>
          ) : !creating ? (
            <>
              You’ll land in whichever game that table is playing — The Prediction Game, Hearts,
              Golf, Blackjack, or Spades. The host picks.
            </>
          ) : isHearts ? (
            <>
              Every ♥ is a point and the Q♠ is thirteen — and points are BAD. Duck them all, or take
              every one and shoot the moon. {HeartsConfig.minPlayers}–{HeartsConfig.maxPlayers}{' '}
              players.
            </>
          ) : isGolf ? (
            <>
              Six face-down cards each. Draw, swap, or flip to learn your grid — match a column and
              it scores zero. Lowest total after {GolfConfig.defaultHoleCount} holes wins.{' '}
              {GolfConfig.minPlayers}–{GolfConfig.maxPlayers} players.
            </>
          ) : isBlackjack ? (
            <>
              Hit, stand, or double, trying to land closer to 21 than the dealer without busting —
              or the host can flip it to everyone racing each other instead. Most points after{' '}
              {BlackjackConfig.defaultRounds} rounds wins. {BlackjackConfig.minPlayers}–
              {BlackjackConfig.maxPlayers} players.
            </>
          ) : isSpades ? (
            <>
              4 players, 2 teams of 2 sitting across from each other. Bid your tricks — or bid Nil
              for zero — and spades are always trump. Overtricks pile up as bags: every 10 costs
              your team 100. Highest score when a team hits {SpadesConfig.defaultTargetScore} wins.{' '}
              exactly {SpadesConfig.minPlayers} players.
            </>
          ) : (
            <>
              Predict exactly how many tricks you’ll win. Hit it and you score big; miss and your
              score drops. {Config.minPlayers}–{Config.maxPlayers} players.
            </>
          )}
        </p>

        {creating && (
        <div className="segmented" role="tablist" aria-label="Game">
          <button
            type="button"
            role="tab"
            aria-selected={game === 'prediction'}
            className={`segmented__option${game === 'prediction' ? ' is-active' : ''}`}
            onClick={() => setGame('prediction')}
          >
            prediction
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isHearts}
            className={`segmented__option${isHearts ? ' is-active' : ''}`}
            onClick={() => setGame('hearts')}
          >
            hearts ♥
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isGolf}
            className={`segmented__option${isGolf ? ' is-active' : ''}`}
            onClick={() => setGame('golf')}
          >
            golf ⛳
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isBlackjack}
            className={`segmented__option${isBlackjack ? ' is-active' : ''}`}
            onClick={() => setGame('blackjack')}
          >
            blackjack 🂡
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSpades}
            className={`segmented__option${isSpades ? ' is-active' : ''}`}
            onClick={() => setGame('spades')}
          >
            spades ♠️
          </button>
        </div>
        )}

        <label className="field">
          <span className="field__label">your name</span>
          <input
            className="field__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="who's playing?"
            autoFocus
          />
        </label>

        <div className="segmented" role="tablist" aria-label="Table">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={`segmented__option${mode === 'create' ? ' is-active' : ''}`}
            onClick={() => setMode('create')}
          >
            new table
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={`segmented__option${mode === 'join' ? ' is-active' : ''}`}
            onClick={() => setMode('join')}
          >
            join a table
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'browse'}
            className={`segmented__option${mode === 'browse' ? ' is-active' : ''}`}
            onClick={() => setMode('browse')}
          >
            browse 🌍
          </button>
        </div>

        {mode === 'join' && (
          <label className="field">
            <span className="field__label">table code</span>
            <input
              className="field__input field__input--code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              maxLength={4}
              placeholder="ABCD"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}

        {mode === 'browse' ? (
          <TableBrowser
            disabled={!connected || trimmedName.length === 0}
            onPick={joinListed}
          />
        ) : (
          <button className="button button--accent join__go" type="submit" disabled={!ready}>
            {mode === 'create' ? 'DEAL ME IN' : 'JOIN TABLE'}
          </button>
        )}

        {!connected && <p className="join__status">connecting to the table…</p>}
        {error && <p className="join__status join__status--error">{error}</p>}

        <a className="join__irl-link" href="/scoresheet">
          Playing with real cards? Use the IRL score sheet instead →
        </a>
        <a className="join__irl-link" href="/leaderboard">
          🏆 See the leaderboard →
        </a>
        <a className="join__irl-link" href="/shop">
          🪙 Spend your coins in the shop →
        </a>
        <AccountLink />
        {canInstall && (
          <button
            type="button"
            className="join__irl-link join__install"
            onClick={() => void promptInstall()}
          >
            📲 Install it to your home screen →
          </button>
        )}
      </form>
    </div>
  )
}
