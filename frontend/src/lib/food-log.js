// R+ fork: the food log, rows in the Supabase table food_log (only what deviates from the meal
// plan: a replaced meal or an extra snack). Written and read through og_food_* functions, outside
// the synced state like the coach tips. A photo is re-encoded on the device and uploaded to the
// food-photos bucket; a barcode found in it is looked up on Open Food Facts for kcal and protein.
// Entries without numbers are estimated later by the weekly coach from the photo and the text.

export const MEALS = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '零食' },
  { value: 'other', label: '其他' },
]
export const KINDS = [
  { value: 'replacement', label: '替换计划' },
  { value: 'addon', label: '额外' },
]
export const mealLabel = v => (MEALS.find(m => m.value === v) || { label: v === 'brunch' ? '早午餐' : v }).label

// The meal a log made at this hour most likely is (his workday: oats in the car 10-12, shake 16:30,
// dinner in the evening).
export function defaultMeal(hour) {
  if (hour < 10) return 'breakfast'
  if (hour < 14) return 'lunch'
  if (hour >= 17 && hour < 21) return 'dinner'
  return 'snack'
}
// A logged main meal means the planned one was replaced; a snack comes on top.
export const defaultKind = meal => (meal === 'breakfast' || meal === 'lunch' || meal === 'dinner' ? 'replacement' : 'addon')

// Open Food Facts product -> what the form needs, per 100 g plus the pack and serving sizes in g.
export function parseProduct(p) {
  if (!p || typeof p !== 'object') return null
  const n = p.nutriments || {}
  const num = v => (v == null || v === '' || isNaN(+v) ? null : +v)
  const kcal100 = num(n['energy-kcal_100g']) ?? (num(n.energy_100g) != null ? num(n.energy_100g) / 4.184 : null)
  const brand = Array.isArray(p.brands) ? p.brands[0] : p.brands && String(p.brands).split(',')[0]
  const name = [brand && String(brand).trim(), p.product_name_de || p.product_name || p.generic_name]
    .filter(Boolean).join(' ')
  return {
    name: name || null,
    kcal100: kcal100 != null ? Math.round(kcal100) : null,
    protein100: num(n.proteins_100g),
    carbs100: num(n.carbohydrates_100g),
    fat100: num(n.fat_100g),
    sugar100: num(n.sugars_100g),
    fiber100: num(n.fiber_100g),
    salt100: num(n.salt_100g),
    packG: num(p.product_quantity),
    servingG: num(p.serving_quantity),
  }
}

// What g grams of a parsed product hold: kcal and grams of each nutrient (salt to 0.1 g, the rest
// whole); null where the product does not say.
export const NUTRIENTS = ['protein', 'carbs', 'fat', 'sugar', 'fiber', 'salt']
export function portion(prod, g) {
  const out = { kcal: null }
  NUTRIENTS.forEach(k => { out[k] = null })
  if (!prod || !(g > 0)) return out
  const at = (v, dp = 0) => v == null ? null : Math.round(v * g / 100 * 10 ** dp) / 10 ** dp
  out.kcal = at(prod.kcal100)
  NUTRIENTS.forEach(k => { out[k] = at(prod[k + '100'], k === 'salt' ? 1 : 0) })
  return out
}

// Foods by name ("kartoffelsalat ja"), best matches first: [{ code, ...parseProduct }]. Through the
// site's /off-search proxy (netlify.toml); only products with a kcal value are kept.
export async function searchFoods(q, fetchImpl = fetch) {
  const fields = 'code,product_name,product_name_de,brands,product_quantity,serving_quantity,nutriments'
  const r = await fetchImpl('/off-search?page_size=12&langs=de,en&fields=' + fields + '&q=' + encodeURIComponent(q.trim()))
  if (!r.ok) return []
  const j = await r.json()
  return (j.hits || []).map(h => ({ code: h.code, ...parseProduct(h) })).filter(p => p.name && p.kcal100 != null)
}

