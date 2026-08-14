/**
 * Line icons, drawn on a 24-grid with `currentColor` so they inherit the nav's
 * active/idle colour. Inline rather than an icon font: no network, no FOUT, and
 * the CSP stays locked to 'self'.
 */
type P = { className?: string }

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export const IconOverview = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <rect x="3" y="3" width="7" height="9" rx="1.2" />
    <rect x="14" y="3" width="7" height="5" rx="1.2" />
    <rect x="14" y="12" width="7" height="9" rx="1.2" />
    <rect x="3" y="16" width="7" height="5" rx="1.2" />
  </svg>
)

export const IconCombat = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M4 20V13" />
    <path d="M10 20V8" />
    <path d="M16 20V11" />
    <path d="M22 20V4" />
  </svg>
)

export const IconAlerts = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" />
    <path d="M10.5 20a2 2 0 0 0 3 0" />
  </svg>
)

export const IconLeveling = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M3 17l5.5-6 4 4L21 6" />
    <path d="M15 6h6v6" />
  </svg>
)

export const IconPrefs = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6h.1A1.6 1.6 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
)

/** A climb: three rungs rising to a gate. */
export const IconProgression = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M4 20h4v-4H4zM10 20h4v-8h-4zM16 20h4v-12h-4z" />
    <path d="M3 4h6M6 2v4" />
  </svg>
)

/**
 * A skull. The previous hooded-head drawing was a dome with a flared base,
 * which at 18px was indistinguishable from IconAlerts' bell - harmless while
 * the two sat nine rows apart, confusing now the nav is grouped and they are
 * near neighbours. Eye sockets are the thing that makes it unmistakable.
 */
export const IconMobs = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M5 11a7 7 0 1 1 14 0v3.5a1.5 1.5 0 0 1-1.5 1.5H16v3H8v-3H6.5A1.5 1.5 0 0 1 5 14.5z" />
    <circle cx="9.2" cy="11" r="1.7" />
    <circle cx="14.8" cy="11" r="1.7" />
    <path d="M12 14.5v1.5" />
  </svg>
)

export const IconLoot = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <rect x="3" y="8" width="18" height="12" rx="2" />
    <path d="M3 12h18" />
    <path d="M12 8v12" />
    <path d="M7 8V6a5 5 0 0 1 10 0v2" />
  </svg>
)

export const IconMaps = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" />
    <path d="M9 4v13M15 6.5v13" />
  </svg>
)

export const IconRaid = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
    <path d="M8 5H5v1.5A3.5 3.5 0 0 0 8.5 10M16 5h3v1.5A3.5 3.5 0 0 1 15.5 10" />
    <path d="M12 13v4M9 20h6" />
  </svg>
)

/** The world, not your character: a globe with a meridian. */
export const IconServer = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
  </svg>
)

export const IconTimers = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9 2h6" />
  </svg>
)

export const IconOverlay = ({ className }: P): JSX.Element => (
  <svg {...base} className={className}>
    <rect x="3" y="4" width="14" height="10" rx="1.6" />
    <path d="M8 20h13V9" />
  </svg>
)

/* Window controls are drawn at 10px on a 10-grid: crisper than scaling a 24. */
const win = {
  viewBox: '0 0 10 10',
  width: 10,
  height: 10,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  'aria-hidden': true
}

export const IconMin = (): JSX.Element => (
  <svg {...win}>
    <path d="M0 5h10" />
  </svg>
)
export const IconMax = ({ maximized }: { maximized: boolean }): JSX.Element =>
  maximized ? (
    <svg {...win}>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
    </svg>
  ) : (
    <svg {...win}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  )
export const IconClose = (): JSX.Element => (
  <svg {...win}>
    <path d="M0 0l10 10M10 0L0 10" />
  </svg>
)
