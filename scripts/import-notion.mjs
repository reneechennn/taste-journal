// Notion → 味覺手帳 批次匯入腳本
//
// 用法：
//   NOTION_TOKEN=ntn_xxx node scripts/import-notion.mjs            # 從 Notion 資料庫匯入
//   NOTION_DB=<database-id> NOTION_TOKEN=... node scripts/import-notion.mjs
//
// 前置：
//   1. Notion 整合（my-integrations）建立並把資料庫「連接」給該整合
//   2. 需要 sharp：在專案執行 `npm i -D sharp`（若 sharp 載入失敗，補 `npm i -D @img/sharp-darwin-arm64@<同版本>`）
//
// 行為：
//   - 只匯入「有內容」的頁面（有食材或步驟）；只有菜名＋連結的（多為 IG）跳過並列在報告裡
//   - 食材：heading_2「材料/醃料/調味料」下的表格（table_row）
//   - 步驟：heading_2「做法/步驟」下的 numbered_list_item / 段落
//   - 分類：Notion 的 Ingredients 標籤 → 8 大分類；Cuisine 是國旗 emoji → 菜系
//   - 無標籤預設：其他 / 主菜 / 台式
//   - 建立時間沿用 Notion created_time（「最近新增」排序正確）
//   - 重複執行會依 /tmp/notion-import-report.json 跳過已匯入的（避免產生重複食譜）

import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const TOKEN = process.env.NOTION_TOKEN
const DB = process.env.NOTION_DB || '31fc5ee9-579c-808b-bb3a-ef7bf294fb53'
if (!TOKEN) {
  console.error('缺少 NOTION_TOKEN 環境變數')
  process.exit(1)
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json',
}
const SITE = process.cwd()
const PHOTOS = path.join(SITE, 'public/photos')
const THUMBS = path.join(SITE, 'public/photos/thumbs')
const RECIPES = path.join(SITE, 'src/content/recipes')
const UA = 'TasteJournal-Import/1.0'
const REPORT_PATH = '/tmp/notion-import-report.json'

async function notion(p, body) {
  const r = await fetch(`https://api.notion.com/v1${p}`, {
    method: body ? 'POST' : 'GET',
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 150)}`)
  return j
}

async function allRows() {
  const out = []
  let cursor
  do {
    const body = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const r = await notion(`/databases/${DB}/query`, body)
    out.push(...r.results)
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)
  return out
}

// 注意：/blocks/{id}/children 要用 GET（POST 會回 400 invalid_request_url）
async function allBlocks(pageId) {
  const out = []
  let cursor
  do {
    let p = `/blocks/${pageId}/children?page_size=100`
    if (cursor) p += '&start_cursor=' + encodeURIComponent(cursor)
    const r = await notion(p)
    out.push(...r.results)
    cursor = r.has_more ? r.next_cursor : undefined
  } while (cursor)
  return out
}

function slugify(title) {
  const s = title
    .trim()
    .replace(/[/\\]+/g, '-')
    .replace(/[<>:"|?*#%&{}$!'@+`=~^,.;:：、。！？「」（）\[\]【】\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return s || 'recipe-' + Date.now().toString(36)
}

const CUISINE_MAP = { '🇹🇼': '台式', '🇯🇵': '日式', '🇰🇷': '韓式', '🇮🇹': '歐式', '🇪🇸': '歐式', '🇺🇸': '美式' }
function mapCuisine(flag) {
  if (!flag) return '台式'
  for (const [k, v] of Object.entries(CUISINE_MAP)) if (flag.includes(k)) return v
  return '台式'
}
function mapMealType(v) {
  if (!v) return '主菜'
  if (/main/i.test(v)) return '主菜'
  if (/side/i.test(v)) return '副菜'
  return '主菜'
}
function mapCategory(tags) {
  const all = (tags ?? []).join(' ')
  if (/鮭|魚|鱈/.test(all)) return '魚類'
  if (/蝦|蟹|貝|蛤|海鮮|干貝/.test(all)) return '海鮮'
  if (/雞/.test(all)) return '雞肉'
  if (/豬|梅花|里肌/.test(all)) return '豬肉'
  if (/牛/.test(all)) return '牛肉'
  if (/蛋/.test(all)) return '蛋'
  if (/菜|瓜|菇|筍|豆|蔥|薑|蒜|椒|葉/.test(all)) return '蔬菜'
  return '其他'
}
const richText = (rt) => (rt ?? []).map((t) => t.plain_text).join('')

