import { CloudOff, FolderLock, House, MapPinned, RefreshCw, Siren, Users } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { QuickExit } from '../components/QuickExit'
import { useSession } from '../contexts/SessionContext'
import { useQueueStatus } from '../hooks/useOnline'
import { cx } from '../utils/format'

const TABS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/sos', label: 'SOS', icon: Siren, primary: true },
  { to: '/location', label: 'Location', icon: MapPinned },
  { to: '/vault', label: 'Vault', icon: FolderLock },
]

/** Neutral on purpose: it says something is waiting, never what. */
export function SyncChip() {
  const { waiting } = useQueueStatus()
  const { offline } = useSession()
  if (!waiting && !offline) return null
  return (
    <NavLink
      to="/settings/sync"
      className="inline-flex min-h-9 items-center gap-2 rounded-full bg-amber-wash px-3 text-sm font-semibold text-amber-ink"
      aria-label={waiting ? 'Waiting to sync. Open sync status.' : 'Offline. Open sync status.'}
    >
      {waiting ? <RefreshCw size={15} aria-hidden="true" /> : <CloudOff size={15} aria-hidden="true" />}
      {waiting ? 'Waiting to sync' : 'Offline'}
    </NavLink>
  )
}

function Tab({ to, label, icon: Icon, end, primary, rail }: (typeof TABS)[number] & { rail?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cx(
          'group flex items-center font-semibold transition-colors duration-150',
          rail ? 'min-h-12 gap-3 rounded-full px-4 text-[15px]' : 'min-h-14 flex-1 flex-col justify-center gap-1 text-[11px]',
          rail && (isActive ? 'bg-mint text-green-deep' : 'text-soft hover:bg-fill hover:text-ink'),
          !rail && (isActive ? 'text-ink' : 'text-soft'),
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cx(
              'grid place-items-center rounded-full transition-colors duration-150',
              !rail && primary && 'size-12 -translate-y-3 bg-pink text-pink-deep shadow-raised ring-4 ring-card',
              !rail && !primary && 'h-8 w-14',
              !rail && !primary && isActive && 'bg-mint text-green-deep',
            )}
          >
            <Icon size={rail ? 20 : 22} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
          </span>
          <span className={cx(!rail && primary && '-mt-3')}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

/**
 * The frame around every screen behind the calculator: quick exit in the corner, navigation
 * along the bottom on a phone and down the side on wider screens.
 */
export function AppShell() {
  const { lock } = useSession()
  const { pathname } = useLocation()
  // The map screens use the full height. Everything else scrolls as a page.
  const wide = pathname.startsWith('/location')

  return (
    <div className="min-h-full md:pl-56">
      <QuickExit onExit={lock} />

      <nav aria-label="Main" className="fixed inset-y-0 left-0 z-[1000] hidden w-56 flex-col gap-1 border-r border-line bg-card px-3 py-6 md:flex">
        <p className="mb-4 px-4 text-lg font-bold">Silent Seal</p>
        {TABS.map((tab) => (
          <Tab key={tab.to} {...tab} rail />
        ))}
      </nav>

      <main className={cx('mx-auto px-4 pb-32 pt-[max(1rem,env(safe-area-inset-top))] md:px-8 md:pb-12 md:pt-8', wide ? 'max-w-5xl' : 'max-w-2xl')}>
        <Outlet />
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-[1000] flex items-end border-t border-line bg-card px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 md:hidden"
      >
        {TABS.map((tab) => (
          <Tab key={tab.to} {...tab} />
        ))}
      </nav>
    </div>
  )
}
