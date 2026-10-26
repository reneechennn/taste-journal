// ============ 味覺手帳 · 前端互動核心 ============
// 事件代理、食譜 Modal、Toast、確認視窗、卡片渲染、登入流程。

import type { IngredientLine, Recipe } from './types'
import { REPO, captureToken, hasAuth, login, logout } from './github'
import * as state from './state'
import { sp, scaledText } from './parser'

// 重新匯出給頁面腳本共用
export { sp } from './parser'

// ---------- 小工具 ----------

export function esc(s: string): string {
  return (s ?? '')
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 產生 <svg><use> 圖示（圖示定義在頁面的隱藏 sprite） */
export function ic(name: string, size = 20): string {
  return `<svg class="ic" style="width:${size}px;height:${size}px"><use href="#i-${name}"></use></svg>`
}

export function photoUrl(r: Recipe, thumb: boolean): string {
  if (thumb && r.photoThumb) return `/photos/thumbs/${encodeURIComponent(r.photoThumb)}`
  if (r.photo) return `/photos/${encodeURIComponent(r.photo)}`
  return ''
}

/** 數字轉全形（人份等混排文字中更有雜誌感） */
export function fw(n: number): string {
  return String(n).replace(/\d/g, (d) => '０１２３４５６７８９'[Number(d)])
}

// ---------- 全域狀態 ----------

declare global {
  interface Window {
    TJ: any
  }
}

let recipes: Recipe[] = []
let currentRecipe: Recipe | null = null
let currentServings = 4

export function getRecipes(): Recipe[] {
  return recipes
}

// ---------- Toast ----------

const KEEP_TOAST_KEY = 'tj-keep-toast'

export function toast(msg: string, type: 'info' | 'ok' | 'warn' = 'info', keep = false) {
  if (keep) {
    try {
      sessionStorage.setItem(KEEP_TOAST_KEY, JSON.stringify({ msg, type }))
    } catch { /* 忽略 */ }
    return
  }
  const root = document.getElementById('toast-root')
  if (!root) return
  const el = document.createElement('div')
  el.className = `toast ${type === 'info' ? '' : type}`
  el.textContent = msg
  root.appendChild(el)
  setTimeout(() => {
    el.style.transition = 'opacity .3s ease'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 320)
  }, 3000)
}

function consumeKeepToast() {
  try {
    const raw = sessionStorage.getItem(KEEP_TOAST_KEY)
    if (!raw) return
    sessionStorage.removeItem(KEEP_TOAST_KEY)
    const { msg, type } = JSON.parse(raw)
    setTimeout(() => toast(msg, type), 350)
  } catch { /* 忽略 */ }
}

// ---------- 確認視窗（防呆 Modal） ----------

export function confirmDialog(opts: {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.getElementById('confirm-root')
    if (!root) return resolve(false)
    root.innerHTML = `
      <div class="modal-backdrop" style="z-index:70"></div>
      <div class="fixed inset-0 z-[71] flex items-end md:items-center justify-center p-4 md:p-6">
        <div class="card w-full max-w-sm p-6 md:p-7 text-center" style="animation:pop-in .22s cubic-bezier(.2,.9,.3,1.2)">
          <h3 class="text-lg font-bold mb-2">${esc(opts.title)}</h3>
          <p class="text-soft leading-relaxed text-[15px] mb-6">${esc(opts.message)}</p>
          <div class="flex gap-3 justify-center">
            <button class="btn-ghost" data-c="no">${esc(opts.cancelText ?? '取消')}</button>
            <button class="btn-accent" data-c="yes" ${opts.danger ? 'style="background:var(--color-warn)"' : ''}>${esc(opts.confirmText ?? '確定')}</button>
          </div>
        </div>
      </div>`
    const done = (v: boolean) => {
      root.innerHTML = ''
      resolve(v)
    }
    root.querySelector('[data-c="no"]')?.addEventListener('click', () => done(false))
    root.querySelector('[data-c="yes"]')?.addEventListener('click', () => done(true))
    root.querySelector('.modal-backdrop')?.addEventListener('click', () => done(false))
  })
}

// ---------- 登入流程 ----------

export function requireAuth(action: string): boolean {
  if (!REPO.owner) {
    toast('網站尚未連結 GitHub，部署到 Cloudflare Pages 後即可使用這個功能', 'warn')
    return false
  }
  if (!hasAuth()) {
    promptLogin(action)
    return false
  }
  return true
}