export async function lookupBarcode(code, fetchImpl = fetch) {
  const fields = 'product_name,product_name_de,generic_name,brands,product_quantity,serving_quantity,nutriments'
  const r = await fetchImpl(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${fields}`)
  if (!r.ok) return null
  const j = await r.json()
  return j && j.status === 1 ? parseProduct(j.product) : null
}

/* ---------------------------------------------------------------- photo + barcode */

// A picked file (camera or album, any format the phone can open) -> a decoded picture.
// media-ingest is loaded on first use, as CustomMediaField does, so it stays out of the main chunk.
export const openPhoto = async file => (await import('./media-ingest.js')).decodeImage(file, file.type || 'image/jpeg')
// The upload: 1600 px on the long edge is plenty for the coach to read a label.
export const encodePhoto = async pic => (await import('./media-ingest.js')).encodeImage(pic, 1600, 0.8)

let _zx = null
async function zxing() {
  if (!_zx) {
    const Z = await import('@zxing/library')
    const hints = new Map([
      [Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]],
      [Z.DecodeHintType.TRY_HARDER, true],
    ])
    const reader = new Z.MultiFormatReader()
    reader.setHints(hints)
    _zx = { Z, reader }
  }
  return _zx
}

// One decode attempt on `pic` ({ source, width, height }) scaled to `edge`, optionally turned a quarter.
async function decodeAt(pic, edge, turn, canvas) {
  const { Z, reader } = await zxing()
  const k = Math.min(1, edge / Math.max(pic.width, pic.height))
  const w = Math.round(pic.width * k), h = Math.round(pic.height * k)
  canvas.width = turn ? h : w
  canvas.height = turn ? w : h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (turn) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2) }
  ctx.drawImage(pic.source, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const lum = new Uint8ClampedArray(canvas.width * canvas.height)
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (img.data[i] * 299 + img.data[i + 1] * 587 + img.data[i + 2] * 114) / 1000
  try {
    const hit = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, canvas.width, canvas.height))))
    return hit && hit.getText() ? hit.getText() : null
  } catch { return null }   // nothing at this size and turn
}

// A product barcode somewhere in a photo, or null. iPhone has no BarcodeDetector, so zxing reads
// the pixels, at two sizes and also turned a quarter (a barcode photographed upright).
export async function findBarcode(pic, { doc = globalThis.document } = {}) {
  const canvas = doc.createElement('canvas')
  try {
    for (const edge of [1400, 900]) for (const turn of [false, true]) {
      const code = await decodeAt(pic, edge, turn, canvas)
      if (code) return code
    }
    return null
  } finally { canvas.width = 0; canvas.height = 0 }
}

// One live camera frame: a single fast pass, the scanner calls it every few hundred ms.
let _frameCanvas = null
export async function scanFrame(video, { doc = globalThis.document } = {}) {
  if (!video.videoWidth) return null
  if (!_frameCanvas) _frameCanvas = doc.createElement('canvas')
  return decodeAt({ source: video, width: video.videoWidth, height: video.videoHeight }, 960, false, _frameCanvas)
}

/* ---------------------------------------------------------------- several foods in one entry */

// An entry can hold several scanned foods. Each item: { name, grams, kcal, protein } (kcal/protein
// already scaled to its grams, null where unknown). Totals add what is known; null when nothing is.
export function itemsTotal(items) {
  const sum = k => items.some(i => i[k] != null) ? Math.round(items.reduce((a, i) => a + (i[k] || 0), 0) * 10) / 10 : null
  const out = { kcal: sum('kcal') }
  NUTRIENTS.forEach(k => { out[k] = sum(k) })
  return out
}
// The row's nutrients column ({ carbs_g, fat_g, sugar_g, fiber_g, salt_g }) from a total, or null
// when none is known. Protein and kcal have their own columns.
export function nutrientsJson(t) {
  const o = {}
  NUTRIENTS.filter(k => k !== 'protein' && t[k] != null).forEach(k => { o[k + '_g'] = t[k] })
  return Object.keys(o).length ? o : null
}
// The text the row stores: "De Cecco Conchiglie 230 g; Meggle Baguette 160 g" plus the free note.
export function itemsText(items, note) {
  const list = items.map(i => [i.name || '条码 ' + (i.barcode || '?'), i.grams ? i.grams + ' g' : ''].filter(Boolean).join(' ')).join('; ')
  return [note && note.trim(), list].filter(Boolean).join(' · ')
}
