// Tiny synthesized sound effects for EffectLayer's ability moments. No audio
// assets -- every cue is one or two oscillators scheduled through the Web
// Audio API, so there's nothing to source, license, or ship as a file.

import { useState } from 'react'
import type { AbilityEffect } from '@shared/protocol'

const STORAGE_KEY = 'soundEnabled'

export function isSoundEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'off'
}

export function setSoundEnabled(enabled: boolean) {
  localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
}

/**
 * Local UI state for the settings toggle. Playback itself always reads
 * storage directly (see playAbilityEffect below), so a change here can't
 * drift from what's actually muted.
 */
export function useSoundEnabled() {
  const [enabled, setEnabled] = useState(isSoundEnabled)
  const toggle = () => {
    const next = !enabled
    setSoundEnabled(next)
    setEnabled(next)
  }
  return { enabled, toggle }
}

let audioCtx: AudioContext | null = null
let masterGain: GainNode | null = null

function getAudio(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null
  if (!audioCtx) {
    audioCtx = new AudioContext()
    masterGain = audioCtx.createGain()
    masterGain.gain.value = 0.5
    masterGain.connect(audioCtx.destination)
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return { ctx: audioCtx, master: masterGain! }
}

// Autoplay policy blocks audio until the page has seen a user gesture. An
// ability's effect can land well before its own seat's next click, so prime
// (and resume) the context off the FIRST gesture anywhere on the page rather
// than waiting for one aimed at sound.
if (typeof window !== 'undefined') {
  const prime = () => {
    getAudio()
    window.removeEventListener('pointerdown', prime)
    window.removeEventListener('keydown', prime)
  }
  window.addEventListener('pointerdown', prime)
  window.addEventListener('keydown', prime)
}

type ToneOpts = { type?: OscillatorType; delay?: number; duration?: number; peak?: number }

function tone(ctx: AudioContext, master: GainNode, freq: number, opts: ToneOpts = {}) {
  const { type = 'sine', delay = 0, duration = 0.12, peak = 0.2 } = opts
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  const start = ctx.currentTime + delay
  // Exponential ramps can't target/leave zero, hence 0.0001 as "silent".
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(peak, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(master)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

function glide(
  ctx: AudioContext,
  master: GainNode,
  from: number,
  to: number,
  opts: ToneOpts = {},
) {
  const { type = 'sine', delay = 0, duration = 0.25, peak = 0.18 } = opts
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  const start = ctx.currentTime + delay
  osc.frequency.setValueAtTime(from, start)
  osc.frequency.exponentialRampToValueAtTime(to, start + duration)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.linearRampToValueAtTime(peak, start + 0.015)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain)
  gain.connect(master)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

type Voice = (ctx: AudioContext, master: GainNode) => void

// Grouped by feel rather than one voice per icon -- abilities that land the
// same way (a block, a curse, a swap) share a cue, so the palette stays small
// and recognizable instead of a different blip per emoji.
const VOICES = {
  tick: (ctx, m) => tone(ctx, m, 1500, { type: 'square', duration: 0.05, peak: 0.1 }),
  sneaky: (ctx, m) => tone(ctx, m, 240, { type: 'square', duration: 0.09, peak: 0.09 }),
  shield: (ctx, m) => tone(ctx, m, 920, { type: 'triangle', duration: 0.16, peak: 0.2 }),
  blocked: (ctx, m) => tone(ctx, m, 170, { type: 'square', duration: 0.13, peak: 0.16 }),
  ominous: (ctx, m) => glide(ctx, m, 320, 130, { type: 'sawtooth', duration: 0.3, peak: 0.13 }),
  chime: (ctx, m) => {
    tone(ctx, m, 660, { duration: 0.3, peak: 0.15 })
    tone(ctx, m, 990, { delay: 0.06, duration: 0.35, peak: 0.12 })
  },
  chance: (ctx, m) => {
    tone(ctx, m, 500, { type: 'square', duration: 0.04, peak: 0.12 })
    tone(ctx, m, 620, { type: 'square', delay: 0.08, duration: 0.04, peak: 0.12 })
  },
  fanfare: (ctx, m) => {
    tone(ctx, m, 523, { duration: 0.14, peak: 0.18 })
    tone(ctx, m, 784, { delay: 0.1, duration: 0.26, peak: 0.2 })
  },
  mystic: (ctx, m) => glide(ctx, m, 500, 950, { duration: 0.35, peak: 0.13 }),
  swap: (ctx, m) => glide(ctx, m, 700, 480, { type: 'triangle', duration: 0.22, peak: 0.16 }),
  link: (ctx, m) => {
    tone(ctx, m, 720, { duration: 0.2, peak: 0.13 })
    tone(ctx, m, 720, { delay: 0.03, duration: 0.2, peak: 0.13 })
  },
} satisfies Record<string, Voice>

type VoiceName = keyof typeof VOICES

// Keyed by the exact icon roles.ts hands the effect (see AbilityEffect in
// shared/protocol.ts). Multiple icons intentionally share a voice above --
// keep this in sync whenever a role starts using a new icon.
const ICON_VOICE: Record<string, VoiceName> = {
  '⏳': 'tick',
  '🕵️': 'sneaky',
  '⚰️': 'ominous',
  '⚖️': 'ominous',
  '🛡️': 'shield',
  '😇': 'chime',
  '🎲': 'chance',
  '👑': 'fanfare',
  '🪞': 'swap',
  '🔗': 'link',
  '🔒': 'blocked',
  '🚫': 'blocked',
  '🔮': 'mystic',
  '🃏': 'swap',
  '🔄': 'swap',
}

// An icon this map hasn't caught up with yet still gets a sound, keyed off
// the one thing every AbilityEffect is guaranteed to have.
const FALLBACK_VOICE: Record<AbilityEffect['kind'], VoiceName> = {
  trade: 'swap',
  impact: 'shield',
}

export function playAbilityEffect(effect: AbilityEffect) {
  if (!isSoundEnabled()) return
  const audio = getAudio()
  if (!audio) return
  const voice = ICON_VOICE[effect.icon] ?? FALLBACK_VOICE[effect.kind]
  VOICES[voice](audio.ctx, audio.master)
}
