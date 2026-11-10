import { useMemo } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { SessionProvider, type Session } from '../contexts/SessionContext'
import { ToastProvider } from '../contexts/ToastContext'
import { Contacts } from '../pages/Contacts'
import { Home } from '../pages/Home'
import { LiveLocation } from '../pages/LiveLocation'
import { Settings } from '../pages/Settings'
import { Sos } from '../pages/Sos'
import { SyncStatus } from '../pages/SyncStatus'
import { Vault } from '../pages/Vault'
import { Zones } from '../pages/Zones'
import { AppShell } from './AppShell'

const ROUTES = [
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Home /> },
      { path: 'contacts', element: <Contacts /> },
      { path: 'sos', element: <Sos /> },
      { path: 'location', element: <LiveLocation /> },
      { path: 'location/zones', element: <Zones /> },
      { path: 'vault', element: <Vault /> },
      { path: 'settings', element: <Settings /> },
      { path: 'settings/sync', element: <SyncStatus /> },
    ],
  },
]

/**
 * Everything behind the calculator. Navigation is kept in memory: the address bar and the
 * browser's history never change, so neither can show that a vault or a map was opened, and
 * reloading the page always lands back on the calculator.
 */
export default function SafetyApp({ session, initialPath = '/' }: { session: Session; initialPath?: string }) {
  const router = useMemo(() => createMemoryRouter(ROUTES, { initialEntries: [initialPath] }), [initialPath])
  return (
    <SessionProvider value={session}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </SessionProvider>
  )
}
