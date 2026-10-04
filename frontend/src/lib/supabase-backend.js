// R+ fork: openGym without the Node API. A single-user instance only needs the handful of routes
// below, and Postgres functions on Supabase answer them with the same contract as api/server.js
// (see supabase/opengym.sql): GET /api/data -> { state, rev }, PUT /api/data with baseRev ->
// 409 { error, rev, state } on a stale write. Everything the store does around sync (merging,
// retries, offline queue) therefore runs unchanged. Enabled only when both env vars are set at
// build time; without them the app talks to its own server exactly as upstream does.
const ENV = import.meta.env || {}
const SB_URL = ENV.VITE_SB_URL
const SB_KEY = ENV.VITE_SB_KEY
export const SB_BACKEND = !!(SB_URL && SB_KEY)

const USER = { id: 'ranger', name: ENV.VITE_SB_USER || 'Ranger', admin: false }

const fail = (status, error, extra) =>
  Object.assign(new Error(error), { status, data: Object.assign({ error }, extra || {}) })

async function rpc(fn, args) {
  const r = await fetch(SB_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {})
  })
  let body = null
  try { body = await r.json() } catch { /* not JSON */ }
  if (!r.ok) throw fail(r.status, (body && body.message) || 'HTTP ' + r.status, body)
  return body
}

function body(init) {
  try { return JSON.parse((init && init.body) || '{}') || {} } catch { return {} }
}
// Rest alerts are booked as "cancel the old one, schedule the new one" in the same instant, two
// requests that can overtake each other on the way. A strictly increasing number, taken when the
// app makes the call, lets the database drop whichever arrives out of date (og_push_seq).
let lastSeq = 0
const nextSeq = () => (lastSeq = Math.max(lastSeq + 1, Date.now() * 1000))

function checked(res) {
  const { status, ...rest } = res || {}
  if (status && status !== 200) throw fail(status, rest.error || 'failed', rest)
  return rest
}

export async function sbApi(path, init) {
  const method = ((init && init.method) || 'GET').toUpperCase()
  const route = method + ' ' + path.split('?')[0]
  switch (route) {
    case 'GET /api/config': return { invite_only: false, allow_guest: true }
    case 'GET /api/me': return { user: USER }
    case 'GET /api/data': return rpc('og_get')
    case 'GET /api/data/rev': return rpc('og_rev')
    case 'PUT /api/data': {
      let body = {}
      try { body = JSON.parse((init && init.body) || '{}') } catch { /* empty */ }
      const res = await rpc('og_put', { p_state: body.state ?? null, p_base_rev: body.baseRev ?? null })
      const { status, ...rest } = res || {}
      if (status !== 200) throw fail(status || 500, rest.error || 'write failed', rest)
      return rest
    }
    case 'POST /api/logout': return { ok: true }
    // Lock-screen alerts: the subscription and the pending alert live in Supabase; the og-push
    // edge function, run by pg_cron while something is due, sends it (supabase/opengym.sql).
    case 'GET /api/push/public-key': return rpc('og_push_key')
    case 'POST /api/push/subscribe': {
      const b = body(init)
      return checked(await rpc('og_push_subscribe', { p_sub: b.subscription || null, p_device: b.deviceId || null }))
    }
    case 'GET /api/push/status':
      return rpc('og_push_status', { p_endpoint: new URLSearchParams(path.split('?')[1] || '').get('endpoint') || '' })
    case 'POST /api/push/unsubscribe': return rpc('og_push_unsubscribe', { p_endpoint: body(init).endpoint || '' })
    case 'POST /api/push/test': return checked(await rpc('og_push_schedule', { p_device: null, p_seconds: 0, p_kind: 'test' }))
    case 'POST /api/push/rest-timer': {
      const b = body(init)
      const n = typeof b.seconds === 'number' || typeof b.seconds === 'string' ? Number(b.seconds) : NaN
      if (!(n >= 1)) throw fail(400, 'seconds required')
      return checked(await rpc('og_push_schedule', { p_device: b.deviceId || null, p_seconds: Math.round(n), p_kind: 'rest', p_seq: nextSeq() }))
    }
    case 'POST /api/push/rest-timer/cancel': return rpc('og_push_cancel', { p_device: body(init).deviceId || null, p_seq: nextSeq() })
    default: throw fail(404, 'not available on this instance')
  }
}
