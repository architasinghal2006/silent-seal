// Shapes exchanged with the backend. Field names match the API exactly.

export interface Location {
  lat: number
  lng: number
  accuracy: number | null
}

export type Channel = 'sms' | 'email'

export interface ContactInput {
  name: string
  relationship: string
  phone: string | null
  email: string | null
  channel: Channel
  is_emergency: boolean
}

export interface Contact extends ContactInput {
  id: string
}

export interface SosHistoryItem {
  id: string
  created_at: string
  trigger: 'manual' | 'duress' | 'geofence' | 'share' | string
  status: 'queued' | 'dispatched' | 'undelivered' | 'no_contacts' | string
  delivered: number
  undelivered: number
  simulated: boolean
}

export interface DeliveryStatus {
  contact_name: string
  channel: string
  /** mock records the message and sends nothing. sms and email are stubs. sample is demo history. */
  adapter: string
  status: 'sent' | 'stub' | 'failed' | 'pending' | string
  kind: string
}

export interface SosStatus {
  id: string
  created_at: string
  trigger: string
  status: string
  location_captured: boolean
  battery: number | null
  deliveries: DeliveryStatus[]
  live_share_active: boolean
}

export interface StreamReply {
  stream: boolean
  stream_token: string | null
}

export interface TrailPoint {
  lat: number
  lng: number
  accuracy: number | null
  at: string
}

export interface Viewer {
  name: string
  relationship: string
}

export interface LiveShareStatus {
  active: boolean
  started_at: string | null
  expires_at: string | null
  share_url: string | null
  points: TrailPoint[]
  viewers: Viewer[]
}

export interface LiveShareStarted extends LiveShareStatus {
  stream_token: string | null
}

export type ZoneKind = 'danger' | 'safe'

export interface ZoneInput {
  name: string
  kind: ZoneKind
  lat: number
  lng: number
  radius: number
  enabled: boolean
  on_enter: boolean
  on_exit: boolean
}

export interface Zone extends ZoneInput {
  id: string
}

/** What the geofence watcher follows. Short names: it sits in device storage in plain sight. */
export interface WatchZone {
  i: string
  a: number // lat
  o: number // lng
  r: number // radius in metres
  k: 'd' | 's' // danger or safe
  e?: boolean // alert on entry
  x?: boolean // alert on exit
}

export interface ZoneList {
  zones: Zone[]
  watch: WatchZone[]
  watch_token: string | null
}

export interface ChainProblem {
  kind: 'modified' | 'missing' | 'broken_link' | 'count_mismatch' | 'head_mismatch' | 'unreadable' | string
  position: number | null
  detail: string
}

export interface VerifyResult {
  valid: boolean
  count: number
  head_hash: string | null
  problems: ChainProblem[]
  scope: string
}

export type QueueEventType = 'sos' | 'unlock' | 'evidence'

export interface SyncEvent {
  id: string
  type: QueueEventType
  timestamp: string
  payload: Record<string, unknown>
}

export interface SyncResult {
  id: string
  status: 'applied' | 'duplicate' | 'rejected'
}

export interface SyncReply extends StreamReply {
  results: SyncResult[]
}

export interface OfflineStatus {
  last_sync_at: string | null
  applied: number
  duplicates: number
}

export interface Me {
  user_id: string
  created_at: string
  demo: boolean
}
