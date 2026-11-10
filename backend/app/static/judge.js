// Judge dashboard. Everything is built with DOM nodes and textContent: alert text comes from users.
(() => {
  const POLL_MS = 2000
  const $ = (id) => document.getElementById(id)
  const el = (tag, cls, text) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined && text !== null) node.textContent = text
    return node
  }

  let token = ''
  let timer
  let seeded = null
  let bundle = null
  const openDeliveries = new Set()

  async function call(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'X-Demo-Token': token, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      cache: 'no-store',
    })
    if (response.status === 401) throw new Error('unauthorized')
    if (!response.ok) throw new Error(String(response.status))
    return response.status === 204 ? null : response.json()
  }

  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }) : '')
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  function duration(seconds) {
    if (seconds === null || seconds === undefined) return 'unknown'
    if (seconds < 60) return `${Math.max(0, seconds)} s`
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`
    return `${(seconds / 3600).toFixed(1)} h`
  }

  // ---------- SOS feed ----------

  const TRIGGERS = {
    manual: ['Manual SOS', 'chip-danger'],
    duress: ['Duress PIN', 'chip-danger'],
    geofence: ['Zone alert', 'chip-amber'],
    share: ['Location share', 'chip-live'],
  }
  const STATUSES = {
    queued: 'Sending',
    dispatched: 'Contacts notified',
    undelivered: 'Not delivered',
    no_contacts: 'No contacts to notify',
  }
  const SHARES = {
    active: ['Live sharing active', 'chip-live'],
    safe: ['Ended: marked safe', 'chip-neutral'],
    expired: ['Link expired', 'chip-neutral'],
    none: ['No live share', 'chip-neutral'],
  }

  function fact(label, value) {
    const wrap = el('div')
    wrap.append(el('dt', '', label))
    const dd = el('dd')
    if (value instanceof Node) dd.append(value)
    else dd.textContent = value
    wrap.append(dd)
    return wrap
  }

  function deliveryBadge(d) {
    if (d.adapter === 'mock') return el('span', 'chip chip-sim', 'Simulated: recorded, not sent')
    if (d.adapter === 'sample') return el('span', 'chip chip-sim', 'Sample data: nothing sent')
    if (d.status === 'stub') return el('span', 'chip chip-amber', 'Stub: not sent')
    if (d.status === 'failed') return el('span', 'chip chip-danger', 'Failed: not sent')
    return el('span', 'chip chip-live', 'Sent')
  }

  function alertCard(a) {
    const share = a.share || { status: 'none' }
    const card = el('article', `card alert${share.status === 'safe' ? ' is-safe' : share.status === 'active' ? '' : ' is-ended'}`)

    const head = el('div', 'alert-head')
    head.append(el('h3', '', a.sender))
    const [triggerLabel, triggerClass] = TRIGGERS[a.trigger] || [a.trigger, 'chip-neutral']
    head.append(el('span', `chip ${triggerClass}`, triggerLabel))
    if (a.simulated) head.append(el('span', 'chip chip-sim', 'Simulated'))
    card.append(head, el('p', 'alert-time', when(a.created_at)))

    const facts = el('dl', 'facts')
    facts.append(fact('Emergency status', STATUSES[a.status] || a.status))
    const loc = a.payload.location
    if (loc) {
      const link = el('a', '', `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`)
      link.href = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}`
      link.target = '_blank'
      link.rel = 'noreferrer'
      facts.append(fact('Location', link))
    } else {
      facts.append(fact('Location', 'Not captured yet'))
    }
    facts.append(fact('Battery', a.payload.battery != null ? `${Math.round(a.payload.battery * 100)}%` : 'Unknown'))

    const [shareLabel, shareClass] = SHARES[share.status] || SHARES.none
    const shareValue = el('span')
    shareValue.append(el('span', `chip ${shareClass}`, shareLabel))
    facts.append(fact('Live sharing', shareValue))
    if (share.status !== 'none') {
      facts.append(fact('Trail points', String(share.points)))
      const open = el('a', '', share.status === 'active' ? 'Open contact map' : 'Open ended link')
      open.href = new URL(share.url).pathname
      open.target = '_blank'
      open.rel = 'noreferrer'
      facts.append(fact('Contact view', open))
    }
    card.append(facts)

    const details = el('details', 'deliveries')
    details.open = openDeliveries.has(a.id)
    details.addEventListener('toggle', () => (details.open ? openDeliveries.add(a.id) : openDeliveries.delete(a.id)))
    const count = a.deliveries.length
    details.append(el('summary', '', count ? `Notifications (${count})` : 'Notifications: nobody was notified'))
    for (const d of a.deliveries) {
      const row = el('div', 'delivery')
      const rowHead = el('div', 'delivery-head')
      rowHead.append(el('strong', '', d.contact_name), el('span', 'hint', `${d.channel.toUpperCase()} ${d.destination} · ${d.kind}`), deliveryBadge(d))
      row.append(rowHead, el('pre', '', d.body))
      details.append(row)
    }
    card.append(details)
    return card
  }

  function renderFeed(alerts) {
    const feed = $('feed')
    if (!alerts.length) {
      feed.replaceChildren(el('div', 'card empty', 'No SOS events yet. Trigger one from the app, or use “Simulate incoming SOS”.'))
      return
    }
    feed.replaceChildren(...alerts.map(alertCard))
  }

  // ---------- Offline queue and audit ----------

  function renderOffline(offline) {
    $('offline-applied').textContent = offline.applied
    $('offline-dupes').textContent = offline.duplicates_suppressed
    const table = $('offline-table')
    table.hidden = !offline.events.length
    table.tBodies[0].replaceChildren(
      ...offline.events.map((e) => {
        const tr = el('tr')
        tr.append(el('td', '', e.id), el('td', '', e.type), el('td', '', duration(e.delay_seconds)), el('td', '', String(e.duplicates)))
        return tr
      }),
    )
  }

  const AUDIT = {
    account_created: 'Account created',
    unlock: 'Unlocked',
    unlock_failed: 'Unlock refused',
    lockout: 'Locked for 60 seconds',
    logout: 'Session ended',
    sos_created: 'SOS created',
    share_started: 'Live share started',
    share_ended: 'Live share ended',
    evidence_added: 'Evidence added',
    offline_sync: 'Offline queue synced',
    side_erased: 'Data erased',
  }

  function renderAudit(events) {
    $('audit').replaceChildren(
      ...events.map((e) => {
        const li = el('li')
        li.append(el('span', '', `${AUDIT[e.kind] || e.kind}${e.account ? ` · ${e.account}` : ''}`))
        const time = el('time', '', clock(e.at))
        time.dateTime = e.at
        li.append(time)
        return li
      }),
    )
  }

  async function refresh() {
    try {
      const state = await call('/api/demo/state')
      $('feed-state').textContent = ''
      $('adapter-note').textContent =
        state.notifications.adapter === 'mock'
          ? 'SMS and email delivery: the mock adapter records each message here and nothing leaves this server.'
          : `SMS and email delivery: the "${state.notifications.adapter}" adapter is a stub that checks its settings and sends nothing.`
      renderFeed(state.alerts)
      renderOffline(state.offline)
      renderAudit(state.audit)
    } catch (error) {
      if (error.message === 'unauthorized') return lock('That token is not correct. Check DEMO_DASHBOARD_TOKEN in .env.')
      $('feed-state').textContent = 'Could not reach the server. Retrying…'
    }
  }

  // ---------- Gate ----------

  function lock(message) {
    clearInterval(timer)
    try {
      sessionStorage.removeItem('judge-token')
    } catch {
      /* storage blocked */
    }
    $('board').hidden = true
    $('gate').hidden = false
    $('gate-state').textContent = message
    $('gate-state').className = 'hint error'
  }

  async function open(value) {
    token = value
    try {
      await call('/api/demo/state')
    } catch (error) {
      return lock(error.message === 'unauthorized' ? 'That token is not correct. Check DEMO_DASHBOARD_TOKEN in .env.' : 'Could not reach the server.')
    }
    try {
      sessionStorage.setItem('judge-token', value)
    } catch {
      /* storage blocked */
    }
    $('gate').hidden = true
    $('board').hidden = false
    refresh()
    clearInterval(timer)
    timer = setInterval(refresh, POLL_MS)
  }

  $('gate').addEventListener('submit', (event) => {
    event.preventDefault()
    open($('token').value.trim())
  })

  // ---------- Simulate ----------

  $('simulate').addEventListener('click', async () => {
    $('simulate').disabled = true
    try {
      await call('/api/demo/simulate-sos', { method: 'POST' })
      await refresh()
    } catch {
      $('feed-state').textContent = 'Could not create the simulated SOS.'
    }
    $('simulate').disabled = false
  })

  // ---------- Authentication demonstration ----------

  $('seed').addEventListener('click', async () => {
    $('seed').disabled = true
    try {
      seeded = await call('/api/demo/seed', { method: 'POST' })
      const facts = $('seeded')
      facts.replaceChildren(
        fact('Recovery code (account id)', seeded.user_id),
        fact('Real PIN', seeded.real_pin),
        fact('Duress PIN', seeded.duress_pin),
      )
      facts.hidden = false
      $('compare').disabled = false
      $('auth-result').replaceChildren()
    } catch {
      $('auth-result').replaceChildren(el('p', 'verdict bad', 'Could not create the demo account.'))
    }
    $('seed').disabled = false
  })

  function claims(jwt) {
    try {
      const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(atob(payload))
    } catch {
      return {}
    }
  }

  async function unlockWith(pin) {
    const started = performance.now()
    const response = await fetch('/api/auth/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: seeded.user_id, pin }),
    })
    const ms = Math.round(performance.now() - started)
    const body = await response.json()
    const tokenClaims = body.token ? claims(body.token) : {}
    return {
      'HTTP status': String(response.status),
      'Response fields': Object.keys(body).sort().join(', '),
      'Session length': body.expires_in ? `${body.expires_in} s` : 'none',
      'Token length': body.token ? `${body.token.length} characters` : 'none',
      'Token claims': Object.keys(tokenClaims).sort().join(', '),
      'Mentions "duress"': /duress/i.test(JSON.stringify([body, tokenClaims])) ? 'yes' : 'no',
      'Response time': `${ms} ms`,
    }
  }

  $('compare').addEventListener('click', async () => {
    if (!seeded) return
    $('compare').disabled = true
    const out = $('auth-result')
    out.replaceChildren(el('p', 'hint', 'Unlocking…'))
    try {
      const real = await unlockWith(seeded.real_pin)
      const duress = await unlockWith(seeded.duress_pin)
      const table = el('table', 'compare')
      const headRow = el('tr')
      headRow.append(el('th', '', ''), el('th', '', 'Real PIN'), el('th', '', 'Duress PIN'))
      table.createTHead().append(headRow)
      const body = table.createTBody()
      let same = true
      for (const key of Object.keys(real)) {
        const tr = el('tr')
        tr.append(el('th', '', key), el('td', '', real[key]), el('td', '', duress[key]))
        body.append(tr)
        if (key !== 'Response time' && real[key] !== duress[key]) same = false
      }
      const verdict = el(
        'p',
        `verdict ${same ? 'ok' : 'bad'}`,
        same
          ? 'Nothing the phone receives tells the two apart. The duress unlock raised a silent SOS: it is in the feed, and nowhere on the phone.'
          : 'The two responses differ. That would let someone inspecting the phone tell which PIN was used.',
      )
      verdict.append(el('small', '', 'Response times vary run to run. Both PIN hashes are checked on every attempt, so timing does not depend on which one matched.'))
      out.replaceChildren(table, verdict)
      refresh()
    } catch {
      out.replaceChildren(el('p', 'verdict bad', 'Could not run the comparison.'))
    }
    $('compare').disabled = false
  })

  // ---------- Evidence verification ----------

  $('bundle').addEventListener('change', async () => {
    const file = $('bundle').files[0]
    bundle = null
    $('verify-result').replaceChildren()
    if (file) {
      try {
        bundle = JSON.parse(await file.text())
      } catch {
        $('verify-result').replaceChildren(el('p', 'verdict bad', 'That file is not JSON, so it is not an exported bundle.'))
      }
    }
    $('verify').disabled = !bundle
    $('tamper').disabled = !(bundle && Array.isArray(bundle.entries) && bundle.entries.length)
  })

  async function verify(candidate, label) {
    const out = $('verify-result')
    try {
      const result = await call('/api/demo/verify', { method: 'POST', body: JSON.stringify({ bundle: candidate }) })
      const verdict = el('div', `verdict ${result.valid ? 'ok' : 'bad'}`)
      verdict.append(
        el('div', '', result.valid ? `${label}: chain intact, ${result.count} ${result.count === 1 ? 'entry' : 'entries'}.` : `${label}: ${result.problems.length} problem${result.problems.length === 1 ? '' : 's'} found.`),
      )
      if (!result.valid) {
        const list = el('ul')
        for (const problem of result.problems) list.append(el('li', '', `${problem.kind.replace('_', ' ')}: ${problem.detail}`))
        verdict.append(list)
      }
      verdict.append(el('small', '', result.scope))
      return verdict
    } catch {
      return el('p', 'verdict bad', 'Could not verify. The file may be too large or the server unreachable.')
    }
  }

  $('verify').addEventListener('click', async () => {
    $('verify-result').replaceChildren(await verify(bundle, 'As exported'))
  })

  $('tamper').addEventListener('click', async () => {
    // Change one character of the first entry's ciphertext, in a copy. The file on disk is untouched.
    const copy = JSON.parse(JSON.stringify(bundle))
    const text = copy.entries[0].ciphertext
    copy.entries[0].ciphertext = (text[0] === 'A' ? 'B' : 'A') + text.slice(1)
    $('verify-result').replaceChildren(await verify(bundle, 'As exported'), await verify(copy, 'After altering one character of entry 1'))
  })

  // Reopen after a refresh within this tab.
  try {
    const saved = sessionStorage.getItem('judge-token')
    if (saved) open(saved)
  } catch {
    /* storage blocked */
  }
})()
