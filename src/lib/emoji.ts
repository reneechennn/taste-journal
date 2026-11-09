// 無照片食譜卡片的 emoji 判斷
import type { MealType, Recipe } from './types'
import { CATEGORY_EMOJI } from './types'

/** 餐點類型 emoji（2026-11 順位修訂：類型優先於分類） */
const TYPE_EMOJI: Record<string, string> = {
  早午餐: '🍳',
  副菜: '🥗',
  湯品: '🍲',
  飯類: '🍚',
  麵食: '🍜',
  點心: '🍪',
  醬料: '🥫',
}

/**
 * 無照片卡片要顯示的 emoji（有照片時不會呼叫到這支，那些直接走圖片）：
 * 1. 餐點類型列入 TYPE_EMOJI（早午餐／副菜／湯品／飯類／麵食／點心／醬料）→ 類型 emoji
 * 2. 依「主食材分類」：分類明確（≠其他）→ 分類 emoji
 * 3. 分類「其他」（尚未分類）→ 📖（2026-11-09 修訂：不再掃主食材文字推斷）
 */
export function cardEmoji(
  r: Pick<Recipe, 'category' | 'type' | 'ingredients' | 'marinades' | 'seasonings'>,
): string {
  const byType = TYPE_EMOJI[r.type as MealType]
  if (byType) return byType
  if (r.category !== '其他') return CATEGORY_EMOJI[r.category] ?? '📖'
  return '📖'
}
