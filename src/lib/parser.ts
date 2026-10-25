// ============ 味覺手帳 · 自然語言智慧解析 ============
// 把「雞腿 2 隻」「醬油 一大匙」「鹽 少許」這樣的手寫行，
// 解析成名稱／數量／單位的結構化資料。

import type { IngredientLine, Recipe, StepItem, Category, MealType, Cuisine } from './types'

// ---------- 單位詞庫（長的排前面，避免「大匙」被拆成「匙」） ----------
const UNITS = [
  '大匙', '小匙', '湯匙', '茶匙', '公克', '公斤', '毫升', '公升',
  '顆', '個', '隻', '條', '片', '根', '支', '張', '段', '塊', '朵', '粒', '瓣', '莢',
  '尾', '頭', '把', '束', '包', '盒', '罐', '袋', '瓶', '碗', '杯', '匙', '撮', '滴',
  '盤', '鍋', '份', '克', '斤', '兩', '磅', 'g', 'ml', 'cc', 'l', 'lb', 'oz', 'cm',
].sort((a, b) => b.length - a.length)

const UNIT_RE = UNITS.map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

const NUM = String.raw`\d+(?:\.\d+)?(?:\s*[/／]\s*\d+)?(?:\s*[-–~～至]\s*\d+(?:\.\d+)?)?`
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
  const range = cleaned.match(/^(\d+(?:\.\d+)?)[-–~～至](\d+(?:\.\d+)?)$/)
  if (range) return parseFloat(range[1]) // 範圍取最小值
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : undefined
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
  if (vague && vague[1].trim()) return { raw, name: vague[1].trim(), qtyText: vague[2] }
  if (VAGUE_ONLY_RE.test(s)) return { raw, name: '', qtyText: s }

  // 數字在後：「雞腿 2 隻」「低筋麵粉 100g」
  const num = NUM_MAIN_RE.exec(s)
  if (num) {
    const name = num[1].trim()
    const qty = evalNum(num[2])
    if (name && qty != null) return { raw, name, qty, unit: num[3] }
  }

  // 數字在前：「100g 低筋麵粉」
  const lead = NUM_LEAD_RE.exec(s)
  if (lead) {
    const name = lead[3].trim()
    const qty = evalNum(lead[1])
    if (name && qty != null) return { raw, name, qty, unit: lead[2] }
  }

  // 中文數詞：「高麗菜 一顆」「醬油 一大匙」
  const cn = CN_NUM_RE.exec(s)
  if (cn) {
    const name = cn[1].trim()
    const qty = cnToNum(cn[2])
    if (name && qty != null) return { raw, name, qty, unit: cn[3] }
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
      const tip = line.replace(/^[*＊💡]\s*/, '').trim()
      if (!tip) continue
      if (out.length > 0) out[out.length - 1].tips.push(tip)
      else out.push({ text: tip, tips: [] })
      continue
    }
    line = line.replace(/^\d+\s*[.、)）]\s*/, '').trim()
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

/** 可數單位（換算時以 0.5 為步進） */
const COUNTABLE = new Set([
  '顆', '個', '隻', '條', '片', '根', '支', '張', '段', '塊', '朵', '粒', '瓣', '莢',
  '尾', '頭', '把', '束', '包', '盒', '罐', '袋', '瓶', '碗', '杯', '匙', '大匙', '小匙',
  '湯匙', '茶匙', '盤', '鍋', '份', '兩', '磅', 'lb', 'oz',
])

export function formatQty(q: number, unit?: string): string {
  let v = q
  if (unit && COUNTABLE.has(unit.toLowerCase())) v = Math.max(0.5, Math.round(v * 2) / 2)
  else v = Math.round(v * 100) / 100
  if (Number.isInteger(v)) return String(v)
  return String(v).replace(/0+$/, '').replace(/\.$/, '')
}

/** 依人份換算後的顯示文字（「2 隻」「少許」） */
export function scaledText(line: IngredientLine, baseServings: number, servings: number): string {
  if (line.qty == null) return line.qtyText ?? ''
  const q = line.qty * (servings / (baseServings || 4))
  const unit = line.unit ?? ''
  return (formatQty(q, unit) + (unit ? ' ' + unit : '')).trim()
}

/** 中英數字自動空格（盤古之白） */
const HAN = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3001\\u3002\\uff0c\\uff01\\uff1f\\uff1a\\uff1b\\uff08\\uff09'
const HAN_RE1 = new RegExp(`([${HAN}])([A-Za-z0-9])`, 'g')
const HAN_RE2 = new RegExp(`([A-Za-z0-9])([${HAN}])`, 'g')
export function sp(text: string): string {
  if (!text) return ''
  return text.replace(HAN_RE1, '$1 $2').replace(HAN_RE2, '$1 $2')
}
