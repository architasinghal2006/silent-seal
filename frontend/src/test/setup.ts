import '@testing-library/jest-dom/vitest'
import { webcrypto } from 'node:crypto'
import { afterEach } from 'vitest'

// Only component tests have a document. Unit tests of the crypto and geofence code run in plain Node.
if (typeof document !== 'undefined') {
  // jsdom has no Web Crypto or IndexedDB of its own. These are the real algorithms, not mocks.
  if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
  await import('fake-indexeddb/auto')

  // The router builds a Request with jsdom's AbortSignal, which Node's Request refuses. Navigation
  // here is in memory and never aborted, so the signal is simply left out.
  const NodeRequest = globalThis.Request
  globalThis.Request = class extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      const { signal: _signal, ...rest } = init ?? {}
      super(input, rest)
    }
  }

  const { cleanup } = await import('@testing-library/react')
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })
}
