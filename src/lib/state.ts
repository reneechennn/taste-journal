// ============ 味覺手帳 · 狀態管理 ============
// 今日餐點（每日歸檔）、烹調次數、採購清單。
// 全部存在 GitHub repo 的 state/ 資料夾，跨裝置同步。

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

function scheduleMenuWrite() {
  writeJSON(`state/menu/${menu.date || todayKey()}.json`, () => menu, {
    message: `更新今日餐點（${menu.date}）`,
  })
}

/** 切換加入／移出今日餐點。回傳 true = 加入（此時烹調次數 +1） */
export function toggleToday(slug: string): boolean {
  const was = inToday(slug)
  if (was) {
    menu = { ...menu, recipes: menu.recipes.filter((s) => s !== slug) }
  } else {
    menu = { ...menu, recipes: [...menu.recipes, slug] }
    counts = { ...counts, [slug]: (counts[slug] ?? 0) + 1 }
    writeJSON('state/cook-count.json', () => counts, {
      message: `烹調次數 +1（${slug}）`,
      // 和別台裝置同時更新時，保留對方的紀錄再疊上自己的
      merge: (remote, ours) => ({ ...(remote ?? {}), ...ours }),
    })
  }
  scheduleMenuWrite()
  return !was
}

export function removeToday(slug: string) {
  if (!inToday(slug)) return
  menu = { ...menu, recipes: menu.recipes.filter((s) => s !== slug) }
  scheduleMenuWrite()
}

// ---------- 採購清單 ----------

/** 把食材匯入採購清單（同名同單位自動加總、模糊描述保留文字） */
export function importToShopping(sourceTitle: string, lines: IngredientLine[]): number {
  let added = 0
  for (const line of lines) {
    if (!line.name) continue
    const existing = shopping.items.find((it) => {
      if (it.custom || !it.name || it.name !== line.name) return false
      if (line.qty != null && it.qty != null) return it.unit === line.unit
      if (line.qty == null && it.qty == null) return (it.qtyText ?? '') === (line.qtyText ?? '')
      return false
    })
    if (existing) {
      if (line.qty != null && existing.qty != null) existing.qty = existing.qty + line.qty
      if (!existing.sources.includes(sourceTitle)) existing.sources.push(sourceTitle)
    } else {
      shopping.items.push({
        id: uid(),
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
  scheduleShoppingWrite(`加入採購清單（${sourceTitle}）`)
  return added
}

function scheduleShoppingWrite(message = '更新採購清單') {
  writeJSON('state/shopping-list.json', () => shopping, { message })
}

export function toggleShoppingItem(id: string) {
  const it = shopping.items.find((i) => i.id === id)
  if (!it) return
  it.checked = !it.checked
  scheduleShoppingWrite()
}

export function removeShoppingItem(id: string) {
  shopping = { items: shopping.items.filter((i) => i.id !== id) }
  scheduleShoppingWrite()
}

export function addCustomItem(name: string) {
  const n = name.trim()
  if (!n) return
  shopping.items.push({ id: uid(), name: n, sources: [], checked: false, custom: true })
  scheduleShoppingWrite()
}

export function clearDoneItems() {
  shopping = { items: shopping.items.filter((i) => !i.checked) }
  scheduleShoppingWrite('清空已完成項目')
}

export function clearAllItems() {
  shopping = { items: [] }
  scheduleShoppingWrite('清空採購清單')
}
