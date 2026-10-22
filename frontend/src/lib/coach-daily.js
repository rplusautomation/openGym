// R+ fork: today's coach check, a row in the Supabase table coach_daily written each morning by
// coach_daily_check() (pg_cron): strap recovery and sleep, weight trend, snacks, and the deload
// rule. Read through og_coach_daily(); like the tips it stays out of the synced state, and a failed
// fetch just means no card. Fetched once per app load.
import { useEffect, useState } from 'react'
import { SB_BACKEND, coachDaily } from './supabase-backend.js'

// What the card shows for a row: a headline by status, the flagged lines, and one line of the
// numbers behind them. Null when there is nothing to show.
export function dailyView(row) {
  if (!row || typeof row !== 'object' || !row.status) return null
  const flags = Array.isArray(row.flags) ? row.flags.filter(f => f && typeof f.text === 'string') : []
  const m = row.metrics || {}
  const facts = [
    m.hrv3 != null && `HRV ${Math.round(m.hrv3)}${m.base_hrv != null ? ` (基线 ${Math.round(m.base_hrv)})` : ''}`,
    m.rhr3 != null && `静息心率 ${Math.round(m.rhr3)}`,
    m.sleep3_h != null && `睡眠 ${m.sleep3_h} h`,
    m.weight7 != null && `体重 7 天 ${m.weight7} kg`,
  ].filter(Boolean)
  const head = row.status === 'act' ? '需要调整' : row.status === 'warn' ? '注意' : '今天一切正常'
  return { status: row.status, day: row.day, head, lines: flags.map(f => ({ level: f.level, text: f.text })), facts: facts.join(' · ') }
}

let pending = null
let cache

function load() {
  if (!SB_BACKEND) return Promise.resolve(null)
  if (!pending) pending = coachDaily().then(r => (cache = r || null)).catch(() => (cache = null))
  return pending
}

export function useCoachDaily() {
  const [row, setRow] = useState(cache)
  useEffect(() => {
    if (cache !== undefined) return
    let live = true
    load().then(r => { if (live) setRow(r) })
    return () => { live = false }
  }, [])
  return dailyView(row)
}
