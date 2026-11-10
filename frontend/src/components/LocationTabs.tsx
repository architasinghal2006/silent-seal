import { useLocation, useNavigate } from 'react-router-dom'
import { SegmentedControl } from './ui/SegmentedControl'

/** Switches between the two map screens: where you are, and the places you watch. */
export function LocationTabs() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <SegmentedControl
      label="Location view"
      tone="mint"
      value={pathname.endsWith('/zones') ? 'zones' : 'live'}
      onChange={(value) => navigate(value === 'zones' ? '/location/zones' : '/location')}
      options={[
        { value: 'live', label: 'Live location' },
        { value: 'zones', label: 'Zones' },
      ]}
    />
  )
}
