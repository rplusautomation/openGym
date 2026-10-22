import { describe, expect, it } from 'vitest'
import { dailyView } from './coach-daily.js'

describe('dailyView', () => {
  it('shows nothing without a row', () => {
    expect(dailyView(null)).toBe(null)
    expect(dailyView({})).toBe(null)
  })

  it('an ok day has a headline and the numbers, no lines', () => {
    const v = dailyView({ day: '2026-10-23', status: 'ok', flags: [], metrics: { hrv3: 34.2, base_hrv: 33.1, rhr3: 54, sleep3_h: 7.4, weight7: 93.1 } })
    expect(v.head).toBe('今天一切正常')
    expect(v.lines).toEqual([])
    expect(v.facts).toBe('HRV 34 (基线 33) · 静息心率 54 · 睡眠 7.4 h · 体重 7 天 93.1 kg')
  })

  it('keeps flagged lines in order and drops malformed ones', () => {
    const v = dailyView({ status: 'act', flags: [{ level: 'warn', text: 'a' }, null, { level: 'act', text: 'b' }, { key: 'x' }], metrics: {} })
    expect(v.head).toBe('需要调整')
    expect(v.lines).toEqual([{ level: 'warn', text: 'a' }, { level: 'act', text: 'b' }])
    expect(v.facts).toBe('')
  })
})
