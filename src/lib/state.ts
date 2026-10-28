// ============ 味覺手帳 · 狀態管理 ============
// 今日餐點（每日歸檔）、烹調次數、採購清單。
// 全部存在 GitHub repo 的 state/ 資料夾，跨裝置同步。
//
// 寫入採「動作制」：上傳的是使用者剛做的動作（加入、勾選、清空⋯），
// 由 GitHub 端把動作套在最新資料上——多分頁／多裝置不會互相覆蓋。

import type { CookCounts, IngredientLine, MenuFile, ShoppingFile, ShoppingItem } from './types'
import { readJSON, writeJSON } from './github'

let menu: MenuFile = { date: '', recipes: [] }
let counts: CookCounts = {}
let shopping: ShoppingFile = { items: [] }
let loaded = false

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36)
}

function normalizeMenu(m: any, date: string): MenuFile {
  if (m && typeof m === 'object' && Array.isArray(m.recipes)) {
    return { date: typeof m.date === 'string' ? m.date : date, recipes: m.recipes.filter((s: unknown) => typeof s === 'string') }
  }
  return { date, recipes: [] }
}

function normalizeShopping(s: any): ShoppingFile {
  if (s && typeof s === 'object' && Array.isArray(s.items)) {
    return {
      items: s.items
        .filter((it: any) => it && typeof it.name === 'string')
        .map((it: any) => ({
          id: typeof it.id === 'string' ? it.id : uid(),
          name: it.name,
          qty: typeof it.qty === 'number' ? it.qty : undefined,
          unit: typeof it.unit === 'string' ? it.unit : undefined,
          qtyText: typeof it.qtyText === 'string' ? it.qtyText : undefined,
          sources: Array.isArray(it.sources) ? it.sources.filter((x: unknown) => typeof x === 'string') : [],
          checked: !!it.checked,
          custom: !!it.custom,
        })),
    }
  }
  return { items: [] }
}

/** 啟動時載入三份狀態檔（不存在就用預設空值） */
export async function loadState(): Promise<{ menu: MenuFile; counts: CookCounts; shopping: ShoppingFile }> {
  const date = todayKey()
  const [m, c, s] = await Promise.all([
    readJSON<MenuFile>(`state/menu/${date}.json`),
    readJSON<CookCounts>('state/cook-count.json'),
    readJSON<ShoppingFile>('state/shopping-list.json'),
  ])
  menu = normalizeMenu(m, date)
  counts = c && typeof c === 'object' ? c : {}
  shopping = normalizeShopping(s)
  loaded = true
  return snapshot()
}

export function snapshot() {
  return { menu, counts, shopping }
}

export function isLoaded(): boolean {
  return loaded
}

// ---------- 今日餐點 ----------

export function inToday(slug: string): boolean {
  return menu.recipes.includes(slug)
}

function menuApply(data: any, op: any): MenuFile {
  const date = typeof op?.date === 'string' && op.date ? op.date : todayKey()
  const m: MenuFile = data && typeof data === 'object' && Array.isArray(data.recipes)
    ? { date: typeof data.date === 'string' && data.date ? data.date : date, recipes: data.recipes }
    : { date, recipes: [] }
  if (op.type === 'menu-add' && !m.recipes.includes(op.slug)) m.recipes.push(String(op.slug))
  if (op.type === 'menu-remove') m.recipes = m.recipes.filter((s: unknown) => s !== op.slug)
  return m
}

function menuDefaults(): MenuFile {
  return { date: menu.date || todayKey(), recipes: [] }
}

function scheduleMenuWrite(op: any) {
  writeJSON(`state/menu/${menu.date || todayKey()}.json`, op, { apply: menuApply, defaults: menuDefaults })
}

export function toggleToday(slug: string): boolean {
  const was = inToday(slug)
  if (was) {
    menu = { ...menu, recipes: menu.recipes.filter((s) => s !== slug) }
    scheduleMenuWrite({ type: 'menu-remove', slug, date: menu.date, _msg: `更新今日餐點（${menu.date}）` })
  } else {
    menu = { ...menu, recipes: [...menu.recipes, slug] }
    counts = { ...counts, [slug]: (counts[slug] ?? 0) + 1 }
    scheduleMenuWrite({ type: 'menu-add', slug, date: menu.date, _msg: `更新今日餐點（${menu.date}）` })
    scheduleCookWrite({ type: 'inc', slug, _msg: `烹調次數 +1（${slug}）` })
  }
  return !was
}

export function removeToday(slug: string) {
  if (!inToday(slug)) return
  menu = { ...menu, recipes: menu.recipes.filter((s) => s !== slug) }
  scheduleMenuWrite({ type: 'menu-remove', slug, date: menu.date, _msg: `更新今日餐點（${menu.date}）` })
}

// ---------- 採購清單 ----------

