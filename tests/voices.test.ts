import { describe, expect, it } from 'vitest'
import { genderOf, resolveVoice, VOICE_PERSONAS, type AvailableVoice } from '../src/shared/voices'

/** A typical Windows 11 machine with only the US English pack installed. */
const US_ONLY: AvailableVoice[] = [
  { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US' },
  { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US' }
]

/** A machine with the extra language packs added. */
const FULL: AvailableVoice[] = [
  ...US_ONLY,
  { name: 'Microsoft Mark - English (United States)', lang: 'en-US' },
  { name: 'Microsoft Hazel Desktop - English (Great Britain)', lang: 'en-GB' },
  { name: 'Microsoft George - English (Great Britain)', lang: 'en-GB' },
  { name: 'Microsoft Catherine - English (Australia)', lang: 'en-AU' },
  { name: 'Microsoft James - English (Australia)', lang: 'en-AU' }
]

describe('gender lookup', () => {
  it('recognises the common Windows voices', () => {
    expect(genderOf('Microsoft Zira Desktop - English (United States)')).toBe('female')
    expect(genderOf('Microsoft David Desktop - English (United States)')).toBe('male')
    expect(genderOf('Microsoft Hazel Desktop - English (Great Britain)')).toBe('female')
    expect(genderOf('Microsoft George - English (Great Britain)')).toBe('male')
  })

  it('returns null rather than guessing at an unknown voice', () => {
    expect(genderOf('Acme Speech Engine v2')).toBeNull()
  })
})

describe('persona resolution', () => {
  it('matches accent and gender exactly when the voice exists', () => {
    for (const [personaId, expected] of [
      ['gb-f', 'Hazel'],
      ['gb-m', 'George'],
      ['au-f', 'Catherine'],
      ['au-m', 'James'],
      ['us-f', 'Zira'],
      ['us-m', 'David']
    ] as const) {
      const res = resolveVoice(personaId, FULL)
      expect(res.exact, personaId).toBe(true)
      expect(res.voice?.name, personaId).toContain(expected)
      expect(res.note, personaId).toBeNull()
    }
  })

  it('falls back to the right gender when the accent is not installed', () => {
    const res = resolveVoice('gb-f', US_ONLY)
    expect(res.exact).toBe(false)
    // The right gender in the wrong accent beats the wrong gender.
    expect(res.voice?.name).toContain('Zira')
    expect(res.note).toMatch(/en-GB/)
  })

  it('says the accent is unavailable to the app, not that it is uninstalled', () => {
    const res = resolveVoice('au-m', US_ONLY)
    // Wording matters here: Windows 11 lists "Natural" voices that Settings
    // can use but the app's speech engine cannot enumerate, so telling the
    // user to install one they already have would be wrong.
    expect(res.note).toMatch(/available to the app/)
    expect(res.note).not.toMatch(/installed/)
    expect(res.voice?.name).toContain('David')
  })

  it('finds the Windows 11 Natural voices when the engine does expose them', () => {
    const natural: AvailableVoice[] = [
      { name: 'Microsoft Ava (Natural HD) - English (United States)', lang: 'en-US' },
      { name: 'Microsoft Sonia (Natural) - English (United Kingdom)', lang: 'en-GB' },
      { name: 'Microsoft Ryan (Natural) - English (United Kingdom)', lang: 'en-GB' },
      ...US_ONLY
    ]
    expect(resolveVoice('gb-f', natural).voice?.name).toContain('Sonia')
    expect(resolveVoice('gb-f', natural).exact).toBe(true)
    expect(resolveVoice('gb-m', natural).voice?.name).toContain('Ryan')
    expect(resolveVoice('gb-m', natural).exact).toBe(true)
    expect(genderOf('Microsoft Ava (Natural HD) - English (United States)')).toBe('female')
  })

  it('leaves the system default alone', () => {
    const res = resolveVoice('system', FULL)
    expect(res.voice).toBeNull()
    expect(res.exact).toBe(true)
  })

  it('survives a machine with no voices at all', () => {
    const res = resolveVoice('us-f', [])
    expect(res.voice).toBeNull()
    expect(res.exact).toBe(true)
  })

  it('ignores non-English voices when English ones exist', () => {
    const mixed: AvailableVoice[] = [
      { name: 'Microsoft Hedda - German (Germany)', lang: 'de-DE' },
      ...US_ONLY
    ]
    expect(resolveVoice('us-m', mixed).voice?.name).toContain('David')
  })

  it('every persona resolves to something on a normal machine', () => {
    for (const persona of VOICE_PERSONAS) {
      const res = resolveVoice(persona.id, US_ONLY)
      if (persona.id === 'system') expect(res.voice).toBeNull()
      else expect(res.voice).not.toBeNull()
    }
  })
})