export async function promptLogin(action: string) {
  const ok = await confirmDialog({
    title: '需要登入 GitHub',
    message: `要${action}，需要先登入你的 GitHub 帳號（只需在這台裝置按一次「授權」）。`,
    confirmText: '前往登入',
    cancelText: '下次再說',
  })
  if (ok) login()
}

function refreshAuthChip() {
  const chip = document.getElementById('auth-chip')
  if (!chip) return
  if (!REPO.owner) {
    chip.style.display = 'none'
    return
  }
  chip.style.display = ''
  if (hasAuth()) {
    chip.innerHTML = `${ic('logout', 16)} 登出`
    chip.dataset.action = 'logout'
  } else {
    chip.innerHTML = `${ic('login', 16)} 登入`
    chip.dataset.action = 'login'
  }
}

// ---------- 卡片渲染（前端版，與 SSR 版保持同樣視覺） ----------

export function recipeCardHtml(r: Recipe): string {
  const url = photoUrl(r, true) || photoUrl(r, false)
  const photo = url
    ? `<img src="${esc(url)}" alt="${esc(r.title)}" loading="lazy" class="w-full aspect-[4/3] object-cover">`
    : `<div class="w-full aspect-[4/3] bg-cream flex items-center justify-center text-faint">${ic('image', 40)}</div>`
  return `
  <article class="card overflow-hidden flex flex-col">
    <div class="cursor-pointer flex flex-col flex-1" data-action="open-recipe" data-slug="${esc(r.slug)}">
      ${photo}
      <div class="p-4 sm:p-5 flex flex-col flex-1">
        <div class="flex flex-wrap gap-1.5">
          <span class="pill pill-type">${esc(r.cuisine)}</span>
          <span class="pill pill-cuisine">${esc(r.type)}</span>
        </div>
        <h3 class="mt-3 font-serif text-[18px] sm:text-[21px] lg:text-[23px] font-bold leading-snug">${esc(sp(r.title))}</h3>
        ${r.time ? `<div class="mt-2 flex items-center gap-1.5 text-[13px] sm:text-[14px] text-soft">${ic('clock', 15)} 約 ${esc(String(r.time))} 分鐘</div>` : ''}
      </div>
    </div>
  </article>`
}

export function todayCardHtml(r: Recipe): string {
  const url = photoUrl(r, true) || photoUrl(r, false)
  const photo = url
    ? `<img src="${esc(url)}" alt="" class="w-11 h-11 sm:w-14 sm:h-14 rounded-xl object-cover shrink-0">`
    : `<div class="w-11 h-11 sm:w-14 sm:h-14 rounded-xl bg-cream flex items-center justify-center text-faint shrink-0">${ic('image', 22)}</div>`
  return `
  <div class="card flex items-center gap-2 sm:gap-3 p-2 sm:p-3">
    ${photo}
    <div class="flex-1 min-w-0 cursor-pointer" data-action="open-recipe" data-slug="${esc(r.slug)}">
      <p class="truncate font-medium text-[15px]">${esc(sp(r.title))}</p>
      <p class="text-xs text-faint mt-0.5">${r.time ? `約 ${esc(String(r.time))} 分鐘` : esc(r.cuisine)}</p>
    </div>
    <button class="quick-btn" data-action="toggle-today" data-slug="${esc(r.slug)}" title="移出今日餐點" aria-label="移出今日餐點">${ic('x', 15)}</button>
  </div>`
}

// ---------- 食譜 Modal ----------

function ingredientSectionsHtml(r: Recipe): string {
  const groups: Array<{ key: string; label: string; lines: IngredientLine[] }> = [
    { key: 'main', label: '主食材', lines: r.ingredients },
    { key: 'marinade', label: '醃料', lines: r.marinades },
    { key: 'seasoning', label: '調味料', lines: r.seasonings },
  ]
  let html = ''
  for (const g of groups) {
    if (g.lines.length === 0) continue
    html += `
    <section>
      <h3 class="font-serif text-[17px] md:text-[18px] font-bold mb-2.5">${g.label} <span class="text-faint font-normal text-sm">${g.lines.length}</span></h3>
      <div class="card !shadow-none p-3.5 md:p-4">
        ${g.lines
          .map(
            (l, i) => `
        <label class="flex items-center gap-3 py-2">
          <span class="ing-round"><input type="checkbox" class="ing-check" data-section="${g.key}" data-idx="${i}"><span class="ball">${ic('check', 13)}</span></span>
          <span class="flex-1 text-[15px] md:text-[16px] leading-relaxed">${esc(sp(l.name))}</span>
          <span class="text-soft whitespace-nowrap text-[14px]" data-qty>${esc(sp(scaledText(l, r.servings, currentServings)))}</span>
        </label>`,
          )
          .join('')}
      </div>
    </section>`
  }
  return html
}

