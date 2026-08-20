# Vendored fonts

Both faces are bundled rather than linked, because the app has **no network at
first paint** and a CSP of `default-src 'self'` — with no `font-src` of its own,
so fonts fall back to `'self'`. A `<link>` to `fonts.googleapis.com` would be
blocked outright and every heading would silently render in the fallback stack.

| File | Face | Subset | Source |
|---|---|---|---|
| `cinzel-700-latin.woff2` | Cinzel 700 | latin | Google Fonts, Cinzel v26 |
| `manrope-var-latin.woff2` | Manrope 200–800 variable | latin | Google Fonts, Manrope v20 |
| `manrope-var-latin-ext.woff2` | Manrope 200–800 variable | latin-ext | Google Fonts, Manrope v20 |

Manrope ships as one variable file covering the whole weight axis — Google Fonts
serves the identical URL for the 400, 500 and 700 requests — so all three weights
we use cost one download.

Only the Latin subsets are here. A glyph outside them (Cyrillic, Greek, CJK)
falls through to the next family in the stack automatically, which is the right
outcome for a character name the font cannot draw.

## Licence

Both are SIL Open Font License 1.1 — see `Cinzel-OFL.txt` and `Manrope-OFL.txt`,
which ship with the app. The OFL permits bundling in an application; it requires
that the licence travel with the font, which is what those two files are for.

- Cinzel — Copyright 2020 The Cinzel Project Authors, https://github.com/NDISCOVER/Cinzel
- Manrope — Copyright 2018 The Manrope Project Authors, https://github.com/sharanda/manrope

## Refreshing

Ask the Google Fonts CSS API with a Chrome user agent (an older UA gets you
`woff`/`ttf` instead of `woff2`), then pull the URLs it names:

```
https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Manrope:wght@400;500;700&display=swap
```

Take the `/* latin */` and `/* latin-ext */` blocks and ignore the rest.
