import type { AlertSound } from '@shared/alerts'
import { resolveVoice, type AvailableVoice } from '@shared/voices'

/**
 * Alert sounds, synthesised rather than sampled.
 *
 * No .wav files ship with the app. That is deliberate: audio assets are the
 * bulk of an installer that otherwise fits in a few megabytes, they need
 * licences, and a synthesised tone is instant, never missing, and can be
 * retuned by editing four numbers.
 *
 * The four voices are chosen to be distinguishable while you are busy:
 * different attack, different pitch direction, different timbre - not four
 * pitches of the same beep, which is indistinguishable once you are actually
 * reading the screen instead of listening for it.
 */

type Voice = {
  type: OscillatorType
  /** Frequency ramp, in Hz, over the note. */
  from: number
  to: number
  seconds: number
  /** Peak gain. Kept well under 1 so stacking two alerts never clips. */
  gain: number
  /** Repeats, for the ones that should insist. */
  repeats?: number
  gapSeconds?: number
}

const VOICES: Record<Exclude<AlertSound, 'none'>, Voice> = {
  // A soft two-tone rise: something happened, look when you can.
  chime: { type: 'sine', from: 660, to: 990, seconds: 0.18, gain: 0.22 },
  // Insistent, repeated, square: look NOW.
  alarm: { type: 'square', from: 880, to: 660, seconds: 0.1, gain: 0.18, repeats: 3, gapSeconds: 0.09 },
  // Low and short: something dropped.
  thud: { type: 'triangle', from: 180, to: 70, seconds: 0.22, gain: 0.3 },
  // A rising sweep: something good.
  sweep: { type: 'sawtooth', from: 300, to: 1200, seconds: 0.32, gain: 0.14 }
}

let ctx: AudioContext | null = null

function context(): AudioContext {
  // Created lazily on the first sound: constructing an AudioContext before any
  // user gesture leaves it suspended, and a suspended context silently plays
  // nothing.
  if (!ctx) ctx = new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function note(voice: Voice, at: number, volume: number): void {
  const audio = context()
  const osc = audio.createOscillator()
  const gain = audio.createGain()

  osc.type = voice.type
  osc.frequency.setValueAtTime(voice.from, at)
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to), at + voice.seconds)

  // A short attack and an exponential decay: a raw gate on a square wave
  // clicks, and a click is more annoying than the alert is useful.
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(voice.gain * volume, at + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + voice.seconds)

  osc.connect(gain).connect(audio.destination)
  osc.start(at)
  osc.stop(at + voice.seconds + 0.02)
}

export function playAlert(sound: AlertSound, volume = 1): void {
  if (sound === 'none' || volume <= 0) return
  const voice = VOICES[sound]
  if (!voice) return

  const audio = context()
  const start = audio.currentTime + 0.01
  const repeats = voice.repeats ?? 1
  const gap = voice.gapSeconds ?? 0

  for (let i = 0; i < repeats; i++) {
    note(voice, start + i * (voice.seconds + gap), volume)
  }
}

/* ---------------------------------------------------------------------------
   Speech
--------------------------------------------------------------------------- */

let persona = 'system'

export function setVoicePersona(id: string): void {
  persona = id
}

/**
 * The voices this machine has.
 *
 * getVoices() is famously empty on first call in Chromium - the list is
 * populated asynchronously and announced via `voiceschanged` - so callers get
 * whatever is known now and re-ask after the event.
 */
export function availableVoices(): AvailableVoice[] {
  if (!('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices().map((v) => ({
    name: v.name,
    lang: v.lang,
    default: v.default
  }))
}

export function onVoicesChanged(fn: () => void): () => void {
  if (!('speechSynthesis' in window)) return () => {}
  window.speechSynthesis.addEventListener('voiceschanged', fn)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', fn)
}

/**
 * Speak a line. Uses the platform voices the OS already has, so nothing ships
 * and it works offline. Cancels anything queued first - during a bad pull the
 * newest alert is the one that matters, and a backlog of stale speech is worse
 * than silence.
 */
/** Speak with one specific installed voice, for auditioning the raw list. */
export function speakWithVoice(text: string, voiceName: string, volume = 1): void {
  if (!text || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.volume = Math.max(0, Math.min(1, volume))
  utterance.rate = 1.1

  const match = window.speechSynthesis.getVoices().find((v) => v.name === voiceName)
  if (match) {
    utterance.voice = match
    utterance.lang = match.lang
  }
  window.speechSynthesis.speak(utterance)
}

export function speak(text: string, volume = 1, personaId = persona): void {
  if (!text || !('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.volume = Math.max(0, Math.min(1, volume))
  utterance.rate = 1.1

  const wanted = resolveVoice(personaId, availableVoices()).voice
  if (wanted) {
    const match = window.speechSynthesis.getVoices().find((v) => v.name === wanted.name)
    if (match) {
      utterance.voice = match
      // Setting .voice does not always set .lang, and some engines pick the
      // accent from lang rather than from the voice object.
      utterance.lang = match.lang
    }
  }

  window.speechSynthesis.speak(utterance)
}
