// ============ 味覺手帳 · GitHub 同步層 ============
// 唯一資料來源是 GitHub repo：
//   讀取 → raw.githubusercontent.com（加時間戳繞過快取，永遠拿最新版）
//   寫入 → GitHub Contents API（需要登入，走 OAuth token）

import repoCfg from '../config/repo.json'

export const REPO = repoCfg as { owner: string; repo: string; branch: string; dataRepo: string }

/** 狀態資料（採購清單、今日餐點）存放在獨立 repo（taste-journal-data）：
 *  狀態寫入與 Cloudflare 完全無關，不會觸發網站重建，也不消耗建置額度 */
export const DATA_REPO_OWNER = REPO.owner
export const DATA_REPO = REPO.dataRepo
export const STATE_BRANCH = 'main'

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

const rawUrl = (path: string, branch: string = REPO.branch, repo: string = REPO.repo) =>
  `https://raw.githubusercontent.com/${REPO.owner}/${repo}/${branch}/${encodeURI(path)}?v=${Date.now()}`

/** 讀取 repo 裡的 JSON 檔（永遠最新版），失敗或不存在回 null */
export async function readJSON<T>(path: string, branch: string = REPO.branch, repo: string = REPO.repo): Promise<T | null> {
  if (!REPO.owner) return null

  // 已登入時優先走 GitHub API：raw.githubusercontent 有最多 5 分鐘的 CDN 快取，
  // 剛寫入的狀態可能讀到舊版；API 是即時的。
  if (hasAuth()) {
    try {
      const r = await ghFetch(
        `/repos/${REPO.owner}/${repo}/contents/${encodeURI(path)}?ref=${branch}&t=${Date.now()}`,
      )
      if (r.status === 404) return null
      if (r.ok) {
        const j = await r.json()
        if (!j.content) return null
        return JSON.parse(b64decode(j.content)) as T
      }
    } catch {
      /* 落回 raw 讀取 */
    }
  }

  try {
    const r = await fetch(rawUrl(path, branch, repo), { cache: 'no-store' })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

// ---------- 寫入（Contents API） ----------

async function getContents(path: string, ref: string = REPO.branch, repo: string = REPO.repo): Promise<{ sha: string; data: any } | null> {
  const r = await ghFetch(
    `/repos/${REPO.owner}/${repo}/contents/${encodeURI(path)}?ref=${ref}&t=${Date.now()}`,
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
  branch: string = REPO.branch,
  repo: string = REPO.repo,
): Promise<{ ok: boolean; status: number }> {
  const r = await ghFetch(`/repos/${REPO.owner}/${repo}/contents/${encodeURI(path)}`, {
    method: 'PUT',
    keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: contentB64, ...(sha ? { sha } : {}), branch }),
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

// ---------- 狀態 JSON 寫入佇列（動作制：衝突安全 + debounce） ----------
// 寫入的不是「整份資料的快照」，而是使用者剛做的「動作」。
// flush 時先抓 GitHub 上最新的資料，把動作依序套上去再寫回——
// 這樣多個分頁／多台裝置同時操作時，不會有舊分頁把舊資料整份蓋回去的問題。

type WriteJob = {
  ops: any[]
  apply: (data: any, op: any) => any
  defaults: () => any
  branch: string
  repo: string
}
const queue = new Map<string, WriteJob>()
let timer: ReturnType<typeof setTimeout> | null = null
let flushing = false

export function writeJSON(
  path: string,
  op: any,
  opts: { apply: (data: any, op: any) => any; defaults: () => any; branch?: string; repo?: string },
) {
  if (!REPO.owner || !hasAuth()) return
  let job = queue.get(path)
  if (!job) queue.set(path, job = { ops: [], apply: opts.apply, defaults: opts.defaults, branch: opts.branch ?? REPO.branch, repo: opts.repo ?? REPO.repo })
  job.ops.push(op)
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushWrites, 400)
}

async function flushWrites() {
  if (flushing) return
  flushing = true
  try {
    for (const [path, job] of [...queue.entries()]) {
      if (job.ops.length === 0) continue
      const ops = job.ops.splice(0) // 取走排隊的動作；flush 期間新動作會留在 job.ops
      try {
        await writeStateNow(path, ops, job)
      } catch (err) {
        console.error('[taste-journal] 寫入失敗:', path, err)
        // 失敗的動作放回佇列，安排重試
        job.ops.unshift(...ops)
        if (timer) clearTimeout(timer)
        timer = setTimeout(flushWrites, 2500)
      }
    }
  } finally {
    flushing = false
  }
}

async function writeStateNow(path: string, ops: any[], job: WriteJob) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const cur = await getContents(path, job.branch, job.repo) // 永遠抓最新的（已登入＝API 即時讀取）
    let data = cur?.data != null ? cur.data : job.defaults()
    for (const op of ops) data = job.apply(data, op)
    const msg = `[CI Skip] ${ops.length === 1 ? ops[0]._msg ?? '更新狀態' : ops[0]._msg ?? `更新狀態（${ops.length} 個動作）`}`
    const res = await putContents(
      path,
      b64encode(JSON.stringify(data, null, 2) + '\n'),
      msg,
      cur?.sha,
      true, // keepalive：頁面切換瞬間寫入也不中斷
      job.branch,
      job.repo,
    )
    if (res.ok) return
    if (res.status === 409 || res.status === 422) continue // 衝突 → 重抓再套一次
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

// ---------- 給頁面切換用的「保證寫完」工具 ----------

/** 是否還有排隊中的寫入 */
export function hasPendingWrites(): boolean {
  return queue.size > 0
}

/** 立刻把所有排隊寫入送出，並等到真的完成（供切換頁面前呼叫） */
export async function flushNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  // 若已有進行中的 flush，等它結束再補送
  while (flushing) {
    await new Promise((r) => setTimeout(r, 50))
  }
  await flushWrites()
}

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