function stepsHtml(r: Recipe): string {
  if (r.steps.length === 0) return ''
  return `
  <section>
    <h3 class="font-serif text-[17px] md:text-[18px] font-bold mb-4">步驟</h3>
    <ol class="space-y-4">
      ${r.steps
        .map(
          (s, i) => `
      <li class="flex gap-3">
        <span class="w-7 h-7 rounded-full bg-cream text-accent-deep font-bold text-sm flex items-center justify-center shrink-0 mt-0.5">${i + 1}</span>
        <div class="flex-1 min-w-0">
          <p class="text-[15px] md:text-[16px] leading-[1.9]">${esc(sp(s.text))}</p>
          ${s.tips.map((t) => `<div class="tip-box mt-2 ml-0">${ic('bulb', 16)}<span>${esc(sp(t))}</span></div>`).join('')}
        </div>
      </li>`,
        )
        .join('')}
    </ol>
  </section>`
}

function sourceHtml(r: Recipe): string {
  if (!r.source) return ''
  const isUrl = /^https?:\/\//i.test(r.source)
  if (isUrl) {
    let label = r.source.replace(/^https?:\/\//i, '')
    if (label.length > 40) label = label.slice(0, 40) + '…'
    return `<a href="${esc(r.source)}" target="_blank" rel="noopener" class="inline-flex items-center gap-1.5 text-accent-deep underline decoration-accent-soft underline-offset-4 break-all">${esc(sp(label))}${ic('external', 13)}</a>`
  }
  return `<span class="text-soft">${esc(sp(r.source))}</span>`
}

function buildModal(r: Recipe): void {
  const root = document.getElementById('modal-root')
  if (!root) return
  currentRecipe = r
  currentServings = r.servings || 4
  const url = photoUrl(r, false)
  const photo = url
    ? `<img src="${esc(url)}" alt="${esc(r.title)}" class="w-full aspect-[16/9] object-cover rounded-2xl">`
    : `<div class="w-full aspect-[16/9] bg-cream flex items-center justify-center text-faint rounded-2xl">${ic('image', 48)}</div>`

  root.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal"></div>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="${esc(r.title)}">
      <div class="modal-scroll flex-1 px-5 md:px-8 py-5 md:py-6" style="padding-bottom:calc(2.5rem + env(safe-area-inset-bottom))">
        <div class="space-y-5 md:space-y-6">
          <div class="relative">
            ${photo}
            <div class="absolute top-3 right-3 flex gap-2">
              <button class="quick-btn ${state.inToday(r.slug) ? 'is-on' : ''}" data-action="toggle-today" data-slug="${esc(r.slug)}" title="加入／移出今日餐點" aria-label="加入今日餐點">${ic('chef', 16)}</button>
              <button class="quick-btn" data-action="edit-recipe" data-slug="${esc(r.slug)}" title="編輯食譜">${ic('pencil', 15)}</button>
              <button class="quick-btn" data-action="close-modal" title="關閉">${ic('x', 16)}</button>
            </div>
          </div>
          <div>
            <h2 class="font-serif text-[26px] md:text-[30px] font-bold leading-snug">${esc(sp(r.title))}</h2>
            <div class="mt-3 flex flex-wrap gap-1.5">
              <span class="pill pill-type">${esc(r.cuisine)}</span>
              <span class="pill pill-cuisine">${esc(r.type)}</span>
              <span class="pill pill-tag">${esc(r.category)}</span>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[14px]">
              ${r.time ? `<span class="inline-flex items-center gap-1.5 text-soft">${ic('clock', 15)} 約 ${esc(String(r.time))} 分鐘</span>` : ''}
              <span class="inline-flex items-center gap-1.5 text-soft">${ic('user', 15)} ${fw(r.servings)} 人份</span>
              ${r.source ? `<span class="inline-flex items-center gap-1.5">${ic('link', 15)} ${sourceHtml(r)}</span>` : ''}
            </div>
          </div>

          <div class="card !shadow-none flex items-center justify-between px-4 py-3 bg-cream/60">
            <div class="text-sm text-soft">用餐人數</div>
            <div class="flex items-center gap-3">
              <button class="quick-btn" data-action="servings-dec" title="減少人數" aria-label="減少人數">${ic('minus', 16)}</button>
              <span class="font-bold text-accent-deep min-w-[4.5rem] text-center" data-servings>${fw(currentServings)} 人份</span>
              <button class="quick-btn" data-action="servings-inc" title="增加人數" aria-label="增加人數">${ic('plus', 16)}</button>
            </div>
          </div>

          <div data-ing-list class="space-y-5 md:space-y-6">${ingredientSectionsHtml(r)}</div>

          <div class="flex items-center gap-2">
            <button class="btn-ghost flex-1 !py-2.5" data-action="add-checked" disabled>${ic('basket', 16)} 加入選取</button>
            <button class="btn-accent flex-1 !py-2.5" data-action="add-all">${ic('basket', 16)} 全部加入</button>
          </div>

          ${stepsHtml(r)}
        </div>
      </div>
    </div>`
  document.documentElement.classList.add('overflow-hidden')
}

function refreshModal(): void {
  if (!currentRecipe) return
  const r = currentRecipe
  // 保留勾選狀態
  const checked = new Set<string>()
  document.querySelectorAll<HTMLInputElement>('.ing-check:checked').forEach((c) => {
    checked.add(`${c.dataset.section}:${c.dataset.idx}`)
  })
  const list = document.querySelector('[data-ing-list]')
  if (list) list.innerHTML = ingredientSectionsHtml(r)
  document.querySelectorAll<HTMLInputElement>('.ing-check').forEach((c) => {
    if (checked.has(`${c.dataset.section}:${c.dataset.idx}`)) c.checked = true
  })
  const s = document.querySelector('[data-servings]')
  if (s) s.textContent = `${fw(currentServings)} 人份`
  updateIngCount()
}

function updateIngCount(): void {
  const n = document.querySelectorAll('.ing-check:checked').length
  const btn = document.querySelector('[data-action="add-checked"]') as HTMLButtonElement | null
  if (btn) {
    btn.disabled = n === 0
    btn.innerHTML = `${ic('basket', 16)} ${n > 0 ? `加入選取(${n})` : '加入選取'}`
  }
}

function closeModal(): void {
  const root = document.getElementById('modal-root')
  if (root) root.innerHTML = ''
  currentRecipe = null
  document.documentElement.classList.remove('overflow-hidden')
}

function collectCheckedLines(): IngredientLine[] {
  const r = currentRecipe
  if (!r) return []
  const lines: IngredientLine[] = []
  document.querySelectorAll<HTMLInputElement>('.ing-check:checked').forEach((c) => {
    const sec = c.dataset.section
    const idx = Number(c.dataset.idx)
    const pool =
      sec === 'main' ? r.ingredients : sec === 'marinade' ? r.marinades : r.seasonings
    const line = pool[idx]
    if (line) lines.push(line)
  })
  return lines
}

function allLines(r: Recipe): IngredientLine[] {
  return [...r.ingredients, ...r.marinades, ...r.seasonings]
}

/** 用網址 hash 開食譜（#r=食譜名），可分享、可上一頁 */
export function openRecipe(slug: string) {
  const target = `#r=${encodeURIComponent(slug)}`
  if (location.hash === target) syncModalFromHash()
  else location.hash = target
}

export function syncModalFromHash(): void {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''))
  if (h.startsWith('r=')) {
    const slug = h.slice(2)
    const r = recipes.find((x) => x.slug === slug)
    if (r) {
      buildModal(r)
      return
    }
  }
  closeModal()
}

