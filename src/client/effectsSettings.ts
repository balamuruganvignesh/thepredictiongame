// Whether EffectLayer renders its choreographed ability animations. Kept
// fully separate from ./sound's mute flag -- see EffectsToggleButton and
// SoundToggleButton -- so a shared screen can drop the flying icons without
// losing the audio cues, or the reverse.

import { useState } from 'react'

const STORAGE_KEY = 'effectsEnabled'

export function isEffectsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setEffectsEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
}

/**
 * Local UI state for the settings toggle. EffectLayer reads the flag itself
 * via a prop threaded from Table, not from this hook directly -- see
 * Table.tsx -- so a change here can't drift from what's actually rendering.
 */
export function useEffectsEnabled() {
  const [enabled, setEnabled] = useState(isEffectsEnabled)
  const toggle = () => {
    const next = !enabled
    setEffectsEnabled(next)
    setEnabled(next)
  }
  return { enabled, toggle }
}
