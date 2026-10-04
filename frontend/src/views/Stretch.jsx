// R+ fork: Ranger's guided stretch routine, ported from the old training-log app. A fixed
// sequence, each step announced by voice, the last three seconds counted down aloud and a
// short boxing-bell triple at the end of every step. Nothing is logged; it is a timer, not a
// workout. Everything runs off a wall-clock end time, so throttled timers on iOS cannot drift it.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const STEPS = [
  { name: 'Get ready', s: 5, desc: '准备' },
  { name: 'Arm werfen', s: 60, desc: '手臂投掷(做投掷动作)' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Oberkörper', s: 60, desc: '上半身(活动躯干)' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Hacken', s: 60, desc: '脚跟(点地/活动脚踝)' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Waden rechts', s: 60, desc: '右小腿' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Waden links', s: 60, desc: '左小腿' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Schritt rechts', s: 60, desc: '向右迈步' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Schritt links', s: 60, desc: '向左迈步' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Knee rechts', s: 60, desc: '右膝' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Knee links', s: 60, desc: '左膝' },
  { name: 'Hinsetzen', s: 5, desc: '坐下' },
  { name: 'Beide Füße', s: 60, desc: '双脚' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Einzel', s: 60, desc: '单脚/单侧' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Dreh setz rechts', s: 60, desc: '转身坐右侧' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Dreh setz links', s: 60, desc: '转身坐左侧' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Fuß an Fuß', s: 60, desc: '脚对脚' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Liegen', s: 60, desc: '躺下' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Stehen rechts', s: 60, desc: '右侧站立' },
  { name: 'Break', s: 5, desc: '过渡休息' },
  { name: 'Stehen links', s: 60, desc: '左侧站立' }
]
const TOTAL = STEPS.reduce((n, x) => n + x.s, 0)

// --- sound ---------------------------------------------------------------------------------
let ctx = null
function audio() {
  if (ctx && ctx.state === 'closed') ctx = null
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { /* none */ } }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
  return ctx
}
// Spectrum taken from a real boxing-bell recording (2660 / 3965 / 7030 Hz), three quick strikes,
// compressed and limited so it is loud without clipping a phone speaker.
function bell() {
  const c = audio(); if (!c) return
  try {
    const comp = c.createDynamicsCompressor()
    comp.threshold.value = -18; comp.knee.value = 4; comp.ratio.value = 10; comp.attack.value = 0.001; comp.release.value = 0.15
    const makeup = c.createGain(); makeup.gain.value = 2.6
    const lim = c.createDynamicsCompressor()
    lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1
    comp.connect(makeup); makeup.connect(lim); lim.connect(c.destination)
    const partials = [[2660, 1.4, 1.1], [3965, 0.9, 0.9], [7030, 0.55, 0.5]]
    ;[0, 0.35, 0.7].forEach(t0 => {
      const st = c.currentTime + t0
      partials.forEach(([f, g0, dec]) => {
        const o = c.createOscillator(), g = c.createGain()
        o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(comp)
        g.gain.setValueAtTime(0.0001, st)
        g.gain.exponentialRampToValueAtTime(g0, st + 0.004)
        g.gain.exponentialRampToValueAtTime(0.0001, st + dec)
        o.start(st); o.stop(st + dec + 0.05)
      })
    })
  } catch { /* no audio */ }
}
function speak(text) {
  try {
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
  } catch { /* no speech */ }
}

const fmt = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

