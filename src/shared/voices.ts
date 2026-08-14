/**
 * Voice personas for spoken alerts.
 *
 * The Web Speech API exposes only a name and a BCP-47 language tag per voice -
 * there is no gender field and no accent field. So a persona is resolved in
 * two passes: match the language tag for the accent, then match the voice name
 * against a table of known system voices for the gender.
 *
 * That table is the honest part of this. It covers the voices Windows and Edge
 * actually ship; anything outside it falls back to language-only matching, and
 * the UI shows which real voice a persona resolved to rather than pretending
 * the choice always took effect. Which voices exist depends on the language
 * packs installed - a machine with only the US English pack genuinely cannot
 * speak with a British accent, and saying so is better than silently using the
 * wrong one.
 */

export type VoiceGender = 'female' | 'male'

export interface VoicePersona {
  id: string
  label: string
  /** Language tags to try, best first. */
  langs: string[]
  gender: VoiceGender
}

export const VOICE_PERSONAS: VoicePersona[] = [
  { id: 'system', label: 'System default', langs: [], gender: 'female' },
  { id: 'us-f', label: 'American woman', langs: ['en-US'], gender: 'female' },
  { id: 'gb-f', label: 'British woman', langs: ['en-GB'], gender: 'female' },
  { id: 'au-f', label: 'Australian woman', langs: ['en-AU'], gender: 'female' },
  { id: 'us-m', label: 'American man', langs: ['en-US'], gender: 'male' },
  { id: 'gb-m', label: 'British man', langs: ['en-GB'], gender: 'male' },
  { id: 'au-m', label: 'Australian man', langs: ['en-AU'], gender: 'male' }
]

/**
 * Known system voices, by gender. Lowercased first names, because the full
 * strings differ between platforms ("Microsoft Zira Desktop - English
 * (United States)" vs "Microsoft Zira Online (Natural)").
 */
const FEMALE_NAMES = [
  // Classic SAPI
  'zira', 'hazel', 'susan', 'catherine', 'linda', 'heera', 'eva',
  // Windows 11 "Natural" / Edge online voices
  'ava', 'aria', 'jenny', 'michelle', 'ana', 'sonia', 'libby', 'maisie', 'natasha',
  'clara', 'emma', 'amber', 'ashley', 'cora', 'elizabeth', 'monica', 'nancy', 'sara',
  // macOS
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'serena', 'freya',
  'female', 'woman'
]
const MALE_NAMES = [
  // Classic SAPI
  'david', 'mark', 'george', 'james', 'ravi',
  // Windows 11 "Natural" / Edge online voices
  'ryan', 'guy', 'christopher', 'eric', 'roger', 'steffan', 'thomas', 'william',
  'liam', 'andrew', 'brian', 'brandon', 'jacob', 'tony', 'davis', 'jason',
  // macOS
  'alex', 'daniel', 'oliver', 'gordon', 'fred', 'rishi',
  'male', 'man'
]

export interface AvailableVoice {
  name: string
  lang: string
  default?: boolean
}

export function genderOf(voiceName: string): VoiceGender | null {
  const name = voiceName.toLowerCase()
  if (FEMALE_NAMES.some((n) => name.includes(n))) return 'female'
  if (MALE_NAMES.some((n) => name.includes(n))) return 'male'
  return null
}

export interface VoiceResolution {
  /** The voice to actually speak with, or null for the browser default. */
  voice: AvailableVoice | null
  /** True when we found a voice matching both accent and gender. */
  exact: boolean
  /** Why the persona could not be honoured, for the UI to show plainly. */
  note: string | null
}

/** Resolve a persona against the voices this machine actually has. */
export function resolveVoice(personaId: string, voices: AvailableVoice[]): VoiceResolution {
  const persona = VOICE_PERSONAS.find((p) => p.id === personaId)
  if (!persona || persona.id === 'system' || voices.length === 0) {
    return { voice: null, exact: true, note: null }
  }

  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const pool = english.length > 0 ? english : voices

  for (const lang of persona.langs) {
    const sameLang = pool.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang.toLowerCase()))
    if (sameLang.length === 0) continue

    const match = sameLang.find((v) => genderOf(v.name) === persona.gender)
    if (match) return { voice: match, exact: true, note: null }

    return {
      voice: sameLang[0],
      exact: false,
      note: `No ${persona.gender} ${lang} voice is installed — using ${sameLang[0].name}.`
    }
  }

  // No voice for that accent at all: fall back to the right gender in any
  // accent, which sounds far less wrong than the right accent in the wrong one.
  const byGender = pool.find((v) => genderOf(v.name) === persona.gender)
  if (byGender) {
    return {
      voice: byGender,
      exact: false,
      // Deliberately says "the app can't see", not "isn't installed". Windows
      // 11's newer "Natural" voices are visible to Settings and Edge but are
      // not always enumerated by the speech engine an Electron app gets, so
      // blaming the user's install would often be simply wrong.
      note: `No ${persona.langs[0]} voice is available to the app — using ${byGender.name}. See the list below for what it can actually see.`
    }
  }

  return {
    voice: pool[0] ?? null,
    exact: false,
    note: `Couldn't match that voice on this machine — using ${pool[0]?.name ?? 'the system default'}.`
  }
}
