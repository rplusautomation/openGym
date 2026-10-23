// R+ fork: the food log screen (lib/food-log.js). Built for one hand in a hurry: a photo (camera or
// album) is the whole entry if need be; each barcode, scanned live or found in a photo, adds one food
// with its portion and kcal (several foods per entry); meal and kind
// are preset from the hour; text and numbers are optional. Inside the NOOP app this screen is its own
// tab (#/food?tab=1), so the gym tab bar is hidden there. Tapping a logged entry loads it back into
// the form to correct it (any entry of the last 14 days, the coach's estimates included).
import { useCallback, useEffect, useRef, useState } from 'react'
import { SB_BACKEND, foodAdd, foodUpdate, foodList, foodDelete, foodPhotoUpload } from '../lib/supabase-backend.js'
import { MEALS, KINDS, mealLabel, defaultMeal, defaultKind, portion, lookupBarcode, openPhoto, encodePhoto, findBarcode, scanFrame, itemsTotal, itemsText } from '../lib/food-log.js'
import { todayISO, isoOf } from '../lib/format.js'
import { Segmented, NumberField, TextField, TextArea, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import '../food.css'

const yesterdayISO = () => isoOf(new Date(Date.now() - 86400000))

// Live barcode scan: the rear camera in place, a decode every ~200 ms until a code shows up.
function BarcodeScan({ onFound, onCancel }) {
  const videoRef = useRef(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let stream = null, timer = null, done = false
    const stop = () => { done = true; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()) }
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      } catch { setError(true); return }
      if (done) { stream.getTracks().forEach(t => t.stop()); return }
      const v = videoRef.current
      v.srcObject = stream
      try { await v.play() } catch { /* frames still arrive */ }
      const tick = async () => {
        if (done) return
        const code = v.readyState >= 2 ? await scanFrame(v).catch(() => null) : null
        if (code && !done) { stop(); onFound(code); return }
        timer = setTimeout(tick, 200)
      }
      tick()
    })()
    return stop
  }, [onFound])
  return <div className="card">
    {error
      ? <div className="small muted" style={{ marginBottom: 10 }}>相机打不开。用"拍照 / 相册"拍条码也可以。</div>
      : <>
          <div className="cam-wrap"><video ref={videoRef} playsInline muted autoPlay /><div className="cam-frame" aria-hidden="true" /></div>
          <div className="small muted" style={{ textAlign: 'center', margin: '10px 0' }}>条码横着对准框，离 10 到 20 厘米</div>
        </>}
    <Button variant="tinted" onClick={onCancel}>取消</Button>
  </div>
}

function blank() {
  const meal = defaultMeal(new Date().getHours())
  return { date: todayISO(), meal, kind: defaultKind(meal), note: '', items: [], photos: [], kcal: null, protein: null, base: { kcal: null, protein: null } }
}

// One scanned food: name, kcal per 100 g, portion buttons and grams, its own kcal.
function FoodItem({ item, onGrams, onKcal, onRemove }) {
  const p = item.product
  return <div className="food-item">
    <div className="row between">
      <div style={{ fontWeight: 600, minWidth: 0 }} className="food-entry">{item.name || '条码 ' + item.barcode}</div>
      <button className="iconbtn" aria-label="去掉" onClick={onRemove}><Icon name="xmark" /></button>
    </div>
    <div className="small muted">{p ? (p.kcal100 != null ? `${p.kcal100} kcal/100 g` : '数据库里没有热量') : '数据库里没有这个条码，热量自己填或者留空'}</div>
    {p && p.kcal100 != null && <div className="chips nocap" style={{ marginTop: 8 }}>
      {p.packG && <button className={'chip nocap' + (item.grams === p.packG ? ' on' : '')} onClick={() => onGrams(p.packG)}>整包 {p.packG} g</button>}
      {p.packG && <button className={'chip nocap' + (item.grams === p.packG / 2 ? ' on' : '')} onClick={() => onGrams(p.packG / 2)}>半包</button>}
      {p.servingG && <button className={'chip nocap' + (item.grams === p.servingG ? ' on' : '')} onClick={() => onGrams(p.servingG)}>一份 {p.servingG} g</button>}
    </div>}
    <div className="row" style={{ gap: 14, marginTop: 8 }}>
      {p && p.kcal100 != null && <label className="row small muted" style={{ gap: 6 }}><NumberField value={item.grams} nullable decimal={false} style={{ width: 70 }} onChange={onGrams} /> g</label>}
      <label className="row small muted" style={{ gap: 6 }}><NumberField value={item.kcal} nullable decimal={false} style={{ width: 70 }} onChange={onKcal} /> kcal</label>
    </div>
  </div>
}

