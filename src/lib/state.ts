// ============ 味覺手帳 · 狀態管理 ============
// 今日餐點（每日歸檔）、烹調次數、採購清單。
// 全部存在 GitHub 獨立 repo（taste-journal-data）的 state/ 資料夾，跨裝置同步。
//
// 寫入採「動作制」：上傳的是使用者剛做的動作（加入、勾選、清空⋯），
// 由 GitHub 端把動作套在最新資料上——多分頁／多裝置不會互相覆蓋。

import type { CookCounts, IngredientLine, MenuFile, ShoppingFile, ShoppingItem } from './types'
import { parseIngredientLine } from './parser'
import { readJSON, writeJSON, STATE_BRANCH, DATA_REPO } from './github'

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
    readJSON<MenuFile>(`state/menu/${date}.json`, STATE_BRANCH, DATA_REPO),
    readJSON<CookCounts>('state/cook-count.json', STATE_BRANCH, DATA_REPO),
    readJSON<ShoppingFile>('state/shopping-list.json', STATE_BRANCH, DATA_REPO),
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
  writeJSON(`state/menu/${menu.date || todayKey()}.json`, op, { apply: menuApply, defaults: menuDefaults, branch: STATE_BRANCH, repo: DATA_REPO })
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
  writeJSON('state/cook-count.json', op, { apply: cookApply, defaults: cookDefaults, branch: STATE_BRANCH, repo: DATA_REPO })
}

/** 把一行食材併入清單（同名同單位加總、模糊描述合併來源；已勾選的項目不合併） */
function mergeShoppingLine(items: ShoppingItem[], line: IngredientLine, source?: string): void {
  if (!line.name) return
  const existing = items.find((it) => {
    if (!it.name || it.name !== line.name || it.checked) return false
    if (line.qty != null && it.qty != null) return it.unit === line.unit
    if (line.qty == null && it.qty == null) return (it.qtyText ?? '') === (line.qtyText ?? '')
    return false
  })
  if (existing) {
    if (line.qty != null && existing.qty != null) existing.qty = existing.qty + line.qty
    if (source && !existing.sources.includes(source)) existing.sources.push(source)
  } else {
    const id = (line as any)._id
    items.push({
      id: typeof id === 'string' && id ? id : uid(),
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      qtyText: line.qtyText,
      sources: source ? [source] : [],
      checked: false,
    })
  }
}

function shoppingApply(data: any, op: any): ShoppingFile {
  let items: ShoppingItem[] = data && typeof data === 'object' && Array.isArray(data.items) ? data.items : []
  switch (op.type) {
    case 'import':
      for (const line of op.lines ?? []) mergeShoppingLine(items, line, op.source)
      break
    case 'toggle': {
      const it = items.find((i) => i.id === op.id)
      if (it) it.checked = !it.checked
      break
    }
    case 'remove':
      items = items.filter((i) => i.id !== op.id)
      break
    case 'add-custom':
      mergeShoppingLine(items, op.line ?? {}, undefined)
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
  writeJSON('state/shopping-list.json', op, { apply: shoppingApply, defaults: shoppingDefaults, branch: STATE_BRANCH, repo: DATA_REPO })
}

/** 把食材匯入採購清單（同名同單位自動加總、模糊描述保留文字） */
export function importToShopping(sourceTitle: string, lines: IngredientLine[]): number {
  let added = 0
  const withIds = lines.map((line) => ({ ...line, _id: uid() }))
  for (const line of withIds) {
    if (!line.name) continue
    mergeShoppingLine(shopping.items, line, sourceTitle)
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

/** 手動新增項目：也走智慧解析（「橄欖油 一瓶」→ 名稱＋數量），並與未勾選的同名項目合併 */
export function addCustomItem(name: string) {
  const n = name.trim()
  if (!n) return
  const parsed = parseIngredientLine(n)
  const line: IngredientLine =
    parsed.name && (parsed.qty != null || parsed.qtyText) ? parsed : { raw: n, name: n }
  const id = uid()
  const withId: IngredientLine = { ...line, _id: id }
  mergeShoppingLine(shopping.items, withId, undefined)
  scheduleShoppingWrite({ type: 'add-custom', line: withId, id, _msg: '新增採購項目' })
}

export function clearDoneItems() {
  shopping = { items: shopping.items.filter((i) => !i.checked) }
  scheduleShoppingWrite({ type: 'clear-done', _msg: '清空已完成項目' })
}

export function clearAllItems() {
  shopping = { items: [] }
  scheduleShoppingWrite({ type: 'clear-all', _msg: '清空採購清單' })
}