function cookApply(data: any, op: any): CookCounts {
  const counts = data && typeof data === 'object' ? { ...data } : {}
  if (op.type === 'inc' && typeof op.slug === 'string') counts[op.slug] = (counts[op.slug] ?? 0) + 1
  return counts
}

function cookDefaults(): CookCounts {
  return {}
}

function scheduleCookWrite(op: any) {
  writeJSON('state/cook-count.json', op, { apply: cookApply, defaults: cookDefaults })
}

function shoppingApply(data: any, op: any): ShoppingFile {
  let items: ShoppingItem[] = data && typeof data === 'object' && Array.isArray(data.items) ? data.items : []
  switch (op.type) {
    case 'import': {
      // 把一行行食材套到「最新」的清單上（同名同單位加總、模糊描述合併來源）
      // 已勾選（買完了）的項目不合併——新加入的另開一筆
      for (const line of op.lines ?? []) {
        if (!line?.name) continue
        const existing = items.find((it) => {
          if (it.custom || !it.name || it.name !== line.name || it.checked) return false
          if (line.qty != null && it.qty != null) return it.unit === line.unit
          if (line.qty == null && it.qty == null) return (it.qtyText ?? '') === (line.qtyText ?? '')
          return false
        })
        if (existing) {
          if (line.qty != null && existing.qty != null) existing.qty = existing.qty + line.qty
          if (!existing.sources.includes(op.source)) existing.sources.push(op.source)
        } else {
          items.push({
            id: typeof line._id === 'string' && line._id ? line._id : uid(),
            name: line.name,
            qty: line.qty,
            unit: line.unit,
            qtyText: line.qtyText,
            sources: [op.source],
            checked: false,
          })
        }
      }
      break
    }
    case 'toggle': {
      const it = items.find((i) => i.id === op.id)
      if (it) it.checked = !it.checked
      break
    }
    case 'remove':
      items = items.filter((i) => i.id !== op.id)
      break
    case 'add-custom':
      if (op.name && String(op.name).trim()) {
        items.push({ id: typeof op.id === 'string' ? op.id : uid(), name: String(op.name).trim(), sources: [], checked: false, custom: true })
      }
      break
    case 'clear-done':
      items = items.filter((i) => !i.checked)
      break
    case 'clear-all':
      items = []
      break
  }
  return { items }
}

function shoppingDefaults(): ShoppingFile {
  return { items: [] }
}

function scheduleShoppingWrite(op: any) {
  writeJSON('state/shopping-list.json', op, { apply: shoppingApply, defaults: shoppingDefaults })
}

/** 把食材匯入採購清單（同名同單位自動加總、模糊描述保留文字） */
export function importToShopping(sourceTitle: string, lines: IngredientLine[]): number {
  let added = 0
  const withIds = lines.map((line) => ({ ...line, _id: uid() }))
  for (const line of withIds) {
    if (!line.name) continue
    // 已勾選（買完）的項目不合併，新加入的永遠是獨立一筆
    const existing = shopping.items.find((it) => {
      if (it.custom || !it.name || it.name !== line.name || it.checked) return false
      if (line.qty != null && it.qty != null) return it.unit === line.unit
      if (line.qty == null && it.qty == null) return (it.qtyText ?? '') === (line.qtyText ?? '')
      return false
    })
    if (existing) {
      if (line.qty != null && existing.qty != null) existing.qty = existing.qty + line.qty
      if (!existing.sources.includes(sourceTitle)) existing.sources.push(sourceTitle)
    } else {
      shopping.items.push({
        id: line._id,
        name: line.name,
        qty: line.qty,
        unit: line.unit,
        qtyText: line.qtyText,
        sources: [sourceTitle],
        checked: false,
      })
    }
    added++
  }
  scheduleShoppingWrite({ type: 'import', source: sourceTitle, lines: withIds, _msg: `加入採購清單（${sourceTitle}）` })
  return added
}

export function toggleShoppingItem(id: string) {
  const it = shopping.items.find((i) => i.id === id)
  if (!it) return
  it.checked = !it.checked
  scheduleShoppingWrite({ type: 'toggle', id, _msg: '更新採購清單' })
}

export function removeShoppingItem(id: string) {
  shopping = { items: shopping.items.filter((i) => i.id !== id) }
  scheduleShoppingWrite({ type: 'remove', id, _msg: '刪除採購項目' })
}

export function addCustomItem(name: string) {
  const n = name.trim()
  if (!n) return
  const id = uid()
  shopping.items.push({ id, name: n, sources: [], checked: false, custom: true })
  scheduleShoppingWrite({ type: 'add-custom', name: n, id, _msg: '新增採購項目' })
}

export function clearDoneItems() {
  shopping = { items: shopping.items.filter((i) => !i.checked) }
  scheduleShoppingWrite({ type: 'clear-done', _msg: '清空已完成項目' })
}

export function clearAllItems() {
  shopping = { items: [] }
  scheduleShoppingWrite({ type: 'clear-all', _msg: '清空採購清單' })
}
