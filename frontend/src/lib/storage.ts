// Device-local state lives under a key that looks like ordinary calculator preferences.
const KEY = 'calc.prefs'

interface Prefs {
  precision: number
  k?: string // account id
}

function read(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { precision: 12, ...JSON.parse(raw) }
  } catch {
    /* storage blocked or corrupt: behave as a fresh install */
  }
  return { precision: 12 }
}

function write(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}

export function getAccountId(): string | undefined {
  return read().k
}

export function setAccountId(id: string) {
  write({ ...read(), k: id })
}