async function savePhoto(url, base) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`圖片下載失敗 ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  await sharp(buf).rotate().resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(`${PHOTOS}/${base}.jpg`)
  await sharp(buf).rotate().resize(480, 480, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(`${THUMBS}/${base}.jpg`)
}

const pages = await allRows()
const previousReport = fs.existsSync(REPORT_PATH)
  ? JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'))
  : { imported: [] }
const importedNames = new Set(previousReport.imported.map((r) => r.name))
console.log(`Notion 共 ${pages.length} 筆；上次已匯入 ${importedNames.size} 道（將跳過）`)

const existing = new Set(
  fs.existsSync(RECIPES) ? fs.readdirSync(RECIPES).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')) : [],
)
const usedSlugs = new Set(existing)
const report = { imported: [], stubSkipped: [], failed: [] }

let n = 0
for (const page of pages) {
  n++
  const name = page.properties['Name'].title.map((t) => t.plain_text).join('').trim()
  if (!name) {
    report.failed.push(`第 ${n} 筆：沒有菜名，跳過`)
    continue
  }
  if (importedNames.has(name)) continue
  try {
    const blocks = await allBlocks(page.id)
    const ordered = []
    for (const b of blocks) {
      if (b.type === 'table') {
        ordered.push({ type: 'table', rows: (await allBlocks(b.id)).filter((r) => r.type === 'table_row') })
        continue
      }
      ordered.push(b)
    }

    const sections = { main: [], marinade: [], seasoning: [], steps: [] }
    let current = null
    let images = []
    const source = page.properties['Source'].url ?? page.properties['Source 1'].url ?? undefined
    for (const item of ordered) {
      if (item.type === 'table') {
        for (const row of item.rows) {
          const cells = row.table_row.cells.map((c) => richText(c))
          const line = cells.filter((c) => c.trim()).join(' ').trim()
          if (!line || !current) continue
          if (current === 'main' || current === 'marinade' || current === 'seasoning') sections[current].push(line)
        }
        continue
      }
      const b = item
      if (b.type === 'image') {
        images.push(b.image.type === 'file' ? b.image.file.url : b.image.external.url)
        continue
      }
      if (b.has_children) continue
      const text = richText(b[b.type]?.rich_text)
      if (!text.trim()) continue
      if (b.type === 'heading_1' || b.type === 'heading_2' || b.type === 'heading_3') {
        const h = text.replace(/\s/g, '')
        if (/醃料|醃漬/.test(h)) current = 'marinade'
        else if (/調味/.test(h)) current = 'seasoning'
        else if (/做法|作法|步驟|方式/.test(h)) current = 'steps'
        else if (/材料|食材|主食材/.test(h)) current = 'main'
        else current = 'other'
        continue
      }
      if (current === 'steps' || (current === 'other' && (b.type === 'numbered_list_item' || b.type === 'bulleted_list_item'))) {
        const t = text.replace(/^\d+[.、)）]\s*/, '').trim()
        if (t) sections.steps.push({ text: t, tips: [] })
      } else if (current === 'main' || current === 'marinade' || current === 'seasoning') {
        sections[current].push(text.trim())
      }
    }

    const hasContent = sections.steps.length > 0 || sections.main.length > 0
    if (!hasContent) {
      report.stubSkipped.push(`${name}（${source ?? '無連結'}）`)
      continue
    }

    const category = mapCategory((page.properties['Ingredients'].multi_select ?? []).map((m) => m.name))
    const type = mapMealType(page.properties['Meal Type'].select?.name)
    const cuisine = mapCuisine(page.properties['Cuisine'].select?.name)

    let slug = slugify(name)
    while (usedSlugs.has(slug)) slug = `${slug}-${Math.random().toString(36).slice(2, 5)}`
    usedSlugs.add(slug)

    let photo = null
    if (images.length > 0) {
      try {
        const base = `r-${slug}-${n}`
        await savePhoto(images[0], base)
        photo = `${base}.jpg`
      } catch (e) {
        report.failed.push(`${name}：圖片下載失敗（${e.message}），以無照片匯入`)
      }
    }

    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const yaml = [
      '---',
      `title: "${esc(name)}"`,
      photo ? `photo: "${photo}"` : null,
      photo ? `photoThumb: "${photo}"` : null,
      `category: "${category}"`,
      `type: "${type}"`,
      `cuisine: "${cuisine}"`,
      page.properties['Cook Time'].number ? `time: ${page.properties['Cook Time'].number}` : null,
      source ? `source: "${esc(source)}"` : null,
      `servings: ${page.properties['Servings'].number ?? 4}`,
      `createdAt: "${page.created_time}"`,
      `updatedAt: "${page.last_edited_time}"`,
      '---',
      '',
    ].filter((l) => l != null)
    const body = ['## 主食材', ...sections.main, '']
    if (sections.marinade.length) body.push('## 醃料', ...sections.marinade, '')
    if (sections.seasoning.length) body.push('## 調味料', ...sections.seasoning, '')
    body.push('## 步驟', ...sections.steps.map((s) => s.text), '')

    fs.writeFileSync(path.join(RECIPES, `${slug}.md`), yaml.join('\n') + '\n' + body.join('\n'), 'utf8')
    report.imported.push({ name, slug, photo: !!photo, steps: sections.steps.length, ingredients: sections.main.length })
    console.log(`✓ [${n}/${pages.length}] ${name} → ${slug}.md（步驟 ${sections.steps.length}、食材 ${sections.main.length}${photo ? '、有照片' : ''}）`)
  } catch (e) {
    report.failed.push(`${name}：${e.message}`)
    console.log(`✗ [${n}] ${name}：${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 340)) // Notion 速率限制
}

console.log('\n========== 匯入報告 ==========')
console.log(`成功：${report.imported.length} 道`)
console.log(`不完整跳過：${report.stubSkipped.length} 道`)
for (const s of report.stubSkipped) console.log('  - ' + s)
console.log(`失敗：${report.failed.length}`)
for (const s of report.failed) console.log('  - ' + s)
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2))
console.log(`\n報告已存到 ${REPORT_PATH}；Tried（做過）欄位請另用 API 更新 taste-journal-data 的 cook-count.json`)
