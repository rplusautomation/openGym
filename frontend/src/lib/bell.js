// R+ fork: the boxing bell as a real <audio> element instead of Web Audio. On iPhone, Web Audio
// is silenced by the ring/silent switch (and audioSession 'playback' is iOS 17+ only and not
// reliable in a home-screen app), while a media element plays through it like a video would.
// The WAV is synthesised once at runtime (same spectrum as before: 2660/3965/7030 Hz, three quick
// strikes), so nothing is added to the bundle.
//
// iOS lets a media element play without a tap only after it has been played inside one. prime()
// plays a few milliseconds of silence on the element from the tap that starts a timer; every
// later ring() reuses that element, swapping in the bell.
const RATE = 22050
let el = null

function wavUrl(samples) {
  const n = samples.length
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true)
  // A data: URL, not a blob: one: WebKit's media stack has a history of refusing blob URLs it
  // cannot range-request, and this file is small enough (~100 kB) not to matter.
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return 'data:audio/wav;base64,' + btoa(bin)
}

function makeBellSamples() {
  const len = Math.round(RATE * 1.9)
  const out = new Float32Array(len)
  const partials = [[2660, 1.0, 1.1], [3965, 0.65, 0.9], [7030, 0.4, 0.5]]
  for (const start of [0, 0.35, 0.7]) {
    const s0 = Math.round(start * RATE)
    for (const [f, g, dec] of partials) {
      const k = Math.log(1000) / dec          // ~ -60 dB at the end of the decay
      for (let i = 0; s0 + i < len && i < dec * RATE; i++) {
        const t = i / RATE
        const attack = Math.min(1, t / 0.004)
        out[s0 + i] += g * attack * Math.exp(-k * t) * Math.sin(2 * Math.PI * f * t)
      }
    }
  }
  let peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]))
  // soft-clip for loudness, then normalise just under full scale
  for (let i = 0; i < len; i++) out[i] = Math.tanh(2.2 * out[i] / peak)
  peak = 0
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]))
  for (let i = 0; i < len; i++) out[i] = 0.98 * out[i] / peak
  return out
}

// One file for everything: a short lead-in of silence, then the bell. iOS unlocks playback per
// media element, and swapping `src` after the unlocking tap is exactly what it does not always
// honour, so the element only ever holds this one file. prime() plays it from the tap and stops
// inside the silence; ring() seeks past the silence and plays.
const LEAD = 0.3
let fileUrl = null
let ringing = false

function element() {
  if (!fileUrl) {
    const bell = makeBellSamples()
    const lead = Math.round(LEAD * RATE)
    const all = new Float32Array(lead + bell.length)
    all.set(bell, lead)
    fileUrl = wavUrl(all)
  }
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
    el.setAttribute('playsinline', '')
    el.src = fileUrl
    el.addEventListener('ended', () => { ringing = false })
  }
  return el
}

/** Call from inside a tap (the one that starts a timer). Inaudible: stops inside the lead-in. */
export function primeBell() {
  try {
    const a = element()
    if (ringing) return
    a.currentTime = 0
    const p = a.play()
    const stop = () => { if (!ringing) { a.pause(); try { a.currentTime = 0 } catch { /* not loaded */ } } }
    if (p && p.then) p.then(() => setTimeout(stop, 60)).catch(() => {})
    else setTimeout(stop, 60)
  } catch { /* no audio */ }
}

/** Three strikes of the bell. Works outside a tap once primeBell() ran inside one. */
export function ringBell() {
  try {
    const a = element()
    ringing = true
    try { a.currentTime = LEAD - 0.02 } catch { /* metadata not loaded yet: play from the top */ }
    const p = a.play(); if (p && p.catch) p.catch(() => { ringing = false })
  } catch { ringing = false }
}

// The rest timer starts from a set's checkbox, a tap that knows nothing about sound, so the
// element is primed by the first tap anywhere in the app instead, and again by the first tap
// after the app comes back from the background (iOS may have taken the audio session away).
// Only once per stretch on screen: priming takes the audio session, which pauses other music.
let primedThisVisit = false
function primeOnTouch() {
  if (primedThisVisit) return
  primedThisVisit = true
  primeBell()
}
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('touchend', primeOnTouch, true)
  document.addEventListener('click', primeOnTouch, true)
  document.addEventListener('visibilitychange', () => { if (document.hidden) primedThisVisit = false })
}
