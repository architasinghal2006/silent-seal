import { Helplines } from '../components/Helplines'
import { QuickExit } from '../components/QuickExit'

// Modules land in later phases; the tiles show what's coming.
const MODULES = [
  { title: 'SOS', desc: 'Silently alert your trusted contacts with your location.' },
  { title: 'Trusted contacts', desc: 'People who receive your alerts.' },
  { title: 'Live location', desc: 'Share a private, expiring map link.' },
  { title: 'Evidence vault', desc: 'Encrypted notes, photos and audio.' },
  { title: 'Safe & danger zones', desc: 'Automatic alerts by location.' },
]

export function Home({ onExit }: { onExit: () => void }) {
  return (
    <main className="screen">
      <QuickExit onExit={onExit} />
      <h1>Silent Seal</h1>
      <p className="muted">Everything here is private to you. Press Exit or Esc any time to return to the calculator.</p>

      <div className="tiles">
        {MODULES.map((m) => (
          <button key={m.title} type="button" className="tile" disabled>
            <strong>{m.title}</strong>
            <span>{m.desc}</span>
            <em>Coming soon</em>
          </button>
        ))}
      </div>

      <Helplines />
    </main>
  )
}