export default function Food() {
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(null)       // a short line while a photo or code is being read
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [rows, setRows] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [editing, setEditing] = useState(null)   // the row being corrected, or null for a new entry
  const fileRef = useRef(null)
  const set = patch => setF(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))
  const setItem = (key, patch) => set(s => ({ items: s.items.map(i => i.key === key ? { ...i, ...patch } : i) }))

  const reload = () => foodList(7).then(r => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]))
  useEffect(() => { if (SB_BACKEND) reload() }, [])

  async function addCode(code) {
    setBusy('查询 ' + code + '…')
    const prod = await lookupBarcode(code).catch(() => null)
    const grams = prod && prod.kcal100 != null ? (prod.packG || prod.servingG || 100) : null
    const p = portion(prod, grams)
    const item = { key: Date.now() + Math.random(), barcode: code, product: prod, name: prod && prod.name, grams, kcal: p.kcal, protein: p.protein }
    set(s => ({ items: [...s.items, item] }))
    setBusy(null)
  }
  const onScanned = useCallback(code => { setScanning(false); addCode(code) }, [])
  const onScanCancel = useCallback(() => setScanning(false), [])

  async function pick(files) {
    setErr(null)
    for (const file of files) {
      let pic = null
      try {
        setBusy('读取照片…')
        pic = await openPhoto(file)
        const enc = await encodePhoto(pic)
        const preview = URL.createObjectURL(enc.blob)
        // The upload runs in the background; saving waits for it.
        const upload = foodPhotoUpload(enc.blob, enc.mime)
        upload.catch(() => {})
        set(s => ({ photos: [...s.photos, { preview, upload }] }))
        setBusy('找条码…')
        const code = await findBarcode(pic).catch(() => null)
        if (code) await addCode(code)
      } catch {
        setErr('这张照片读不了，换一张试试。')
      } finally {
        if (pic) pic.close()
        setBusy(null)
      }
    }
  }

  function edit(r) {
    reset()
    setEditing(r)
    setF({ date: r.date, meal: r.meal, kind: r.kind, note: r.entry || '', items: [], kcal: null, protein: null,
      base: { kcal: r.est_kcal, protein: r.est_protein_g },
      photos: (r.photo_urls || []).map(u => ({ preview: u, upload: Promise.resolve(u), saved: true })) })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function reset() {
    f.photos.forEach(p => { if (!p.saved) URL.revokeObjectURL(p.preview) })
    setEditing(null)
    setF(blank())
  }

  // The entry's total: what was typed in the total field, else the stored value (when correcting)
  // plus every scanned food.
  const items = itemsTotal(f.items)
  const add = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0))
  const total = { kcal: f.kcal ?? add(f.base.kcal, items.kcal), protein: f.protein ?? add(f.base.protein, items.protein) }

  async function save() {
    setSaving(true); setErr(null)
    try {
      const urls = await Promise.all(f.photos.map(p => p.upload))
      const row = { date: f.date, meal: f.meal, kind: f.kind, entry: itemsText(f.items, f.note),
        est_kcal: total.kcal, est_protein_g: total.protein, photo_urls: urls }
      if (editing) { if (!(await foodUpdate(editing.id, row))) throw new Error('not saved') }
      else await foodAdd({ ...row, barcode: f.items[0] && f.items[0].barcode })
      reset()
      reload()
    } catch {
      setErr('没存上，网络好了再点一次。')
    } finally {
      setSaving(false)
    }
  }

  async function remove(row) {
    if (!window.confirm('删除这条记录？')) return
    await foodDelete(row.id).catch(() => {})
    if (editing && editing.id === row.id) reset()
    reload()
  }

  const canSave = !saving && !busy && (f.photos.length || f.note.trim() || f.items.length)
  const byDay = d => (rows || []).filter(r => r.date === d)
  const days = [...new Set((rows || []).map(r => r.date))].sort().reverse()
  const dayLabel = d => d === todayISO() ? '今天' : d === yesterdayISO() ? '昨天' : d.slice(5).replace('-', '/')
  const addonKcal = d => byDay(d).filter(r => r.kind === 'addon').reduce((a, r) => a + (r.est_kcal || 0), 0)
  const dateOpts = [{ value: todayISO(), label: '今天' }, { value: yesterdayISO(), label: '昨天' }]
  if (f.date !== todayISO() && f.date !== yesterdayISO()) dateOpts.push({ value: f.date, label: dayLabel(f.date) })

  if (!SB_BACKEND) return <div className="narrow"><div className="hdr"><h1>饮食</h1></div><div className="muted">只在 rpagym 上可用。</div></div>

  return <div className="narrow food">
    <div className="hdr"><div><h1>饮食</h1><div className="sub">只记和计划不一样的</div></div></div>

    {editing && <div className="card food-editing row between">
      <div style={{ fontWeight: 600 }}>修改 {dayLabel(editing.date)} 的记录</div>
      <Button variant="plain" size="sm" onClick={reset}>取消</Button>
    </div>}

    {scanning && <BarcodeScan onFound={onScanned} onCancel={onScanCancel} />}

    <div className="card">
      <div className="food-step">1 · 加食物（可以加好几样）</div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={e => { const fs = [...(e.target.files || [])]; e.target.value = ''; if (fs.length) pick(fs) }} />
      <div className="row" style={{ gap: 10 }}>
        <Button variant="tinted" icon="qr" onClick={() => setScanning(true)} disabled={!!busy || scanning}>扫条码</Button>
        <Button variant="tinted" icon="camera" onClick={() => fileRef.current && fileRef.current.click()} disabled={!!busy}>拍照 / 相册</Button>
      </div>
      {busy && <div className="small muted" style={{ marginTop: 8 }}>{busy}</div>}
      {f.items.map(it => <FoodItem key={it.key} item={it}
        onGrams={g => { const p = portion(it.product, g); setItem(it.key, { grams: g, kcal: p.kcal, protein: p.protein }) }}
        onKcal={kcal => setItem(it.key, { kcal })}
        onRemove={() => set(s => ({ items: s.items.filter(i => i.key !== it.key) }))} />)}
      {f.photos.length > 0 && <div className="food-thumbs">
        {f.photos.map((p, i) => <div key={i} className="food-thumb">
          <img src={p.preview} alt="" />
          <button className="iconbtn" aria-label="去掉照片" onClick={() => set(s => ({ photos: s.photos.filter((_, j) => j !== i) }))}><Icon name="xmark" /></button>
        </div>)}
      </div>}
      {!f.items.length && !f.photos.length && <div className="small muted" style={{ marginTop: 8 }}>有条码就扫条码；没有就拍一张，教练周一按照片估。</div>}
    </div>

    <div className="card">
      <div className="food-step">2 · 哪一顿</div>
      <Segmented options={MEALS} value={f.meal} onChange={meal => set({ meal, kind: defaultKind(meal) })} />
      <Segmented className="food-gap" options={KINDS} value={f.kind} onChange={kind => set({ kind })} />
      <Segmented className="food-gap" options={dateOpts} value={f.date} onChange={date => set({ date })} />
      <TextArea className="food-gap" rows={editing ? 3 : 2} placeholder="备注（可不填），比如：加了鸡胸肉" value={f.note} onChange={e => set({ note: e.target.value })} />
    </div>

    <div className="card">
      <div className="food-step">3 · 保存</div>
      <div className="row" style={{ gap: 14 }}>
        <label className="row small muted" style={{ gap: 6 }}>合计 <NumberField value={total.kcal} nullable decimal={false} style={{ width: 80 }} onChange={kcal => set({ kcal })} /> kcal</label>
        <label className="row small muted" style={{ gap: 6 }}>蛋白 <NumberField value={total.protein} nullable decimal={false} style={{ width: 60 }} onChange={protein => set({ protein })} /> g</label>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>扫过的食物自动加起来；不知道就留空。</div>
      <Button variant="primary" className="food-gap" onClick={save} disabled={!canSave}>{saving ? '保存中…' : editing ? '保存修改' : '保存'}</Button>
      {err && <div className="small" style={{ color: 'var(--red)', marginTop: 8 }}>{err}</div>}
    </div>

    {days.length > 0 && <div className="small muted" style={{ margin: '0 4px 8px' }}>点一条记录可以修改</div>}
    {days.map(d => <div className="card" key={d}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <div style={{ fontWeight: 600 }}>{dayLabel(d)}</div>
        {addonKcal(d) > 0 && <div className="small muted">额外 {addonKcal(d)} kcal</div>}
      </div>
      {byDay(d).map(r => <div className={'food-row' + (editing && editing.id === r.id ? ' on' : '')} key={r.id} onClick={() => edit(r)}>
        {r.photo_urls && r.photo_urls[0] ? <img src={r.photo_urls[0]} alt="" /> : <span className="food-noimg"><Icon name="image" /></span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div>{mealLabel(r.meal)} · {r.kind === 'replacement' ? '替换' : '额外'}{r.est_kcal != null ? ` · ${r.est_kcal} kcal` : ''}</div>
          {r.entry && <div className="small muted food-entry">{r.entry}</div>}
        </div>
        {r.source === 'app' && <button className="iconbtn" aria-label="删除" onClick={e => { e.stopPropagation(); remove(r) }}><Icon name="trash" /></button>}
      </div>)}
    </div>)}
  </div>
}
