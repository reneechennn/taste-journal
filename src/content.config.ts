import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
import { CATEGORIES, CUISINES, MEAL_TYPES } from './lib/types'

// 食譜集合：src/content/recipes/ 裡每個 .md 檔 = 一道食譜
// 檔名（去掉 .md）就是食譜的 slug，保留中文原味
const recipes = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/recipes',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: z.object({
    title: z.string(),
    photo: z.string().optional(),
    photoThumb: z.string().optional(),
    category: z.enum(CATEGORIES),
    type: z.enum(MEAL_TYPES),
    cuisine: z.enum(CUISINES),
    time: z.number().optional(),
    source: z.string().optional(),
    servings: z.number().default(4),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
})

export const collections = { recipes }
