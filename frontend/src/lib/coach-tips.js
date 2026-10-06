// R+ fork: one trainer tip per exercise, written each week by the coach briefing routine into the
// Supabase table coach_tips and read through og_coach_tips(). Kept apart from the synced state on
// purpose: the tips are not the user's data, never go through the merge, and a failed fetch just
// means no tip line. Fetched once per app load; every ExerciseBlock reads the same promise.
import { useEffect, useState } from 'react'
import { SB_BACKEND, coachTips } from './supabase-backend.js'

let pending = null
let cache = null

function loadTips() {
  if (!SB_BACKEND) return Promise.resolve({})
  if (!pending) pending = coachTips().then(t => (cache = t && typeof t === 'object' ? t : {})).catch(() => (cache = {}))
  return pending
}

export function useCoachTip(exId) {
  const [tips, setTips] = useState(cache)
  useEffect(() => {
    if (cache) return
    let live = true
    loadTips().then(t => { if (live) setTips(t) })
    return () => { live = false }
  }, [])
  const tip = tips && exId ? tips[exId] : null
  return typeof tip === 'string' && tip.trim() ? tip.trim() : null
}
