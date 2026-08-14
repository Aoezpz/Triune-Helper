import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/ipc'
import { applyTheme, DEFAULT_THEME, isTheme, THEMES } from '../src/shared/themes'

/**
 * Colour schemes.
 *
 * The interesting assertions are not about taste. They are that the picker's
 * list and the stylesheet agree, and that the reserved colours - status, trio
 * slots, chart series - are absent from every scheme, because those carry
 * meaning and a scheme that repainted them would be lying rather than
 * decorating.
 */

function host(): { attrs: Record<string, string>; el: Parameters<typeof applyTheme>[1] } {
  const attrs: Record<string, string> = {}
  return {
    attrs,
    el: {
      setAttribute: (k, v) => {
        attrs[k] = v
      },
      removeAttribute: (k) => {
        delete attrs[k]
      }
    }
  }
}

describe('themes', () => {
  it('ships the default the settings actually start on', () => {
    expect(isTheme(DEFAULT_THEME)).toBe(true)
    expect(DEFAULT_SETTINGS.theme).toBe(DEFAULT_THEME)
  })

  it('has no duplicate ids', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
  })

  it('gives every scheme a name, a note and three swatch colours', () => {
    for (const t of THEMES) {
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.note.length).toBeGreaterThan(0)
      expect(t.swatch).toHaveLength(3)
      for (const hex of t.swatch) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  /**
   * The reserved colours. --good, --bad, --warn and the three trio slots are
   * the same in every scheme; a swatch that reproduced one of them would mean
   * a scheme had been allowed to claim a hue that means something.
   */
  it('keeps every accent clear of the reserved colours', () => {
    const reserved = ['#49d0a0', '#e0645c', '#e6b455', '#38bdf8', '#fbbf24', '#e879f9']
    for (const t of THEMES) {
      for (const hex of t.swatch) expect(reserved).not.toContain(hex)
    }
  })

  describe('applyTheme', () => {
    it('sets the attribute for a non-default scheme', () => {
      const h = host()
      applyTheme('thicket', h.el)
      expect(h.attrs['data-theme']).toBe('thicket')
    })

    /**
     * The default IS the :root block, so naming it would mean maintaining the
     * same values in two places.
     */
    it('removes the attribute for the default rather than naming it', () => {
      const h = host()
      applyTheme('thicket', h.el)
      applyTheme(DEFAULT_THEME, h.el)
      expect(h.attrs['data-theme']).toBeUndefined()
    })

    it('falls back to the default on an id it does not know', () => {
      const h = host()
      applyTheme('thicket', h.el)
      // A config hand-edited to a scheme that was removed, or written by a
      // newer build. Either way it must not leave a dead attribute behind.
      applyTheme('chartreuse-explosion', h.el)
      expect(h.attrs['data-theme']).toBeUndefined()
    })

    it('treats an empty setting as the default', () => {
      const h = host()
      applyTheme('', h.el)
      expect(h.attrs['data-theme']).toBeUndefined()
    })
  })
})
