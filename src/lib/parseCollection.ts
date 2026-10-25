// 伺服器端（建置時）載入全部食譜：讀 md 集合 → 智慧解析 → Recipe[]
import { getCollection } from 'astro:content'
import { parseRecipe } from './parser'
import type { Recipe } from './types'

export async function loadAllRecipes(): Promise<Recipe[]> {
  const entries = await getCollection('recipes')
  const recipes = entries.map((e) => parseRecipe(e.id, e.data as any, e.body ?? ''))
  // 預設排序：最近新增在前
  recipes.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return recipes
}
