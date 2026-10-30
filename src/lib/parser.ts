// ============ 味覺手帳 · 自然語言智慧解析 ============
// 把「雞腿 2 隻」「醬油 一大匙」「鹽 少許」這樣的手寫行，
// 解析成名稱／數量／單位的結構化資料。

import type { IngredientLine, Recipe, StepItem, Category, MealType, Cuisine } from './types'

// ---------- 單位詞庫（長的排前面，避免「大匙」被拆成「匙」） ----------
const UNITS = [
  '大匙', '小匙', '湯匙', '茶匙', '公克', '公斤', '毫升', '公升',
  '顆', '個', '隻', '條', '片', '根', '支', '張', '段', '塊', '朵', '粒', '瓣', '莢',
  '尾', '頭', '把', '束', '包', '盒', '罐', '袋', '瓶', '碗', '杯', '匙', '撮', '滴',
  '盤', '鍋', '份', '克', '斤', '兩', '磅', '大湯匙', '小撮', '枚',
  'g', 'ml', 'cc', 'l', 'lb', 'oz', 'cm',
].sort((a, b) => b.length - a.length)

const UNIT_RE = UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

// ---------- 單位統一（別名 → 標準名稱） ----------
// 標準單位：公克／公斤、毫升／公升、大匙／小匙、撮、片、顆、少許（其餘可數單位不合併）
const UNIT_ALIAS: Record<string, string> = {
  克: '公克', g: '公克', G: '公克', gr: '公克',
  kg: '公斤', KG: '公斤', 千克: '公斤',
  cc: '毫升', ml: '毫升', mL: '毫升', ML: '毫升',
  l: '公升', L: '公升',
  湯匙: '大匙', 大湯匙: '大匙', tbsp: '大匙', T: '大匙',
  茶匙: '小匙', tsp: '小匙', t: '小匙',
  小撮: '撮',
  枚: '片',
  個: '顆',
}

/** 把任意的單位寫法換成標準名稱（無對應就原樣保留） */
export function normalizeUnit(u?: string): string | undefined {
  if (!u) return u
  return UNIT_ALIAS[u] ?? UNIT_ALIAS[u.toLowerCase()] ?? u
}

const VAGUE_ALIAS: Record<string, string> = { 些許: '少許' }

const NUM = String.raw`\d+(?:\.\d+)?(?:\s*[/／]\s*\d+)?(?:\s*[-–~～至]\s*\d+(?:\.\d+)?(?:\s*[/／]\s*\d+)?)?`
const NUM_MAIN_RE = new RegExp(`^(.+?)\\s*(${NUM})\\s*(${UNIT_RE})?$`, 'iu')
const NUM_LEAD_RE = new RegExp(`^(${NUM})\\s*(${UNIT_RE})?\\s+(.+)$`, 'iu')
const CN_NUM_RE = new RegExp(`^(.+?)\\s*([一二兩三四五六七八九十半]+)\\s*(${UNIT_RE})?$`, 'u')
const VAGUE_RE = /^(.+?)\s*(少許|適量|些許|適宜|隨意|依個人|個人喜好|適個人口味|適量添加)$/
const VAGUE_ONLY_RE = /^(少許|適量|些許|適宜|隨意)$/

const CN_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 中文數詞轉數字（一～十、半、十二、二十三） */
export function cnToNum(s: string): number | undefined {
  if (!s) return undefined
  if (s === '半') return 0.5
  if (s === '十') return 10
  if (/^[一二兩三四五六七八九]$/.test(s)) return CN_DIGITS[s]
  const m = s.match(/^([一二兩三四五六七八九]?)十([一二兩三四五六七八九]?)$/)
  if (m) {
    const tens = m[1] ? CN_DIGITS[m[1]] : 1
    const ones = m[2] ? CN_DIGITS[m[2]] : 0
    if (tens != null && ones != null) return tens * 10 + ones
  }
  return undefined
}

function evalNum(s: string): number | undefined {
  const cleaned = s.replace(/\s+/g, '')
  const frac = cleaned.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/)
  if (frac) {
    const a = parseFloat(frac[1])
    const b = parseFloat(frac[2])
    return b ? a / b : undefined
  }
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : undefined
}

