# Triune-Helper

A companion app for **Project Triune**. It reads the log files EverQuest already
writes and turns them into a live DPS meter, a fight timeline, trigger alerts,
flag progression and the server's raid boards.

**It only reads your log.** Nothing is injected into EverQuest, no game file is
touched, no memory is read, and nothing is played for you. Turn logging off and
the app has nothing to show.

---

## Getting started

1. Install and run it. It is a per-user install like Discord — no admin prompt.
2. In game, type `/log on` for **each character you box**.
3. That's it. The app finds `eqlog_<Character>_multiclass.txt` on its own,
   usually under `…\Logs\`. If your install lives somewhere unusual, point it at
   the right folder in **Preferences** and it attaches immediately.

Windows will warn about an unrecognised app the first time you run the
installer. That is SmartScreen reacting to an unsigned binary, not a virus
warning — there is no code-signing certificate for this project, and the
reputation that suppresses the warning is bought, not earned by being safe.

## What it does

| Section | What you get |
|---|---|
| **Combat** | Live meter with per-skill breakdowns, a rolling DPS curve, damage by mob, procs, and the raw stream. A **Timeline** view puts one lane per skill so you can see misses as gaps. |
| **Progression** | Expansion gates and Plane of Time flags, ticked the moment the boss dies in your log. |
| **Leaderboards** | The server's raid boards — first clears, fastest kills, highest DPS, by bracket. Read-only. |
| **Alerts** | Rules over log lines with sounds and speech. Shareable as one `TRIA1:` string you can paste into Discord. |
| **Leveling** | Levels, ability points and kill rate per character. |
| **Loot** | What dropped and what the server auto-sold, priced in copper so the arithmetic is exact. |
| **Zones** | A lifetime ledger: where the hours went, kills and coin per zone. |
| **Mobs** | A bestiary — kills, kill times, damage traded, and which mobs have actually killed you. |
| **Timers** | Countdowns you set, plus respawn windows worked out from gaps between your own kills. |
| **Server** | World blessings with live countdowns, who is levelling and arriving, and auction traffic. |
| **Overlays** | Always-on-top meter and stream windows. They open **locked** — click-through, so a stray click lands on the game instead of stealing focus from it. |

Preferences also carries five colour schemes and a **Rebuild from logs** button that
replays every `eqlog` on disk into the lifetime ledgers, so a folder with a year of
history in it does not start at zero.

### Boxing a trio

All three clients write a log, and any line that isn't about *you* appears in
**all three**. Summing them would triple every mob swing and every group-mate's
damage. So each event is counted from exactly one log: your own swings from
your own log, your pet from its owner's log, everything else from the log you
nominate as **primary** in Preferences.

The test suite asserts that three logs of one fight total exactly what one log
of that fight totals — and that two genuinely simultaneous identical hits are
*not* collapsed into one.

### Boxing several accounts that are not grouped

Reading somebody's log is not evidence they are standing next to you. Two
characters at different camps share no lines at all, so there are no duplicates
to remove — and routing everything through one "primary" log would throw away
whatever happened to the other one. So an event whose **target** is one of your
characters is counted from that character's own log, whoever is primary, and the
party strip shows the group of the character selected in the title bar rather
than every log that happens to be open.

### Overlays need borderless windowed mode

Exclusive fullscreen owns the display outright and nothing can draw above it.
That is how DirectX works, not something the app can route around.

## Things it deliberately does not do

- **No XP percentage.** EverQuest logs record *that* you gained experience,
  never how much. The Leveling page charts levels, ability points and rates.
  An XP bar would have to be invented.
- **No leaderboard submissions.** The game server records every ranked clear
  itself. The app only reads the boards.
- **No guessing at flags it cannot see.** Steps that no log line announces —
  "plead Mavuin's case", "passage to the Halls of Honor" — are marked *by hand*
  and say so.

## Development

```bash
npm install
npm run dev        # app + hot reload
npm test           # parser, merge, alerts and voice suites
npm run build      # typecheck + bundle
npm run package    # Windows installer -> release/<version>/
```

Drive the UI without the game running:

```bash
node scripts/replay.mjs --out "C:\temp\Logs" --speed 4
```

It writes three synthetic character logs in real time, duplicating third-party
lines across all three exactly the way real clients do — which is the point,
since that duplication is what the merge rule exists to handle.

### Regenerating bundled data

```bash
node scripts/export-progression.mjs                    # data/progression.json, from PTDex
node scripts/export-buffs.mjs "<path>\spells_us.txt"   # data/buffs.json, from the client
node scripts/make-icon.mjs                             # build/icon.png + icon.ico
```

### Finding what the parser misses

```bash
node scripts/unparsed.mjs "<path>\eqlog_<Char>_multiclass.txt"
```

Ranks every log line the parser currently ignores, commonest first. Almost every
feature in the app started here — heals, absorbs, specials, blessings and the
buff board were all found by reading that list rather than by guessing at what
EverQuest might write.

## Licence, credit and what this is not

MIT — see [LICENSE](LICENSE). The bundled data has its own provenance, set out
in [data/README.md](data/README.md): the buff index is derived from the
EverQuest client's `spells_us.txt` and is not this project's to license.

The idea came from **[EQ Legends Companion](https://github.com/jmoyers/everquest-companion)**
by Josh Moyers — a companion app for a different server that showed what a log
reader could be. No code was taken from it; the parser was built against Project
Triune's own logs and the theme is PTDex's. The shared shape of the two repos
(`src/main`, `src/preload`, `src/renderer`, `electron.vite.config.ts`,
`electron-builder.yml`) is the `create-electron` react-ts scaffold both started
from, not a common ancestor.

EverQuest is a trademark of Daybreak Game Company LLC. This project is not
affiliated with or endorsed by them. It reads a text file the game already
writes — no memory reads, no injection, nothing written near the game folder —
which is the same ground log parsers have stood on since GamParse.

### Known rough edges

- **Scraped pages can rot.** The leaderboards and the bundled progression data
  come from PTDex's own markup, because there is no JSON endpoint for either. If
  the site changes, the page says so plainly rather than showing empty boards.
- **The buff board only shows unambiguous spells.** It reads effect messages out
  of the client's `spells_us.txt`, and keeps only those naming exactly one spell.
  "Your protection fades." belongs to 26 of them and is skipped rather than
  guessed at. There are no durations either — the log never states one.
- **World blessings have no expiry message.** The server announces one when it
  is switched on or extended, and never again, so one that started while you
  were logged out is invisible.
- **Windows 11 "Natural" voices** may not be visible to the app's speech
  engine even when Windows lists them. Preferences shows exactly which voices
  it can see, so you can tell that apart from "not installed".
- **No code-signing certificate**, so SmartScreen warns on first run. That is
  bought reputation, not a safety judgement.
