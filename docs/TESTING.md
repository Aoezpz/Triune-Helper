# Nexus Reader — test build

Thanks for trying this. It is an **emu multitool** for three-classes-in-one
EverQuest emulator servers: it reads
the log file EverQuest already writes and turns it into a live DPS meter, fight
history, alerts, loot and zone ledgers, timers and a few other things.

**It only ever reads.** Nothing is injected into EverQuest, no game file is
touched, no memory is read, and nothing is played for you. Turn logging off and
the app has nothing to show. It also needs no admin rights.

---

## 1. Install

Run **`Nexus-Reader-Setup-0.1.0.exe`**.

Windows will say *"Windows protected your PC"* and offer only a **Don't run**
button. Click **More info → Run anyway**.

That warning is SmartScreen reacting to an unsigned installer. There is no
code-signing certificate for this project — the reputation that suppresses the
warning is bought, not earned by the app being safe — so every tester will see
it.

Then click through the installer. It finishes on a page with **Run
Nexus Reader** ticked, so the app opens straight away. No admin prompt.

### If nothing seems to happen

It installs per-user and quietly. You should end up with all of these:

- **Start menu → Nexus Reader**
- a **Nexus Reader** shortcut on your desktop
- the program itself at
  `%LOCALAPPDATA%\Programs\Nexus Reader\Nexus Reader.exe` — paste that into
  the address bar of File Explorer to check

If the shortcuts are there but the app never opens, that is worth reporting, and
so is an antivirus that removes the file after installing it. Check **Windows
Security → Virus & threat protection → Protection history** if you suspect that
— an unsigned binary is sometimes quarantined without a visible prompt.

## 2. Turn logging on

In game, for **each character you play**, type:

```
/log on
```

Nothing appears in the app until you do this. It is the only setup step.

## 3. First run

The app looks for `eqlog_<Character>_multiclass.txt` by itself and normally
finds it. If it doesn't, open **Preferences → Log source** and either press
**Auto-detect** or **Browse…** to your `…\Logs\` folder. It attaches straight
away — no restart.

Then go and kill something. The **Combat** page fills in as the log is written.

---

## What to look at

Roughly in order of how likely something is to be wrong:

| Where | What to check |
|---|---|
| **Combat** | Does the DPS number look right? Do your abilities and procs show up? Anything obviously missing from the breakdown? |
| **Combat → the party strip** | Does it show the people you are actually grouped with — and *nobody else*? |
| **Loot / Zones / Mobs** | Do the totals match what you think happened? |
| **Overlays** (`Overlay ▾`) | Do they stay on top of the game? Does a click on one leave your character running? |
| **Alerts** | Make a rule, get it to fire, check the sound and speech. |
| **Timers** | Set a countdown, minimise the app, confirm it still goes off. |
| **Preferences** | Try the colour schemes. Try a different alert voice. |

**If you have played this character for a while**, press **Preferences → History
→ Rebuild from logs** once. It replays every log on disk into the Zones, Mobs,
Loot and Leveling ledgers, so they show your history rather than starting at
zero. It clears those four first, so running it twice gives the same answer
rather than double.

### Boxing more than one character

Log in as usual and the app picks up every log. Use the **character picker in
the title bar** to say which one you are actually playing — that decides whose
group the party strip describes. If you box two accounts that are *not* grouped,
they should show as separate, not as a party.

---

## Known, please don't report these

- **The SmartScreen warning.** Expected; see above.
- **Overlays open locked** — clicks pass straight through them. That is
  deliberate, so a stray click can't take focus off the game and leave your
  character running. Unlock from **Overlay ▾ → Lock** in the main window to move
  or resize one.
- **Overlays don't appear over exclusive fullscreen.** Use borderless windowed.
  Nothing can draw above exclusive fullscreen; that is how DirectX works.
- **No XP percentage anywhere.** EverQuest records *that* you gained experience,
  never how much. AA is different — the server prints the count, so that bar is
  real.
- **No buff durations.** The log never states one. The buff board shows what is
  on you and how long it has been there, not how long is left.
- **"Quiet" is not "offline".** Overview marks a character live when the game
  wrote to their log in the last two minutes. EverQuest writes nothing at all
  for someone standing still in an empty zone, so a character who is logged in
  but idle reads as quiet. Hover the word for when the game last wrote.
- **World blessings can look empty or stale.** The server only announces one
  when it is switched on or extended, and never says when it ends.
- **Lifetime totals start at install** unless you press Rebuild from logs.
- **Spawn windows are estimates** and say so — they are the shortest gap between
  two of your own kills, which is always longer than the real respawn.

## Worth reporting

- Any number that is **wrong**, especially if it is too low — a missing pattern
  is the commonest bug and it fails quietly.
- Anything that says a fact it cannot know.
- Text that overflows its box, overlaps, or gets cut off.
- Anything that hangs, spins forever, or won't close.
- The app doing anything at all to your game.

### What makes a report useful

1. **Which page**, and a screenshot if it is visual.
2. **The log line**, if it is about a number. Combat → **Stream** has a **raw**
   toggle that shows lines the app didn't understand; those are gold.
3. What you expected instead.

---

## Where it keeps things, and removing it

All of its own data lives in:

```
%APPDATA%\Nexus Reader
```

Settings, alert rules, flag progress and the lifetime ledgers are all there —
**nothing is written anywhere near your EverQuest folder.** Uninstall from
Windows *Apps & features*; that leaves `%APPDATA%\Nexus Reader` alone on
purpose, so reinstalling doesn't wipe your rules. Delete that folder by hand for
a genuinely clean slate.

---

*Version 0.1.0 · Windows x64 · unsigned test build*
