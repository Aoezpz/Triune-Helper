/**
 * What the server is doing, as opposed to what you are doing.
 *
 * Three things arrive on the same broadcast channel and belong on one page:
 * the world buffs that are currently running, who is levelling and arriving,
 * and what people are trying to sell.
 *
 * All three share one honest limitation, stated once here rather than three
 * times below: YOU ONLY SEE WHAT WAS BROADCAST WHILE YOU WERE LOGGED IN. Every
 * count on this page is a sample of the server taken during your play session,
 * never a total, and nothing here should ever be presented as a census of the
 * whole population.
 */

/* ---------------------------------------------------------------------------
   Server-wide blessings
--------------------------------------------------------------------------- */

export interface Blessing {
  name: string
  /** When the line was written. */
  seenAt: number
  /** Remaining duration it stated, in ms. */
  statedMs: number
  /** `seenAt + statedMs` - the wall-clock moment it runs out. */
  endsAt: number
}

export interface BlessingRow extends Blessing {
  remainingMs: number
  active: boolean
  /**
   * True when the app has been running long enough to be confident this is the
   * whole picture. See `blessingsAreComplete`.
   */
  stale: boolean
}

/**
 * How long a blessing can run.
 *
 * The NPC that sells them says "will last four hours", but they stack as
 * people extend them and a remainder of 27h13m has been observed - so the
 * first guess of 26 hours was already wrong on real data. Forty-eight is
 * generous on purpose: this figure only decides when a remembered blessing has
 * CERTAINLY expired, and being slow to call one dead is a much smaller error
 * than declaring a live one finished.
 */
export const MAX_BLESSING_MS = 48 * 60 * 60 * 1000

