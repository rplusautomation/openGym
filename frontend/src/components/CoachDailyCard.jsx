// R+ fork: today's coach check on Home (lib/coach-daily.js). Green when nothing is flagged, orange
// for a warning, red when the check asks for a change (deload); each flag is one plain line.
import { useCoachDaily } from '../lib/coach-daily.js'

const COLOR = { ok: 'var(--green)', warn: 'var(--orange)', act: 'var(--red)' }

export default function CoachDailyCard() {
  const v = useCoachDaily()
  if (!v) return null
  const c = COLOR[v.status] || COLOR.warn
  return (
    <div className="card" style={{ borderLeft: `4px solid ${c}`, background: `color-mix(in srgb, ${c} 10%, var(--surface))` }}>
      <div className="row between" style={{ marginBottom: v.lines.length || v.facts ? 6 : 0 }}>
        <div style={{ fontWeight: 600, color: c }}>教练 · {v.head}</div>
        {v.day && <div className="small muted">{v.day.slice(5)}</div>}
      </div>
      {v.lines.map((l, i) => (
        <div key={i} style={{ fontSize: 15, lineHeight: 1.4, marginBottom: 4, fontWeight: l.level === 'act' ? 600 : 400 }}>{l.text}</div>
      ))}
      {v.facts && <div className="small muted" style={{ marginTop: 4 }}>{v.facts}</div>}
    </div>
  )
}
