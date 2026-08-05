// Shows/hides EffectLayer's choreographed ability animations. Purely local,
// like SoundToggleButton -- see ../effectsSettings for why it's a separate
// flag from sound rather than one combined switch.

import { useEffectsEnabled } from '../effectsSettings'

export function EffectsToggleButton({ className = '' }: { className?: string }) {
  const { enabled, toggle } = useEffectsEnabled()

  return (
    <button
      className={`dock__button ${className}`.trim()}
      onClick={toggle}
      title={enabled ? 'Hide ability effect animations' : 'Show ability effect animations'}
    >
      {enabled ? '✨ EFFECTS' : '✨ OFF'}
    </button>
  )
}
