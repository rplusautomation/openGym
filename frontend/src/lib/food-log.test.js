import { describe, it, expect } from 'vitest'
import { defaultMeal, defaultKind, parseProduct, portion, lookupBarcode, mealLabel } from './food-log.js'

describe('food log defaults', () => {
  it('guesses the meal from the hour', () => {
    expect(defaultMeal(7)).toBe('breakfast')
    expect(defaultMeal(11)).toBe('lunch')
    expect(defaultMeal(15)).toBe('snack')
    expect(defaultMeal(19)).toBe('dinner')
    expect(defaultMeal(23)).toBe('snack')
  })
  it('a main meal replaces the plan, anything else comes on top', () => {
    expect(defaultKind('lunch')).toBe('replacement')
    expect(defaultKind('snack')).toBe('addon')
    expect(defaultKind('other')).toBe('addon')
  })
  it('labels old brunch rows too', () => {
    expect(mealLabel('snack')).toBe('零食')
    expect(mealLabel('brunch')).toBe('早午餐')
  })
})

describe('Open Food Facts product', () => {
  const p = { brands: 'Funny-frisch, Intersnack', product_name_de: 'Chipsfrisch ungarisch', product_quantity: '175', serving_quantity: 30,
    nutriments: { 'energy-kcal_100g': 535, proteins_100g: 6.2 } }
  it('keeps name, per 100 g values and sizes', () => {
    expect(parseProduct(p)).toEqual({ name: 'Funny-frisch Chipsfrisch ungarisch', kcal100: 535, protein100: 6.2, packG: 175, servingG: 30 })
  })
  it('falls back to kJ when kcal is missing', () => {
    expect(parseProduct({ nutriments: { energy_100g: 2092 } }).kcal100).toBe(500)
  })
  it('scales to a portion', () => {
    expect(portion(parseProduct(p), 175)).toEqual({ kcal: 936, protein: 11 })
    expect(portion(parseProduct(p), null)).toEqual({ kcal: null, protein: null })
    expect(portion(parseProduct({ nutriments: {} }), 100)).toEqual({ kcal: null, protein: null })
  })
  it('a barcode the database does not know is null', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ status: 0 }) })
    expect(await lookupBarcode('4000000000000', fetchImpl)).toBe(null)
  })
})

describe('several foods in one entry', () => {
  it('adds what is known', async () => {
    const { itemsTotal, itemsText } = await import('./food-log.js')
    const items = [{ name: 'Pasta', grams: 230, kcal: 810, protein: 30 }, { name: null, barcode: '123', grams: 160, kcal: 514, protein: null }]
    expect(itemsTotal(items)).toEqual({ kcal: 1324, protein: 30 })
    expect(itemsTotal([{ name: 'x', kcal: null, protein: null }])).toEqual({ kcal: null, protein: null })
    expect(itemsText(items, ' with chicken ')).toBe('with chicken · Pasta 230 g; 条码 123 160 g')
    expect(itemsText([], '')).toBe('')
  })
})