/** 解析「1 - 2」「1/4 - 1/2」這種範圍，回傳 [下限, 上限]（無範圍時兩者相同） */
function evalRange(s: string): [number, number] | undefined {
  const cleaned = s.replace(/\s+/g, '')
  const m = cleaned.match(/^(.+)[-–~～至](.+)$/)
  if (m) {
    const lo = evalNum(m[1])
    const hi = evalNum(m[2])
    if (lo == null || hi == null) return undefined
    return [Math.min(lo, hi), Math.max(lo, hi)]
  }
  const n = evalNum(cleaned)
  return n == null ? undefined : [n, n]
}

/** 解析單行食材 */
export function parseIngredientLine(raw: string): IngredientLine {
  let s = (raw ?? '').toString().trim()
  if (!s) return { raw: s, name: '' }

  // 去掉項目符號與編號（「- 鹽 少許」「1. 雞腿 2 隻」）
  s = s.replace(/^[-–—•・·+]+\s*/, '')
  s = s.replace(/^\d+\s*[.、)）]\s*/, '')
  // 冒號視為分隔（「雞腿：2 隻」）
  s = s.replace(/[:：]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return { raw, name: '' }

  // 模糊量詞（「鹽 少許」「香油 適量」）
  const vague = VAGUE_RE.exec(s)
  if (vague && vague[1].trim()) return { raw, name: vague[1].trim(), qtyText: VAGUE_ALIAS[vague[2]] ?? vague[2] }
  if (VAGUE_ONLY_RE.test(s)) return { raw, name: '', qtyText: VAGUE_ALIAS[s] ?? s }

  // 數字在後：「雞腿 2 隻」「低筋麵粉 100g」
  const num = NUM_MAIN_RE.exec(s)
  if (num) {
    const name = num[1].trim()
    const range = evalRange(num[2])
    if (name && range) {
      const [lo, hi] = range
      return { raw, name, qty: lo, qtyMax: hi !== lo ? hi : undefined, unit: normalizeUnit(num[3]) }
    }
  }

  // 數字在前：「100g 低筋麵粉」
  const lead = NUM_LEAD_RE.exec(s)
  if (lead) {
    const name = lead[3].trim()
    const range = evalRange(lead[1])
    if (name && range) {
      const [lo, hi] = range
      return { raw, name, qty: lo, qtyMax: hi !== lo ? hi : undefined, unit: normalizeUnit(lead[2]) }
    }
  }

  // 中文數詞：「高麗菜 一顆」「醬油 一大匙」
  const cn = CN_NUM_RE.exec(s)
  if (cn) {
    const name = cn[1].trim()
    const qty = cnToNum(cn[2])
    if (name && qty != null) return { raw, name, qty, unit: normalizeUnit(cn[3]) }
  }

  // 解析不出來就整行當名稱
  return { raw, name: s }
}

export function parseIngredientLines(text: string): IngredientLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseIngredientLine)
    .filter((l) => l.name)
}

/** 解析步驟（「*」開頭 = 前一步的小撇步） */
export function parseSteps(text: string): StepItem[] {
  const out: StepItem[] = []
  for (let line of text.split(/\r?\n/)) {
    line = line.trim()
    if (!line) continue
    if (/^[*＊💡]/.test(line)) {
      const tip = normalizeUnitsInText(line.replace(/^[*＊💡]\s*/, '').trim())
      if (!tip) continue
      if (out.length > 0) out[out.length - 1].tips.push(tip)
      else out.push({ text: tip, tips: [] })
      continue
    }
    line = normalizeUnitsInText(line.replace(/^\d+\s*[.、)）]\s*/, '').trim())
    if (!line) continue
    out.push({ text: line, tips: [] })
  }
  return out
}

// ---------- 標題分節 ----------
const HEADING_ALIAS: Record<string, string> = {
  主食材: '主食材', 食材: '主食材', 材料: '主食材',
  醃料: '醃料', 醃漬: '醃料',
  調味料: '調味料', 調味: '調味料',
  步驟: '步驟', 做法: '步驟', 作法: '步驟',
}

