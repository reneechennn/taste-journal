// 無照片食譜卡片的 emoji 判斷
import type { Recipe } from './types'
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
 * 無照片卡片要顯示的 emoji：
 * 依序看主食材 → 醃料 → 調味料的文字，有對應關鍵字就顯示該類 emoji；
 * 都判斷不出來才退回分類的 emoji（CATEGORY_EMOJI）。
 */
export function cardEmoji(r: Pick<Recipe, 'category' | 'ingredients' | 'marinades' | 'seasonings'>): string {
  for (const lines of [r.ingredients, r.marinades, r.seasonings]) {
    if (!lines?.length) continue
    // 先排除誤判組合：雞蛋≠雞、牛番茄≠牛、雞粉／雞高湯≠雞肉
    const text = lines
      .map((l) => `${l.raw} ${l.name ?? ''}`)
      .join(' ')
      .replace(/牛[蕃番]茄/g, '番茄')
      .replace(/雞蛋/g, '蛋')
      .replace(/雞(高)?湯(塊|粉)?|雞精(粉)?|雞晶|雞粉/g, '高湯')
    for (const [re, emoji] of RULES) if (re.test(text)) return emoji
  }
  return CATEGORY_EMOJI[r.category] ?? '🍽️'
}
