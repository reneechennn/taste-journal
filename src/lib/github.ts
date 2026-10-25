// ============ 味覺手帳 · GitHub 同步層 ============
// 唯一資料來源是 GitHub repo：
//   讀取 → raw.githubusercontent.com（加時間戳繞過快取，永遠拿最新版）
//   寫入 → GitHub Contents API（需要登入，走 OAuth token）

import repoCfg from '../config/repo.json'

export const REPO = repoCfg as { owner: string; repo: string; branch: string }

const TOKEN_KEY = 'tj_token'
const API = 'https://api.github.com'

// ---------- 登入 token ----------

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function hasAuth(): boolean {
  return !!getToken()
}

/** 開頁時攔截 URL 上的 token（OAuth 回來帶 #auth_token=、本機開發可用 ?token=） */
export function captureToken() {
  const fromHash = location.hash.match(/auth_token=([^&]+)/)
  const fromQuery = new URLSearchParams(location.search).get('token')
  const t = fromHash?.[1] || fromQuery || ''
  if (t) {
    try {
      localStorage.setItem(TOKEN_KEY, t)
    } catch { /* 無痕模式等，忽略 */ }
    // 清乾淨 URL（token 不該留在網址上）
    const search = location.search.replace(/([?&])token=[^&]*&?/, '$1').replace(/[?&]$/, '')
    history.replaceState(null, '', location.pathname + search)
    return true
  }
  return false
}

export function login(returnTo: string = location.pathname + location.search) {
  location.href = `/api/auth/login?return=${encodeURIComponent(returnTo)}`
}

export function logout() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch { /* 忽略 */ }
  location.href = '/'
}

// ---------- 基礎工具 ----------

function b64encode(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function ghFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${API}${path}`, {
    ...init,
    cache: 'no-store',
    keepalive: (init as any).keepalive,
    headers: {
      Accept: 'application/vnd.github+json',
      ...authHeaders(),
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}

// ---------- 讀取 ----------

const rawUrl = (path: string) =>
  `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/${REPO.branch}/${encodeURI(path)}?v=${Date.now()}`

/** 讀取 repo 裡的 JSON 檔（永遠最新版），失敗或不存在回 null */
export async function readJSON<T>(path: string): Promise<T | null> {
  if (!REPO.owner) return null
  try {
    const r = await fetch(rawUrl(path), { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

// ---------- 寫入（Contents API） ----------

async function getContents(path: string): Promise<{ sha: string; data: any } | null> {
  const r = await ghFetch(
    `/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(path)}?ref=${REPO.branch}&t=${Date.now()}`,
  )
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`GitHub 讀取失敗（${r.status}）`)
  const j = await r.json()
  return { sha: j.sha, data: j.content ? JSON.parse(b64decode(j.content)) : null }
}

async function putContents(
  path: string,
  contentB64: string,
  message: string,
  sha?: string,
  keepalive = false,
): Promise<{ ok: boolean; status: number }> {
  const r = await ghFetch(`/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}) }),
  })
  return { ok: r.ok, status: r.status }
}

/** 刪除檔案（例如刪食譜） */
export async function deleteFile(path: string, message: string): Promise<boolean> {
  const cur = await getContents(path)
  if (!cur) return true // 本來就不存在
  const r = await ghFetch(`/repos/${REPO.owner}/${REPO.repo}/contents/${encodeURI(path)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha: cur.sha }),
  })
  return r.ok
}

/** 寫入文字檔（食譜 md）。
 *  create=true 時若檔名已存在會回 conflict，不會覆蓋別的食譜。 */
export async function writeTextFile(
  path: string,
  text: string,
  message: string,
  opts: { create?: boolean } = {},
): Promise<{ ok: boolean; conflict: boolean; error?: string }> {
  const cur = await getContents(path)
  if (opts.create && cur) return { ok: false, conflict: true }
  const content = b64encode(text)
  let res = await putContents(path, content, message, cur?.sha)
  if (res.ok) return { ok: true, conflict: false }
  if (res.status === 409 || res.status === 422) {
    if (opts.create) return { ok: false, conflict: true }
    // 更新衝突（別的裝置先寫了）→ 重新抓 sha 再試一次
    const cur2 = await getContents(path)
    res = await putContents(path, content, message, cur2?.sha)
  }
  return { ok: res.ok, conflict: false, error: `HTTP ${res.status}` }
}

/** 上傳圖片（傳入 canvas.toDataURL() 的結果） */
export async function uploadImage(path: string, dataUrl: string, message: string): Promise<boolean> {
  const b64 = dataUrl.split(',')[1]
  if (!b64) return false
  const res = await putContents(path, b64, message)
  return res.ok
}

// ---------- 狀態 JSON 寫入佇列（debounce + 衝突重試） ----------
// 採買清單勾勾、今日餐點切換這類快速操作，會先彙整再一次性送出。

type WriteJob = { getData: () => any; message: string; merge?: (remote: any, ours: any) => any }
const queue = new Map<string, WriteJob>()
let timer: ReturnType<typeof setTimeout> | null = null
let flushing = false

export function writeJSON(
  path: string,
  getData: () => any,
  opts: { message: string; merge?: (remote: any, ours: any) => any },
) {
  if (!REPO.owner || !hasAuth()) return
  queue.set(path, { getData, message: opts.message, merge: opts.merge })
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushWrites, 700)
}

async function flushWrites() {
  if (flushing) return
  flushing = true
  try {
    for (const [path, job] of [...queue.entries()]) {
      queue.delete(path)
      try {
        await writeJsonNow(path, job)
      } catch (err) {
        console.error('[taste-journal] 寫入失敗:', path, err)
      }
    }
  } finally {
    flushing = false
  }
}

async function writeJsonNow(path: string, job: WriteJob) {
  const data = job.getData()
  if (data == null) return
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await getContents(path)
    const finalData =
      cur?.data != null && job.merge ? job.merge(cur.data, data) : data
    const res = await putContents(
      path,
      b64encode(JSON.stringify(finalData, null, 2) + '\n'),
      job.message,
      cur?.sha,
      true, // keepalive：頁面切換瞬間寫入也不中斷
    )
    if (res.ok) return
    if (res.status === 409 || res.status === 422) continue // 衝突 → 重抓再試
    throw new Error(`寫入失敗（HTTP ${res.status}）`)
  }
  throw new Error('寫入衝突，重試後仍失敗')
}

// 離開頁面前把還沒送出的寫入立刻沖出（keepalive 讓請求撐過頁面切換）
window.addEventListener('pagehide', () => {
  if (queue.size > 0 && timer) {
    clearTimeout(timer)
    timer = null
    void flushWrites()
  }
})

// ---------- 使用者身分 ----------

export async function fetchLoginUser(): Promise<{ login: string } | null> {
  if (!hasAuth()) return null
  try {
    const r = await ghFetch('/user')
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}