// ---------- 快捷操作 ----------

async function handleToggleToday(slug: string): Promise<void> {
  if (!requireAuth('加入今日餐點')) return
  const added = state.toggleToday(slug)
  toast(added ? '已加入今日餐點' : '已從今日餐點移除', 'ok')
  document.dispatchEvent(new CustomEvent('tj:state'))
}

// ---------- Tab bar 上的採買數量角標 ----------

function updateBadge(): void {
  const badge = document.getElementById('tab-badge')
  if (!badge) return
  const n = state.snapshot().shopping.items.length
  badge.textContent = String(n)
  badge.style.display = n > 0 ? '' : 'none'
}

/** 更新所有 🧑‍🍳 按鈕的「已在今日餐點」狀態 */
function refreshChefButtons(): void {
  document.querySelectorAll<HTMLElement>('[data-action="toggle-today"]').forEach((btn) => {
    const slug = btn.dataset.slug
    if (!slug) return
    if (btn.closest('#today-list')) return // 今日餐點裡的按鈕固定為移出樣式
    btn.classList.toggle('is-on', state.inToday(slug))
  })
}

// ---------- 事件代理 ----------

function setupDelegation(): void {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const actEl = target.closest('[data-action]') as HTMLElement | null
    if (actEl) {
      const a = actEl.dataset.action ?? ''
      const slug = actEl.dataset.slug
      switch (a) {
        case 'open-recipe':
          e.preventDefault()
          if (slug) openRecipe(slug)
          return
        case 'toggle-today':
          e.preventDefault()
          e.stopPropagation()
          if (slug) void handleToggleToday(slug)
          return
        case 'edit-recipe':
          e.preventDefault()
          location.href = slug ? `/edit?s=${encodeURIComponent(slug)}` : '/edit'
          return
        case 'close-modal':
          e.preventDefault()
          if (location.hash) history.back()
          else closeModal()
          return
        case 'servings-dec':
          e.preventDefault()
          if (currentServings > 1) {
            currentServings--
            refreshModal()
          }
          return
        case 'servings-inc':
          e.preventDefault()
          if (currentServings < 30) {
            currentServings++
            refreshModal()
          }
          return
        case 'add-checked': {
          e.preventDefault()
          const r = currentRecipe
          if (!r) return
          if (!requireAuth('加入採購清單')) return
          const lines = collectCheckedLines()
          if (lines.length === 0) return
          const n = state.importToShopping(r.title, lines)
          toast(`已將 ${n} 項食材加入採購清單`)
          document.dispatchEvent(new CustomEvent('tj:state'))
          document.querySelectorAll<HTMLInputElement>('.ing-check').forEach((c) => (c.checked = false))
          updateIngCount()
          return
        }
        case 'add-all': {
          e.preventDefault()
          const r = currentRecipe
          if (!r) return
          if (!requireAuth('加入採購清單')) return
          const lines = allLines(r)
          if (lines.length === 0) return
          const n = state.importToShopping(r.title, lines)
          toast(`已將 ${n} 項食材加入採購清單`)
          document.dispatchEvent(new CustomEvent('tj:state'))
          return
        }
        case 'login':
          e.preventDefault()
          login()
          return
        case 'logout':
          e.preventDefault()
          void confirmDialog({ title: '登出', message: '要在這台裝置登出嗎？（食譜資料不受影響）', confirmText: '登出' }).then((ok) => {
            if (ok) logout()
          })
          return
      }
      return
    }
  })

  // 食材勾選數量即時更新
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLElement
    if (t.classList?.contains('ing-check')) updateIngCount()
  })

  // Esc 關閉 modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const confirmRoot = document.getElementById('confirm-root')
      if (confirmRoot && confirmRoot.childElementCount > 0) return
      if (location.hash) history.back()
      else closeModal()
    }
  })
}

