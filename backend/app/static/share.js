// What a trusted contact sees when they open a live-location link.
(() => {
  const POLL_MS = 15000
  const STALE_MS = 2 * 60000
  const TRAIL = '#28b878'
  const HERE = '#f26aa5'
  const $ = (id) => document.getElementById(id)
  let map, trail, dots, marker, circle, timer
  let follow = true
  let latest = null

  function ago(iso) {
    const mins = Math.round((Date.now() - new Date(iso)) / 60000)
    if (mins < 1) return 'just now'
    return mins === 1 ? '1 minute ago' : mins < 120 ? `${mins} minutes ago` : `${Math.round(mins / 60)} hours ago`
  }

  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  function initMap() {
    $('map-wrap').hidden = false
    map = L.map('map', { zoomControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    trail = L.polyline([], { color: TRAIL, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map)
    dots = L.layerGroup().addTo(map)
    circle = L.circle([0, 0], { radius: 0, color: HERE, weight: 1, fillOpacity: 0.12 }).addTo(map)
    marker = L.circleMarker([0, 0], { radius: 10, color: '#fff', weight: 4, fillColor: HERE, fillOpacity: 1 }).addTo(map)
    map.on('dragstart', () => {
      follow = false
      $('recenter').hidden = false
    })
  }

  function showLatest() {
    if (latest) map.setView([latest.lat, latest.lng], Math.max(map.getZoom() || 0, 16))
  }

  function renderActive(data) {
    const who = data.name || 'Someone who trusts you'
    $('title').textContent = `${who} is sharing their location with you`
    $('meta').hidden = false
    $('since-chip').textContent = `Since ${time(data.started_at)}`
    $('until-chip').textContent = `Link ends ${time(data.expires_at)}`
    if (!data.points.length) {
      $('updated').textContent = 'Waiting for their first location.'
      return
    }
    if (!map) initMap()
    latest = data.points[data.points.length - 1]
    const here = [latest.lat, latest.lng]
    trail.setLatLngs(data.points.map((p) => [p.lat, p.lng]))
    dots.clearLayers()
    for (const p of data.points.slice(0, -1)) {
      L.circleMarker([p.lat, p.lng], { radius: 3, color: TRAIL, weight: 0, fillColor: TRAIL, fillOpacity: 1 })
        .bindTooltip(time(p.at))
        .addTo(dots)
    }
    marker.setLatLng(here)
    circle.setLatLng(here).setRadius(latest.accuracy || 0)
    if (follow) showLatest()
    const accuracy = latest.accuracy != null ? `, within ${Math.round(latest.accuracy)} m` : ''
    const count = data.points.length === 1 ? '1 point' : `${data.points.length} points on the trail`
    $('updated').textContent = `Last updated ${ago(latest.at)}${accuracy}. ${count}.`
    const old = Date.now() - new Date(latest.at) > STALE_MS
    $('stale').hidden = !old
    $('status-chip').textContent = old ? 'Not updating' : 'Sharing live'
    $('status-chip').className = `chip ${old ? 'chip-amber' : 'chip-live'}`
    if (old) $('stale').textContent = `No update since ${ago(latest.at)}. Their phone may be off, offline or locked, and they may have moved.`
  }

  function renderEnded(title, text) {
    clearInterval(timer)
    if (map) {
      map.remove()
      map = null
    }
    $('map-wrap').hidden = true
    $('stale').hidden = true
    $('meta').hidden = true
    $('ended').hidden = false
    $('title').textContent = title
    $('updated').textContent = ''
    $('ended-text').textContent = text
  }

  async function load() {
    try {
      const res = await fetch(location.pathname + '/data', { cache: 'no-store' })
      if (res.status === 404) {
        return renderEnded('This link is not valid', 'Check that you opened the whole link from the alert. If you think someone is in danger, call 112.')
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      if (data.status === 'safe') {
        $('advice').textContent = 'If you are still worried, check on them carefully.'
        return renderEnded('They marked themselves safe', 'They ended location sharing, so this link no longer shows where they are.')
      }
      if (data.status === 'expired') {
        return renderEnded('This link has expired', 'They did not mark themselves safe before it ended, and their location is no longer shown. If you think they are in danger, call 112.')
      }
      renderActive(data)
    } catch {
      $('updated').textContent = 'Could not refresh the location. Trying again…'
    }
  }

  $('recenter').addEventListener('click', () => {
    follow = true
    $('recenter').hidden = true
    showLatest()
  })
  load()
  timer = setInterval(load, POLL_MS)
})()
