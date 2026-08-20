import { Starfield } from './Ambient'
import {
  IconAlerts,
  IconCombat,
  IconLeveling,
  IconLoot,
  IconMaps,
  IconMobs,
  IconOverview,
  IconPrefs,
  IconProgression,
  IconRaid,
  IconServer,
  IconTimers
} from './Icons'

export type PageId =
  | 'overview'
  | 'combat'
  | 'progression'
  | 'leaderboards'
  | 'alerts'
  | 'leveling'
  | 'loot'
  | 'zones'
  | 'mobs'
  | 'timers'
  | 'server'
  | 'preferences'

type Item = {
  id: PageId
  label: string
  icon: (p: { className?: string }) => JSX.Element
}

/**
 * Grouped by *when you look at it*, not by the order the pages were built.
 *
 * Eleven flat entries had no shape to them: the live meter sat two rows above a
 * lifetime ledger, and Server - which is the only page about the world rather
 * than about you - was last because it was written last. Four short groups is
 * enough structure to make the list scannable without turning the nav into a
 * menu tree.
 */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    // Open while you play.
    title: 'Live',
    items: [
      { id: 'overview', label: 'Overview', icon: IconOverview },
      { id: 'combat', label: 'Combat', icon: IconCombat },
      { id: 'server', label: 'Server', icon: IconServer }
    ]
  },
  {
    // How the character is coming along, soonest-changing first.
    title: 'Progress',
    items: [
      { id: 'leveling', label: 'Leveling', icon: IconLeveling },
      { id: 'progression', label: 'Progression', icon: IconProgression },
      { id: 'leaderboards', label: 'Leaderboards', icon: IconRaid }
    ]
  },
  {
    // Lifetime totals, read after the fact: where, what, and what it dropped.
    title: 'Ledgers',
    items: [
      { id: 'zones', label: 'Zones', icon: IconMaps },
      { id: 'mobs', label: 'Mobs', icon: IconMobs },
      { id: 'loot', label: 'Loot', icon: IconLoot }
    ]
  },
  {
    // Things you set up once and leave running.
    title: 'Tools',
    items: [
      { id: 'alerts', label: 'Alerts', icon: IconAlerts },
      { id: 'timers', label: 'Timers', icon: IconTimers }
    ]
  }
]

const PREFERENCES: Item = { id: 'preferences', label: 'Preferences', icon: IconPrefs }

/**
 * Every navigable page. App validates the remembered last page against this, so
 * it is derived from the nav rather than typed out twice - a page that is
 * renamed or dropped from the sidebar can't linger here and reopen on launch.
 */
export const PAGE_IDS: PageId[] = [...GROUPS.flatMap((g) => g.items.map((i) => i.id)), PREFERENCES.id]

export function Sidebar({
  page,
  onNavigate,
  version
}: {
  page: PageId
  onNavigate: (id: PageId) => void
  version: string
}): JSX.Element {
  const render = (it: Item): JSX.Element => {
    const Icon = it.icon
    return (
      <button
        key={it.id}
        className="navitem"
        type="button"
        aria-current={page === it.id ? 'page' : undefined}
        onClick={() => onNavigate(it.id)}
      >
        <Icon className="ic" />
        <span className="lbl">{it.label}</span>
      </button>
    )
  }

  return (
    <aside className="sidebar">
      <Starfield count={40} />

      <nav aria-label="Sections">
        {GROUPS.map((g) => (
          <div className="navgroup" key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map(render)}
          </div>
        ))}
        <div className="spacer" />
        <hr className="rule" />
        {render(PREFERENCES)}
      </nav>

      <div className="footer">
        <span>v{version}</span>
        <span className="spacer" />
        <span title="Nexus Reader never writes to your game folder">read-only</span>
      </div>
    </aside>
  )
}