export default function Stretch() {
  const nav = useNavigate()
  const [idx, setIdx] = useState(null)           // null: not running
  const [end, setEnd] = useState(0)              // wall-clock end of the current step
  const [paused, setPaused] = useState(null)     // ms left when paused
  const [now, setNow] = useState(Date.now())
  const [done, setDone] = useState(false)
  const wake = useRef(null)
  const ticked = useRef(null)

  const go = i => {
    if (i >= STEPS.length) { setIdx(null); setDone(true); speak('Fertig'); return }
    setIdx(i); setPaused(null); ticked.current = null
    setEnd(Date.now() + STEPS[i].s * 1000)
    speak(STEPS[i].name)
  }
  // iOS mutes Web Audio on the ring/silent switch unless the page asks for 'playback' (iOS 17+).
  // The routine is useless without its bell, so it asks for the whole session.
  const playback = () => { try { if (navigator.audioSession) navigator.audioSession.type = 'playback' } catch { /* older iOS */ } }
  const start = () => { playback(); audio(); setDone(false); go(0) }
  const stop = () => { setIdx(null); setPaused(null); window.speechSynthesis?.cancel() }

  // tick: countdown voice in the last three seconds, bell and advance at zero
  useEffect(() => {
    if (idx == null || paused != null) return
    let advancing = false
    const id = setInterval(() => {
      const t = Date.now(); setNow(t)
      const left = Math.ceil((end - t) / 1000)
      if (left >= 1 && left <= 3 && ticked.current !== left) { ticked.current = left; audio(); speak(String(left)) }
      if (t >= end && !advancing) {
        advancing = true; clearInterval(id)
        playback(); audio(); bell()
        try { navigator.vibrate && navigator.vibrate([200, 80, 200]) } catch { /* iOS */ }
        setTimeout(() => go(idx + 1), 1400)
      }
    }, 200)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, end, paused])

  // keep the screen on while running; iOS drops the lock when backgrounded, so take it again
  useEffect(() => {
    const running = idx != null
    const take = async () => { try { if (running && navigator.wakeLock && !wake.current) wake.current = await navigator.wakeLock.request('screen') } catch { /* unsupported */ } }
    const release = () => { try { wake.current && wake.current.release() } catch { /* gone */ } wake.current = null }
    if (running) take(); else release()
    const vis = () => { if (document.visibilityState === 'visible') { audio(); wake.current = null; take() } }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [idx])
  useEffect(() => () => { try { wake.current && wake.current.release() } catch { /* gone */ } }, [])

  const pause = () => { setPaused(Math.max(0, end - Date.now())); window.speechSynthesis?.cancel() }
  const resume = () => { playback(); audio(); setEnd(Date.now() + paused); setPaused(null) }

  const step = idx != null ? STEPS[idx] : null
  const left = step ? Math.max(0, Math.ceil((paused != null ? paused : end - now) / 1000)) : 0
  const sit = step && step.name === 'Hinsetzen'

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => { stop(); nav('/home') }} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>拉伸</h1><div className="sub">{STEPS.filter(x => x.s > 5).length} 个动作 · 约 {Math.round(TOTAL / 60)} 分钟</div></div>
    </div>

    {step ? (
      <div className="card" style={{ textAlign: 'center', padding: '28px 16px', background: sit ? 'var(--red)' : undefined }}>
        <div className="muted small">{idx + 1} / {STEPS.length}</div>
        <div className="big" style={{ fontSize: 30, marginTop: 6 }}>{step.name}</div>
        <div className="muted" style={{ marginTop: 4, color: sit ? '#fff' : undefined }}>{step.desc}</div>
        <div style={{ fontSize: 76, fontWeight: 600, fontVariantNumeric: 'tabular-nums', margin: '14px 0 4px' }}>{fmt(left)}</div>
        {STEPS[idx + 1] && <div className="muted small" style={{ color: sit ? '#fff' : undefined }}>下一个:{STEPS[idx + 1].name}</div>}
        <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: 'center' }}>
          <Button size="sm" onClick={() => idx > 0 && go(idx - 1)}>上一步</Button>
          {paused != null ? <Button size="sm" variant="primary" onClick={resume}>继续</Button> : <Button size="sm" onClick={pause}>暂停</Button>}
          <Button size="sm" onClick={() => go(idx + 1)}>跳过</Button>
          <Button size="sm" variant="danger" onClick={stop}>退出</Button>
        </div>
      </div>
    ) : (
      <div className="card">
        {done && <div className="muted" style={{ marginBottom: 10 }}>完成了。</div>}
        <Button variant="primary" icon="play" onClick={start}>开始拉伸</Button>
      </div>
    )}

    <div className="card">
      {STEPS.map((x, i) => x.name === 'Break' ? null : (
        <div key={i} className="row between" style={{ padding: '7px 0', opacity: idx != null && i < idx ? 0.4 : 1, fontWeight: i === idx ? 600 : 400 }}>
          <div><div>{x.name}</div><div className="muted small">{x.desc}</div></div>
          <div className="muted small">{x.s}s</div>
        </div>
      ))}
    </div>
  </>
}
