# Rebrand — Nexus Reader

Decided 2026-08-16. Direction E from the rebrand canvas
(https://claude.ai/code/artifact/b3c08873-1d3e-41f1-ab1e-179f7357f4e3).
Ships as **0.2.0**.

## Identity

| | |
|---|---|
| Name | **Nexus Reader** |
| Descriptor | **Emu Multitool** — server-agnostic on purpose; never name a server |
| Positioning | A log companion for three-classes-in-one EverQuest emulator servers |

Two reasons this name won: "Emu Multitool" claims the whole category rather than
one server, and "Reader" states the app's central promise — that it only ever
reads — in the name itself.

**Triune, Project Triune and PTDex disappear from the product surface.** PTDex
stays as a *configurable data source* (Preferences → `ptdexBase`), not as
branding. It must keep working with the field empty.

## Tokens

Replacing the brand half of `src/shared/theme/theme.css`. The current values were
lifted verbatim from PTDex's `nms.css`, so they go with the name.

```
--void        #0a0810   violet-tinted near black (was #06070c)
--abyss       #120e1b   sidebar top (was #0a0c14)
--ink         #15111f
--surface     #15111f
--surface-2   #1d1729
--surface-3   #252036
--line        #2a2338   (was #2b3441)
--line-2      #352c47
--accent      #a855f7   replaces --gold #ff8a4a
--accent-hi   #c9a2ff   replaces --gold-hi
--accent-deep #7c3aed   replaces --gold-deep
--text        #ece9f2   (was #ece5d6)
--text-2      #a29bb0
--muted       #6f6880
```

Titlebar gradient becomes `rgba(18,14,27,.97) → rgba(18,14,27,.88)`; the sidebar
gradient `#120e1b → #0a0810`.

**Do not touch, in any scheme:**

- `--good #49d0a0`, `--bad #e0645c`, `--warn #e6b455` — they mean something and
  appear inline among data.
- `--slot-1 #38bdf8`, `--slot-2 #fbbf24`, `--slot-3 #e879f9` — positional, and
  chosen to stay separable under protan/deutan vision. The violet was picked
  partly because it reads clearly against all three.

The `--gold`/`--arcane` token NAMES are used throughout the CSS. Renaming them to
`--accent` is a large mechanical diff; retuning their values in place is a small
one. Prefer retuning unless doing the rename deliberately.

## Type

- Wordmark and page titles: **Cinzel** 700 (Google Fonts) — inscriptional Roman
  caps, the closest real face to the key art's lettering. Fallback
  `"Trajan Pro", Georgia, serif`.
- Interface: **Manrope** 400/500/700. Fallback `"Segoe UI", system-ui, sans-serif`.
- Figures: keep the existing `--nms-mono` stack.

Replaces the Iowan Old Style / Palatino serif stack.

## The mark

A flat reduction of the key art, because the art itself becomes a violet smudge
at 16px. Broken ring (the distinctive silhouette) around three bars that read as
a meter and as the trio at once; the centre bar is the obelisk from the art.

48×48 viewBox:

```svg
<path d="M11.14 8.68A20 20 0 1 1 11.14 39.32" stroke="#5b5170" stroke-width="3.6" stroke-linecap="round"/>
<rect x="14.5" y="25" width="4.6" height="9"  rx="1.6" fill="#a855f7" opacity="0.55"/>
<path d="M21.7 34V19.5L24 14.5L26.3 19.5V34Z" fill="#c9a2ff"/>
<rect x="28.9" y="22" width="4.6" height="12" rx="1.6" fill="#a855f7" opacity="0.8"/>
```

**16px variant** — the two outer bars drop; ring plus spire still reads:

```svg
<path d="M11.14 8.68A20 20 0 1 1 11.14 39.32" stroke="#5b5170" stroke-width="6.5" stroke-linecap="round"/>
<path d="M20 35V19L24 12L28 19V35Z" fill="#c9a2ff"/>
```

The key art itself is kept, unchanged, for the GitHub header, the release banner
and the installer splash — places a picture gets a whole screen. Source is on the
desktop; a 520px JPEG copy is at `design/keyart.jpg`.

## Work, in order

1. `src/shared/theme/theme.css` — retune the brand tokens above.
2. `src/renderer/src/components/Crest.tsx` — replace the crest with the mark.
3. `build/_icon-main.cjs` + `scripts/make-icon.mjs` — redraw; regenerate
   `icon.png` and the seven-size `icon.ico`. Use the 16px variant for the 16 and
   24 entries.
4. `src/renderer/src/components/TitleBar.tsx` — wordmark "Nexus Reader",
   sub-line "Emu Multitool", Cinzel on the wordmark.
5. Google Fonts links for Cinzel + Manrope, or vendor them — **the app has no
   network at first paint and a CSP locked to 'self'**, so vendoring as
   `@font-face` with base64 or local files is the safer route. Check the CSP
   before assuming the Google Fonts host is allowed here; it is allowed in
   artifacts, which is a different sandbox.
6. `package.json` — `name`, `description`, and the version to 0.2.0.
7. `electron-builder.yml` — `appId`, `productName`, `shortcutName`,
   `artifactName`. **See the migration note below before changing productName.**
8. `scripts/bundle.mjs` — the staged filenames and README copy.
9. `README.md`, `docs/TESTING.md`, `docs/index.html`, `LICENSE` copyright line.
10. GitHub: rename the repo (redirects are automatic; the Pages URL changes),
    update the `publish:` block in `electron-builder.yml` and every absolute URL
    in `docs/index.html` and the release notes.

## Migration hazard — read before renaming productName

`app.getPath('userData')` is derived from the app name, and every store lives
there: `triune-helper.json` (settings), `triune-leveling.json`,
`triune-server.json`, plus alerts, flags, zones, mobs and loot ledgers.

Renaming the app silently moves userData to a new folder. Existing users would
open 0.2.0 to a first-run app with no settings, no alert rules, no flag progress
and empty lifetime ledgers — with the old data still on disk, invisible.

Either:

- **Keep the electron-store `name:` fields as they are** (`triune-helper`,
  `triune-leveling`, `triune-server`) and set `app.setPath('userData', …)` to the
  old folder, or
- **Copy the folder forward on first run** if the new one is absent and the old
  one exists, and say so in the release notes.

The second is cleaner long-term. Neither is optional — losing a month of ledgers
on a rename is exactly the kind of quiet data loss this app is supposed to be
better than.

## As built — 0.2.0

Steps 1-9 are done. Where the build departed from the spec above, and why:

- **The fonts are vendored, not linked.** Confirmed the app's CSP is
  `default-src 'self'` with no `font-src`, so a Google Fonts `<link>` would have
  been blocked outright. `src/shared/theme/fonts/` holds Cinzel 700 and Manrope
  (one variable file covers 400/500/700), 55 KB total, with both OFL licences.
- **The ring in the mark is `#8778ab`, not `#5b5170`.** The spec's value was
  read off a light artboard; on the app's near-black ground it vanished and left
  three bars floating.
- **The `--gold`/`--arcane`/`--ember` token NAMES stayed.** Retuned in place, as
  the spec recommended. Same for `window.triune` in the preload bridge and the
  `TRIA1:` alert-share prefix - the second is a wire format, and renaming it
  would break every rule anyone has already pasted into Discord.
- **`appId` stayed `com.projecttriune.helper`.** NSIS finds the previous install
  through that key. Changing it would have installed alongside 0.1.x rather than
  upgrading it. It is internal; nothing on screen reads it.
- **`productName` was added to `package.json` as well as electron-builder.yml.**
  Without it, dev resolves userData from `name` (`nexus-reader`) and the packaged
  build from `productName` (`Nexus Reader`) - two different folders, and the
  divergence would only show up in production.
- **The default scheme id went `voidforge` -> `obelisk`.** Safe by construction:
  `isTheme` rejects the old id, so a stored `voidforge` falls through to the
  default, which is that same scheme retuned.

Fixed along the way, all pre-existing:

- `--r-1`, `--r-2` and `--r-3` were used a dozen times in `app.css` and defined
  nowhere, so those radii resolved to nothing and rendered square. Aliased.
- `.dot` had no `display`, so inside a `<p>` - the Overview hero - it ignored its
  own width and painted a green rectangle across the line box.
- `.btn.primary`'s dark label over the deep end of the accent gradient fell under
  4.5:1 in two schemes.

Also added: the Overview banner carries key art (`assets/hero-portal.jpg`), full
bleed across the panel. Three notes for whoever replaces it.

**Send it at whatever ratio the generator gives.** The art is 21:9 (1920x819)
and the panel is nearer 15:4, so `cover` gives up some height. Which height is
chosen by `background-position: center 38%` - biased upward, because the top of
the frame holds the ring's crown and the bottom holds foreground paving, and of
the two the crown is worth keeping. Nothing needs to be cropped or padded by
hand.

**The scrim is load-bearing, not decoration.** This artwork is lit across its
full width, so the left-hand gradient in `.loot-hero.hero-art` is the only thing
standing between the copy and an unreadable background. Every stop is a token,
so it tracks the scheme.

**An earlier draft of the art was a mock-up** carrying an invented character
name and seven lines of invented log text. Those were painted out before
bundling. If a future banner arrives with sample text baked in, do the same -
this app does not put fabricated log lines on screen beside real ones.

## Still open

- **Step 10, the GitHub rename**, which needs a decision rather than a commit:
  every `github.com/Aoezpz/Triune-Helper` URL in `docs/index.html`,
  `src/shared/update.ts` and `electron-builder.yml` is deliberately unchanged
  until the repo itself is renamed. They work today; renaming the repo makes
  GitHub redirect them, so either state is consistent - a half-done rename is
  not.
- The Zones and Loot page banners still draw the procedural starfield.
- Whether the window title stays "Nexus Reader" alone or carries the server it is
  pointed at.