export function splitBodySections(body: string) {
  const map = new Map<string, string>()
  let current = ''
  let sawHeading = false
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^#{2,4}\s*(.+?)\s*$/)
    if (h) {
      sawHeading = true
      const key = HEADING_ALIAS[h[1].replace(/\s/g, '')] ?? h[1]
      current = key
      if (!map.has(current)) map.set(current, '')
      continue
    }
    if (current) map.set(current, (map.get(current) ?? '') + line + '\n')
  }
  return {
    main: map.get('主食材') ?? '',
    marinade: map.get('醃料') ?? '',
    seasoning: map.get('調味料') ?? '',
    steps: map.get('步驟') ?? '',
    hasSections: sawHeading,
  }
}

/** 從 frontmatter + md body 組出完整食譜 */
export function parseRecipe(
  slug: string,
  fm: {
    title: string
    photo?: string
    photoThumb?: string
    category: Category
    type: MealType
    cuisine: Cuisine
    time?: number
    source?: string
    servings: number
    createdAt?: string
    updatedAt?: string
  },
  body: string,
): Recipe {
  const sec = splitBodySections(body)
  const fallbackSteps = sec.hasSections ? '' : body
  return {
    slug,
    title: fm.title,
    photo: fm.photo,
    photoThumb: fm.photoThumb,
    category: fm.category,
    type: fm.type,
    cuisine: fm.cuisine,
    time: fm.time,
    source: fm.source,
    servings: fm.servings || 4,
    createdAt: fm.createdAt,
    updatedAt: fm.updatedAt,
    ingredients: parseIngredientLines(sec.main),
    marinades: parseIngredientLines(sec.marinade),
    seasonings: parseIngredientLines(sec.seasoning),
    steps: parseSteps(sec.steps || fallbackSteps),
    raw: {
      main: sec.main.trim(),
      marinade: sec.marinade.trim(),
      seasoning: sec.seasoning.trim(),
      steps: sec.steps.trim(),
    },
  }
}

// ---------- 顯示格式化 ----------

/** 可數單位（換算時以 0.5 為步進）；大匙／小匙例外——它們要保留 1/4、1/2 這種分數 */
const COUNTABLE = new Set([
  '顆', '隻', '條', '根', '片', '瓣', '朵', '塊', '把', '束', '粒', '支', '張', '段', '莢',
  '尾', '頭', '包', '盒', '罐', '袋', '瓶', '碗', '杯', '匙', '撮',
  '盤', '鍋', '份', '兩', '磅', 'lb', 'oz',
])

/** 重量／容量單位：顯示用小數，不要變成「1 1/2 公斤」 */
const MEASURE = new Set(['公克', '公斤', '毫升', '公升'])

/** 大單位切換：≥1000 公克 → 公斤、≥1000 毫升 → 公升 */
function bigUnit(q: number, unit?: string): [number, string] {
  if (unit === '公克' && q >= 1000) return [q / 1000, '公斤']
  if (unit === '毫升' && q >= 1000) return [q / 1000, '公升']
  return [q, unit ?? '']
}

const FRACS: Record<number, string> = { 1: '1/8', 2: '1/4', 3: '3/8', 4: '1/2', 5: '5/8', 6: '3/4', 7: '7/8' }

/** 數字格式化：
 *  - 重量／容量（公克公斤毫升公升）→ 小數（1.5 公斤，不要變成「1 1/2 公斤」）
 *  - 可數單位 → 0.5 步進，再以人話分數顯示（1¾ 顆 → 「1 3/4 顆」）
 *  - 其他 → 精確八分位分數（1/4 小匙）否則小數 */
/** 數字格式化：
 *  - 重量／容量（公克公斤毫升公升）→ 永遠小數（1.5 公斤）
 *  - 其餘：小於 1 → 人話分數（1/2、1/4 顆）；大於等於 1 → 小數（1.5、1.75，最多三位不四捨五入成 1.13） */
