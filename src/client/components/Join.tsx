// Landing screen: pick a name and a game, then either open a new table or type
// a friend's 4-letter code. The game choice only applies to a NEW table --
// joining by code puts you in whatever game that table is already set to.

import { useEffect, useState } from 'react'
import { Config, GolfConfig, HeartsConfig } from '@shared/config'
import type { GameType } from '@shared/protocol'
import { DeckStack } from './PlayingCard'
import { storedName } from '../socket'
import { useDeckStyle } from '../deckStyle'

type Props = {
  connected: boolean
  error: string | null
  onJoin: (name: string, roomCode: string | null, gameType?: GameType) => void
}

export function Join({ connected, error, onJoin }: Props) {
  const [name, setName] = useState(storedName)
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [game, setGame] = useState<GameType>('prediction')
  const isHearts = game === 'hearts'
  const isGolf = game === 'golf'
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
          {creating ? (isHearts ? 'HEARTS' : isGolf ? 'GOLF' : 'THE PREDICTION GAME') : 'JOIN A TABLE'}
        </h1>
        <p className="join__subtitle">
          {creating
            ? isHearts
              ? 'take no tricks worth taking'
              : isGolf
                ? 'lowest grid wins'
                : '5 up 5 down'
            : 'three games, one table'}
        </p>
        <p className="join__blurb">
          {!creating ? (
            <>
              You’ll land in whichever game that table is playing — The Prediction Game, Hearts, or
              Golf. The host picks.
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
              it scores zero. Lowest total after {GolfConfig.totalHoles} holes wins.{' '}
              {GolfConfig.minPlayers}–{GolfConfig.maxPlayers} players.
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

        <button className="button button--accent join__go" type="submit" disabled={!ready}>
          {mode === 'create' ? 'DEAL ME IN' : 'JOIN TABLE'}
        </button>

        {!connected && <p className="join__status">connecting to the table…</p>}
        {error && <p className="join__status join__status--error">{error}</p>}
      </form>
    </div>
  )
}
