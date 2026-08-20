/**
 * The colour schemes, as data.
 *
 * The values themselves live in theme.css - this is only what the picker needs
 * to draw a swatch and what the app needs to validate a stored id. Keeping the
 * two in step is the cost of having a picker at all; the alternative is
 * reading computed styles off a hidden element, which is worse.
 *
 * The three swatch colours are ground / accent / secondary, in that order,
 * which is enough to recognise a scheme without applying it.
 */

export interface ThemeDef {
  id: string
  name: string
  /** One line, said plainly - what it looks like, not how it feels. */
  note: string
  /** Ground, accent, secondary - for the picker's swatch only. */
  swatch: [string, string, string]
}

export const THEMES: ThemeDef[] = [
  {
    id: 'obelisk',
    name: 'Obelisk',
    note: 'Near-black violet, amethyst accent, cyan highlights.',
    swatch: ['#120e1b', '#a855f7', '#56b8e0']
  },
  {
    id: 'nightfall',
    name: 'Nightfall',
    note: 'Deep indigo, periwinkle accent, cyan highlights.',
    swatch: ['#0a0a1a', '#8b93ff', '#4fb6dd']
  },
  {
    id: 'emberwatch',
    name: 'Emberwatch',
    note: 'Warm charcoal, magenta-crimson accent, amber highlights.',
    swatch: ['#100b0e', '#f04d8c', '#d09257']
  },
  {
    id: 'thicket',
    name: 'Thicket',
    note: 'Deep pine, lime accent, blue-teal highlights.',
    swatch: ['#07110b', '#a8d63f', '#4fa8c8']
  },
  {
    id: 'ironclad',
    name: 'Ironclad',
    note: 'Neutral slate, steel blue. The quiet one.',
    swatch: ['#0c0e11', '#7fb6d4', '#8a95a5']
  }
]

/**
 * Renaming this id from 'voidforge' is safe by construction: `isTheme` rejects
 * the old id, so a settings file still holding it falls through to the default
 * - which is the same scheme, retuned. Nobody lands on a broken theme, and
 * nothing has to migrate.
 */
export const DEFAULT_THEME = 'obelisk'

export function isTheme(id: string): boolean {
  return THEMES.some((t) => t.id === id)
}

/**
 * Put a scheme on the document.
 *
 * The default is written as an absent attribute rather than as
 * `data-theme="obelisk"`, because its values ARE the `:root` block - a
 * scheme selector that restates the defaults is a second copy to keep in step.
 *
 * The element is typed structurally rather than as an HTMLElement: this module
 * is shared, and the main process typechecks without the DOM library.
 */
interface AttributeHost {
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
}

export function applyTheme(id: string, root: AttributeHost): void {
  if (isTheme(id) && id !== DEFAULT_THEME) root.setAttribute('data-theme', id)
  else root.removeAttribute('data-theme')
}
