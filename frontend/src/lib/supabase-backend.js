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
    default: throw fail(404, 'not available on this instance')
  }
}