export function blessingRows(blessings: readonly Blessing[], now: number): BlessingRow[] {
  return blessings
    .map((b) => ({
      ...b,
      remainingMs: Math.max(0, b.endsAt - now),
      active: b.endsAt > now,
      // A line older than the longest possible blessing tells you nothing about
      // now - the window it described has certainly closed and been replaced.
      stale: now - b.seenAt > MAX_BLESSING_MS
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.remainingMs - a.remainingMs
    })
}

/**
 * Fold a sighting into what is already known.
 *
 * "activated/extended" is one message for two events, so a LATER line replaces
 * an earlier one for the same blessing - an extension is simply a fresh
 * statement of the remaining time.
 *
 * The order that matters is the line's, not the order we happened to read it
 * in. Those are different things here, and assuming otherwise was a real bug:
 * on attach every log is scanned for standing facts, and a character who was
 * offline this morning still holds Tuesday's broadcast near the end of their
 * file. Whichever log was scanned last used to win, so one camped alt could
 * overwrite this morning's blessings with a two-day-old copy and the page sat
 * showing four expired rows while the buffs were plainly running in game.
 *
 * Hence the guard: an older sighting never displaces a newer one.
 */
export function foldBlessing(into: Blessing[], name: string, seenAt: number, statedMs: number): Blessing[] {
  const existing = into.find((b) => b.name === name)
  if (existing && existing.seenAt >= seenAt) return into

  const next = into.filter((b) => b.name !== name)
  next.push({ name, seenAt, statedMs, endsAt: seenAt + statedMs })
  return next.sort((a, b) => a.name.localeCompare(b.name))
}

/* ---------------------------------------------------------------------------
   Who is on the server
--------------------------------------------------------------------------- */

export interface CensusEntry {
  name: string
  /** Classes as broadcast. One class for a first login, three for the rest. */
  classes: string
  /** Highest level seen broadcast for them. Null if only ever seen logging in. */
  level: number | null
  /** They were the first on the server to run this trio. */
  serverFirst: boolean
  firstSeen: number
  lastSeen: number
}

export interface CensusData {
  players: CensusEntry[]
  /** Trio combinations seen, most common first. */
  trios: Array<{ trio: string; count: number; firstBy: string | null }>
}

/** Three classes, or one. Normalised so `Bard/Druid` and `Druid/Bard` differ. */
export const isTrio = (classes: string): boolean => classes.includes('/')

export function foldCensus(
  into: Record<string, CensusEntry>,
  name: string,
  classes: string,
  at: number,
  opts: { level?: number; serverFirst?: boolean } = {}
): void {
  const existing = into[name]
  if (!existing) {
    into[name] = {
      name,
      classes,
      level: opts.level ?? null,
      serverFirst: opts.serverFirst === true,
      firstSeen: at,
      lastSeen: at
    }
    return
  }

  // A trio always beats a single class: the first-login broadcast names only
  // one of the three, so anything with slashes in it is strictly better
  // information about the same player.
  if (isTrio(classes) && !isTrio(existing.classes)) existing.classes = classes
  if (opts.level !== undefined) existing.level = Math.max(existing.level ?? 0, opts.level)
  if (opts.serverFirst) existing.serverFirst = true
  existing.lastSeen = Math.max(existing.lastSeen, at)
}

export function censusRows(players: Record<string, CensusEntry> | undefined): CensusData {
  const list = Object.values(players ?? {}).sort((a, b) => b.lastSeen - a.lastSeen)

  const counts = new Map<string, { count: number; firstBy: string | null }>()
  for (const p of list) {
    if (!isTrio(p.classes)) continue
    const at = counts.get(p.classes) ?? { count: 0, firstBy: null }
    at.count += 1
    if (p.serverFirst) at.firstBy = p.name
    counts.set(p.classes, at)
  }

  return {
    players: list,
    trios: [...counts.entries()]
      .map(([trio, v]) => ({ trio, ...v }))
      .sort((a, b) => b.count - a.count || a.trio.localeCompare(b.trio))
  }
}

/* ---------------------------------------------------------------------------
   The market, such as it is
--------------------------------------------------------------------------- */

export interface Offer {
  /** Who said it. */
  seller: string
  /** `auction` or `ooc` - the only two channels that carry trade. */
  channel: string
  /** The line verbatim, because the parse below is best-effort. */
  text: string
  at: number
  /** WTS / WTB / WTT / giveaway, when the line says. Null when it does not. */
  intent: 'sell' | 'buy' | 'trade' | 'give' | null
  /** Item names lifted out of the text. Often empty; see the note below. */
  items: string[]
}

/**
 * Free to a good home. Distinct from a sale because the answer to "what does it
 * cost" is different, and because it is the one kind of offer worth spotting
 * even when you were not shopping.
 *
 * The word "free" on its own carries it. That was left out at first as too
 * loose, and it cost the two most obviously free things anybody has shouted -
 * "free Mind Worm hide mantle (Legendary), Attuned Spire Shard..." and "2 more
 * free item, ..." - both filed as untagged chatter. Set phrases like "free to a
 * good home" are how people write when they are being tidy; most of the time
 * they just type "free" and list the loot.
 *
 * Three things stop it over-reaching. "feel free" is excluded, being the one
 * common phrase where the word means nothing. Zone names survive because \b
 * will not split "Freeport". And "anyone free for X" is caught earlier as a
 * group call, so an invitation never lands here.
 */
const GIVING_SAID = /free to a good home|giveaway|giving (?:it |them |these |those |away)|for free/
const GIVING_BARE = /(?<!feel )\bfree\b/

/**
 * Phrases that carry their own direction, so they survive a question mark.
 *
 * "anyone want a bracer?" and "anyone have a bracer?" are both questions and
 * they mean opposite things - the first is offering, the second is asking. The
 * phrase says which, so these are read before the question guard below.
 *
 * Wanting is tested first, because "anyone have X available" is somebody asking
 * for it, not somebody advertising it.
 */
const WANTING =
  /\b(?:any\s?(?:one|body|1)?\s+ha(?:ve|s)|still (?:available|around)|looking (?:for|to buy)|\biso\b|\blf\b)/
/**
 * "anyone want X" is an offer; "anyone want TO come" is a group forming.
 *
 * The lookahead is the whole difference. Without it "flagging group, anyone
 * want to come, got more spots" was tagged WTS and filed in the market - a
 * recruit advertised as a sale. `want to` is followed by a verb, and a verb is
 * not an item.
 *
 * One optional word is allowed between "any" and the verb, because people
 * address a class rather than the room: "any war want? Legionnaire Scale Helm
 * (Legendary)", "any shm need this". Requiring "anyone" missed all of it.
 */
const OFFERING =
  /\bany(?:one|body|1)?\b(?:\s+\w+)?\s+(?:wants?|needs?)\b(?!\s+to\b)|\bwho\s+(?:wants?|needs?)\b(?!\s+to\b)/

/**
 * What somebody is trying to do.
 *
 * Conservative on purpose: a line that states nothing gets `null` rather than
 * an assumption, because "Shop Smart, Shop Baalmart!" is an advert and guessing
 * `sell` for it would put a catchphrase in a price list. A wrong tag is worse
 * than no tag, because a tag reads as something the speaker said.
 */
export function intentOf(text: string): Offer['intent'] {
  const t = text.toLowerCase()

  // The shorthand is unambiguous wherever it appears: nobody types WTS while
  // trying to buy.
  if (/\bwts\b/.test(t)) return 'sell'
  if (/\bwtb\b/.test(t)) return 'buy'
  if (/\bwtt\b/.test(t)) return 'trade'

  if (GIVING_SAID.test(t)) return 'give'
  // A bare "free" follows the same question rule as the rest: stated, it is an
  // offer; asked, it is somebody hoping to receive. "and the helberd if thats
  // free too?" was being listed as a giveaway of an item the speaker does not
  // have.
  if (GIVING_BARE.test(t)) return t.includes('?') ? 'buy' : 'give'
  if (WANTING.test(t)) return 'buy'
  if (OFFERING.test(t)) return 'sell'

  // Past this point the wording is about somebody's position rather than the
  // speaker's, and a question inverts it - you are asking about the other
  // side of the trade, not announcing your own:
  //
  //   "selling my bracer 40k"                 -> they are selling
  //   "any orb of masterys out there for sale?" -> they want to BUY one
  //   "anyone buying gems?"                    -> they have gems to SELL
  //
  // Read the wrong way round these are exactly backwards, which is worse than
  // no tag at all - the first version of this rule filed that orb under WTS.
  const asking = t.includes('?')
  if (/\bselling\b|\bfor sale\b/.test(t)) return asking ? 'buy' : 'sell'
  if (/\bbuying\b/.test(t)) return asking ? 'sell' : 'buy'
  if (/\btrading\b/.test(t)) return 'trade'
  return null
}

/**
 * Item names out of free prose.
 *
 * Only the tiered form is taken - `Hammer of Holy Vengeance (Legendary)` -
 * because it is the one shape that is unambiguous. Everything else people
 * type is prose with item names embedded in it, sometimes without even a
 * space in front, and a looser rule produced more rubbish than items.
 *
 * So this finds SOME of what is on offer, never all of it, and the raw line is
 * always kept so you can read what it actually said.
 */
export function itemsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/([A-Z][\w'`,-]*(?: [\w'`,-]+){0,5}) \((Legendary|Enchanted|Glamour)\)/g)) {
    // The trade markers are capitalised too, so they get swallowed by a rule
    // looking for a capitalised run - `WTS Hammer of Holy Vengeance` came back
    // as the item's name. Stripped here rather than excluded in the pattern,
    // which would have to know where in the run they can appear.
    const name = m[1].replace(/^(?:WT[SBTA]|LF|PST|ISO|SELLING|BUYING|TRADING)\s+/i, '').trim()
    if (name) out.push(`${name} (${m[2]})`)
  }
  return [...new Set(out)]
}

/* ---------------------------------------------------------------------------
   People looking for people
--------------------------------------------------------------------------- */

/**
 * How long a shout is worth showing.
 *
 * Both lists are kept far longer than this on disk - the cap is 400 rows - but
 * showing all of it turns a feed into an archive. An item somebody advertised
 * two days ago has been sold or forgotten, and answering it wastes everybody's
 * time.
 *
 * Grouping runs out sooner because a group does not survive being formed.
 * Nobody is still filling the spots they shouted about ninety minutes ago; by
 * then the run either went or fell apart.
 */
export const MARKET_WINDOW_MS = 6 * 60 * 60 * 1000
export const GROUPING_WINDOW_MS = 2 * 60 * 60 * 1000

/** Rows still worth showing, newest first. */
export function recent<T extends { at: number }>(rows: T[], now: number, windowMs: number): T[] {
  return rows.filter((r) => now - r.at < windowMs).sort((a, b) => b.at - a.at)
}

/**
 * A shout about forming or joining a group, rather than about an item.
 *
 * These used to be thrown away or, worse, filed as sales: "flagging group,
 * anyone want to come, got more spots" was tagged WTS because it contains
 * "anyone want". They are the same channels and the same shouts, they are just
 * about people rather than goods - so they get their own list.
 */
export interface GroupCall {
  caller: string
  channel: string
  text: string
  at: number
  /**
   * `forming` has a group and wants people; `seeking` wants in. Null when the
   * line is plainly about grouping but does not say which way round.
   */
  kind: 'forming' | 'seeking' | null
}

/**
 * They have a group and need bodies.
 *
 * The last clause is the flag-run shape, which is most of the grouping traffic
 * on this server:
 *
 *   "doing talendor if anyone needs flag"
 *   "on to velious flags if anyone wants in"
 *   "kill gore for flag if anyone needs"
 *
 * It keys on the invitation alone. The first version also demanded a content
 * verb from a list - doing, running, heading to - which was me guessing at how
 * people would phrase it, and "kill gore for flag" walked straight past it. The
 * verb is the part that varies; "if anyone needs" is the part that means
 * "come with me".
 *
 * A giveaway can end the same way, so groupCallOf checks for one first rather
 * than this pattern trying to exclude it.
 */
const FORMING =
  /\blfm\b|looking for more|\blf\s?\d+\s?(?:more|m)\b|need(?:s|ed)? \d+ more|\d+ (?:more )?spots?\b|forming (?:a |up )?(?:group|raid|party)|flagging (?:group|run)|\bany(?:one|body|1)?\b(?:\s+\w+)?\s+wants?\s+to\s+\w|\bwho\s+wants?\s+to\s+\w|any\s?(?:one|body|1)?\s+(?:up for|free for)\b|\bif any\s?(?:one|body|1)?\s+(?:needs?|wants?)\b/

/** They want to join something already happening. */
const SEEKING =
  /\blfg\b|looking for (?:a )?group|any\s?(?:one|body|1)?\s+doing\b|any\s?(?:one|body|1)?\s+running\b|can i get (?:an )?in(?:vite|v)\b|need (?:a )?group\b/

/**
 * Is this shout about grouping at all?
 *
 * Deliberately narrow. A line that is merely *about* a zone - "DN is rough" -
 * is not a group call, and filling this tab with chatter would make it as
 * useless as the market tab was when it filed questions as listings.
 */
export function groupCallOf(text: string): GroupCall['kind'] | false {
  const t = text.toLowerCase()
  // Trade shorthand wins outright: "WTS port to DN" is a service for sale, not
  // somebody forming a group.
  if (/\bwt[sbt]\b/.test(t)) return false

  // A giveaway can end with an invitation too - "free to a good home if anyone
  // needs them" - and it is still a giveaway. Asked here rather than worked
  // around inside FORMING, so the two rules do not have to know about each
  // other's edge cases.
  if (intentOf(text) === 'give') return false

  if (SEEKING.test(t)) return 'seeking'
  if (FORMING.test(t)) return 'forming'
  return false
}

export interface ServerData {
  blessings: Blessing[]
  census: Record<string, CensusEntry>
  /** Group and raid calls heard on the broadcast channels. */
  groups: GroupCall[]
  offers: Offer[]
  /** Traders and items in the bazaar, when the server last said. */
  bazaar: { traders: number; items: number; at: number } | null
  /**
   * When world buffs were last applied to YOU - the "You feel a surge of
   * power" line. Separate from the blessing table on purpose: it is the one
   * fact you can be certain of, since the game said it about you directly,
   * while the table is assembled from broadcasts that may predate the app.
   */
  appliedAt: number | null
}