function fmtNum(v: number, unit?: string): string {
  if (unit && MEASURE.has(unit)) {
    v = v >= 100 ? Math.round(v) : Math.round(v * 100) / 100
  } else {
    const fracOf = (x: number): string | null => {
      const e = Math.round(x * 8)
      if (e <= 0 || Math.abs(x * 8 - e) > 1e-6 || e % 8 === 0) return null
      return FRACS[e % 8] ?? null
    }
    // 小於 1 才走分數（1/4 顆）；大於等於 1 一律小數
    let f = v < 1 ? fracOf(v) : null
    if (f) return f
    if (unit && COUNTABLE.has(unit)) v = Math.max(0.5, Math.round(v * 2) / 2)
    else v = Math.round(v * 1000) / 1000
    // 取整後仍小於 1 → 分數；否則小數
    f = v < 1 ? fracOf(v) : null
    if (f) return f
  }
  if (Number.isInteger(v)) return String(v)
  return String(v).replace(/0+$/, '').replace(/\.$/, '')
}

/** 「1 – 2 根」「1/4 – 1/2 小匙」「1.5 公斤」：食材份量顯示的單一管道 */
export function qtyText(min: number, max: number | undefined, unit?: string): string {
  const u = unit ?? ''
  if (max != null && max !== min) {
    // 範圍兩端一律用同一個單位：任一端到大單位就整組換算（600–1200 ml → 0.6–1.2 公升）
    const big = (u === '公克' || u === '毫升') && max >= 1000
    const conv = big ? 1000 : 1
    const label = big ? (u === '公克' ? '公斤' : '公升') : u
    return `${fmtNum(min / conv, label)} – ${fmtNum(max / conv, label)}${label ? ' ' + label : ''}`
  }
  const [q, label] = bigUnit(min, u)
  return (fmtNum(q, label) + (label ? ' ' + label : '')).trim()
}

export function formatQty(q: number, unit?: string): string {
  let v = q
  if (unit && COUNTABLE.has(unit.toLowerCase())) v = Math.max(0.5, Math.round(v * 2) / 2)
  else v = Math.round(v * 100) / 100
  if (Number.isInteger(v)) return String(v)
  return String(v).replace(/0+$/, '').replace(/\.$/, '')
}

/** 依人份換算後的顯示文字（「2 隻」「1 – 2 根」「少許」） */
export function scaledText(line: IngredientLine, baseServings: number, servings: number): string {
  if (line.qty == null) return line.qtyText ?? ''
  const f = servings / (baseServings || 4)
  return qtyText(line.qty * f, line.qtyMax != null ? line.qtyMax * f : undefined, line.unit ?? '').trim()
}

// ---------- 步驟文字裡的單位統一（只動「數字＋單位」型態，安全替換） ----------
const CN_NUM_CHARS = '一二兩三四五六七八九十半'

export function normalizeUnitsInText(t: string): string {
  if (!t) return t
  return (
    t
      // 數字（含分數）後的拉丁單位：100 cc → 100 毫升（阿拉伯數字補空格）
      .replace(
        /(\d+(?:\.\d+)?(?:\s*[/／]\s*\d+)?)(\s*)(cc|ml|mL|ML|gr|g|G|l|L)(?![A-Za-z0-9])/g,
        (m, n, s2, u) => n + ' ' + normalizeUnit(u),
      )
      // 數字／中文數詞後的中文別名單位：1/2 枚 → 1/2 片、2 大湯匙 → 2 大匙
      .replace(
        new RegExp(`([0-9]+(?:\\.[0-9]+)?(?:\\s*[/／]\\s*[0-9]+)?|[${CN_NUM_CHARS}]+)\\s*(大湯匙|茶匙|小撮|枚|克|湯匙)`, 'g'),
        (m, n, u) => {
          const map: Record<string, string> = { 大湯匙: '大匙', 茶匙: '小匙', 小撮: '撮', 枚: '片', 克: '公克', 湯匙: '大匙' }
          const isArabic = /^[0-9]/.test(n)
          return n + (isArabic ? ' ' : '') + map[u]
        },
      )
      .replace(/一小撮/g, '一撮')
  )
}

/** 中英數字自動空格（盤古之白） */
const HAN = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3001\\u3002\\uff0c\\uff01\\uff1f\\uff1a\\uff1b\\uff08\\uff09'
const HAN_RE1 = new RegExp(`([${HAN}])([A-Za-z0-9])`, 'g')
const HAN_RE2 = new RegExp(`([A-Za-z0-9])([${HAN}])`, 'g')
export function sp(text: string): string {
  if (!text) return ''
  return text.replace(HAN_RE1, '$1 $2').replace(HAN_RE2, '$1 $2')
}
