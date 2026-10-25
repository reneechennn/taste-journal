import type { APIRoute } from 'astro'
import { loadAllRecipes } from '../lib/parseCollection'

// 建置時產生 /recipes.json，前端（搜尋、編輯頁）會抓這份完整資料
export const GET: APIRoute = async () => {
  const recipes = await loadAllRecipes()
  return new Response(JSON.stringify(recipes), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}
