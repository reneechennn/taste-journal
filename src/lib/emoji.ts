// 無照片食譜卡片的 emoji 判斷
import type { MealType, Recipe } from './types'
import { CATEGORY_EMOJI } from './types'

/** 主食材關鍵字 → emoji（先到先得；順序跟 mapCategory 的分類判斷一致） */
const RULES: Array<[RegExp, string]> = [
  [/鮭|魚|鱈|鯖|鯛|旗魚|秋刀|竹莢|青甘|柳葉魚|鰹|一夜干/, '🐟'],
  [/蝦|蟹|貝|蛤|蠣|牡蠣|海鮮|干貝|花枝|透抽|軟絲|小卷|章魚|海膽/, '🦐'],
  [/雞/, '🍗'],
  [/豬|梅花肉|里肌/, '🍖'],
  [/牛/, '🥩'],
  [/蛋/, '🥚'],
  [/菜|瓜|菇|筍|豆|蔥|薑|蒜|椒|紫蘇|洋蔥|蓮藕|馬鈴薯|南瓜|番茄|蕃茄|菠菜|蘆筍|玉米|山藥|牛蒡|鴻禧|金針|杏鮑|秀珍菇/, '🥬'],
]

/**
 * 分類「其他」時的餐點類型 emoji（無法從主食材定型的料理：蔥鹽醬會被『蔥』誤判成蔬菜）
 * 沒列入的類型（主菜等）仍靠主食材文字推斷
 */
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
 * 1. 使用者選了明確分類（≠其他）→ 直接用分類 emoji（分類就是主食材的宣告，別被食材文字蓋掉）
 * 2. 分類是「其他」＋餐點類型有專屬 emoji → 用類型 emoji
 * 3. 主菜等未列入的類型 → 依序掃主食材 → 醃料 → 調味料的文字（先排除雞蛋≠雞、牛番茄≠牛等誤判）
 * 4. 都判斷不出來 → 📖
 */
export function cardEmoji(r: Pick<Recipe, 'category' | 'type' | 'ingredients' | 'marinades' | 'seasonings'>): string {
  if (r.category !== '其他') return CATEGORY_EMOJI[r.category] ?? '🍽️'
  const byType = TYPE_EMOJI[r.type as MealType]
  if (byType) return byType
  for (const lines of [r.ingredients, r.marinades, r.seasonings]) {
    if (!lines?.length) continue
    const text = lines
      .map((l) => `${l.raw} ${l.name ?? ''}`)
      .join(' ')
      .replace(/牛[蕃番]茄/g, '番茄')
      .replace(/雞蛋/g, '蛋')
      .replace(/雞(高)?湯(塊|粉)?|雞精(粉)?|雞晶|雞粉/g, '高湯')
    for (const [re, emoji] of RULES) if (re.test(text)) return emoji
  }
  return '📖'
}