// ---------- 啟動 ----------

let readyFired = false

/** 頁面腳本用：不管狀態載入完成的先後順序，callback 一定會被呼叫到 */
export function onReady(cb: () => void) {
  if (readyFired) cb()
  else document.addEventListener('tj:ready', () => cb(), { once: true })
}

export function initUI(): void {
  const captured = captureToken()

  // 讀取頁面上的食譜資料島
  const island = document.getElementById('recipes-data')
  if (island) {
    try {
      recipes = JSON.parse(island.textContent ?? '[]')
    } catch {
      recipes = []
    }
  }

  // 全域入口（頁面腳本會用到）
  window.TJ = {
    recipes,
    get recipesList() {
      return recipes
    },
    openRecipe,
    toast,
    confirmDialog,
    state,
    hasAuth,
    login,
  }

  setupDelegation()
  window.addEventListener('hashchange', syncModalFromHash)

  // 載入跨裝置狀態
  state
    .loadState()
    .catch(() => null)
    .then(() => {
      window.TJ.state = state.snapshot()
      readyFired = true // 先標記再廣播，晚加入的監聽會直接執行
      document.dispatchEvent(new CustomEvent('tj:ready'))
      refreshChefButtons()
      updateBadge()
      syncModalFromHash()
    })

  document.addEventListener('tj:state', () => {
    refreshChefButtons()
    updateBadge()
  })

  refreshAuthChip()
  if (captured) toast('登入成功，這台裝置已記住', 'ok')
  consumeKeepToast()
}
