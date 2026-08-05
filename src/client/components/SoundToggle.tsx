// Mutes/unmutes EffectLayer's synthesized ability cues. Purely local, like
// DeckToggleButton -- see ../sound for why there's nothing to sync over the
// wire.

import { useSoundEnabled } from '../sound'

export function SoundToggleButton({ className = '' }: { className?: string }) {
  const { enabled, toggle } = useSoundEnabled()

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={toggle}
      title={enabled ? 'Mute ability sound effects' : 'Unmute ability sound effects'}
    >
      {enabled ? '🔊 SOUND' : '🔇 MUTED'}
    </button>
  )
}
