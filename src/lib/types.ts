// ============ 味覺手帳 · 共用型別與常數 ============

export const CATEGORIES = ['牛肉', '雞肉', '豬肉', '魚類', '海鮮', '蛋', '蔬菜', '其他'] as const
export type Category = (typeof CATEGORIES)[number]

export const MEAL_TYPES = ['早午餐', '主菜', '副菜', '湯品', '飯類', '麵食', '點心', '醬料'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const CUISINES = ['日式', '台式', '韓式', '歐式', '美式', '東南亞式'] as const
export type Cuisine = (typeof CUISINES)[number]

/** 料理分類的 emoji 代表圖（無照片卡片用） */
export const CATEGORY_EMOJI: Record<Category, string> = {
  牛肉: '🥩',
  雞肉: '🍗',
  豬肉: '🍖',
  魚類: '🐟',
  海鮮: '🦐',
  蛋: '🥚',
  蔬菜: '🥬',
  其他: '📖',
}

/** 一行食材（解析後） */
export interface IngredientLine {
  raw: string
  name: string
  qty?: number
  unit?: string
  /** 「少許」「適量」等模糊描述 */
  qtyText?: string
}

/** 一個步驟（可能附帶小撇步） */
export interface StepItem {
  text: string
  tips: string[]
}

/** 完整食譜（md 檔解析後） */
export interface Recipe {
  slug: string
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
  ingredients: IngredientLine[]
  marinades: IngredientLine[]
  seasonings: IngredientLine[]
  steps: StepItem[]
  /** 編輯時回填 textarea 用的原始文字 */
  raw: { main: string; marinade: string; seasoning: string; steps: string }
}

/** state/menu/YYYY-MM-DD.json */
export interface MenuFile {
  date: string
  recipes: string[]
}

/** state/cook-count.json */
export type CookCounts = Record<string, number>

/** state/shopping-list.json 的單一項目 */
export interface ShoppingItem {
  id: string
  name: string
  qty?: number
  unit?: string
  qtyText?: string
  sources: string[]
  checked: boolean
  custom?: boolean
}

export interface ShoppingFile {
  items: ShoppingItem[]
}

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v)
}
export function isMealType(v: unknown): v is MealType {
  return typeof v === 'string' && (MEAL_TYPES as readonly string[]).includes(v)
}
export function isCuisine(v: unknown): v is Cuisine {
  return typeof v === 'string' && (CUISINES as readonly string[]).includes(v)
}
