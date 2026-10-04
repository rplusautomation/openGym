// R+ fork: a one-tap 90 s timer that floats above the tab bar on every screen, for rests that
// are not tied to a logged set. Wall-clock based, never covers the screen, rings with the app's
// own chime (which honours Settings → Sounds and "play on silent").
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { unlock, vibrate } from '../lib/sound.js'
import { primeBell, ringBell } from '../lib/bell.js'
import Icon from './Icon.jsx'

const SECONDS = 90

export default function QuickTimer() {
  const loc = useLocation()
  const sound = useStore(s => s.S.sound)
  const [end, setEnd] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [ringing, setRinging] = useState(false)

  useEffect(() => {
    if (!end) return
    const id = setInterval(() => {
      const t = Date.now(); setNow(t)
      if (t >= end) {
        clearInterval(id)
        if (sound !== false) ringBell(); vibrate([300, 100, 300])
        setRinging(true); setEnd(null)
        setTimeout(() => setRinging(false), 2500)
      }
    }, 250)
    return () => clearInterval(id)
  }, [end, sound])

  if (loc.pathname === '/stretch' || loc.pathname === '/coach') return null

  const left = end ? Math.max(0, Math.ceil((end - now) / 1000)) : 0
  const label = end ? Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') : ringing ? '0:00' : SECONDS + 's'
  const onTap = () => {
    if (end) { setEnd(null); return }
    unlock(sound !== false); primeBell(); setRinging(false); setNow(Date.now()); setEnd(Date.now() + SECONDS * 1000)
  }

  return (
    <button
      onClick={onTap}
      aria-label={end ? 'Cancel timer' : 'Start 90 second timer'}
      style={{
        position: 'fixed', zIndex: 49, insetInlineEnd: 14, bottom: 'calc(var(--sab) + 74px)',
        display: 'flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 999,
        border: '1px solid var(--sep)', fontSize: 14, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
        background: ringing ? 'var(--red)' : end ? 'var(--acc)' : 'var(--surface)',
        color: ringing ? '#fff' : end ? 'var(--on-acc)' : 'var(--label)',
        boxShadow: '0 4px 14px rgba(0,0,0,.35)'
      }}
    >
      <Icon name={end ? 'xmark' : 'timer'} />{label}
    </button>
  )
}
