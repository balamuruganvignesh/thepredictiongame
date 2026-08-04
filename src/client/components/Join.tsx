// Landing screen: pick a name, then either open a new table or type a friend's
// 4-letter code.

import { useEffect, useState } from 'react'
import { Config } from '@shared/config'
import { DeckStack } from './PlayingCard'
import { storedName } from '../socket'

type Props = {
  connected: boolean
  error: string | null
  onJoin: (name: string, roomCode: string | null) => void
}

export function Join({ connected, error, onJoin }: Props) {
  const [name, setName] = useState(storedName)
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<'create' | 'join'>('create')

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
    onJoin(trimmedName, mode === 'join' ? code.toUpperCase() : null)
  }

  return (
    <div className="join">
      <form className="note join__card" onSubmit={submit}>
        <div className="join__deck">
          <DeckStack />
        </div>

        <h1 className="join__title">THE PREDICTION GAME</h1>
        <p className="join__subtitle">5 up 5 down</p>
        <p className="join__blurb">
          Predict exactly how many tricks you’ll win. Hit it and you score big; miss and your score
          drops. {Config.minPlayers}–{Config.maxPlayers} players.
        </p>
        <p className="join__blurb">
          …or switch the table to <b>Hearts ♥</b> once you’re in — the host picks the game.
        </p>

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
