# 味覺手帳 (Taste Journal) — 專案架構文件

> 溫潤日系手帳風的個人食譜網站：食譜以 Markdown 儲存、跨裝置同步、完全免費託管。
> 部署步驟請看 [SETUP.md](./SETUP.md)。

## 架構總覽

```
[電腦 / 手機 / iPad]
        │ 瀏覽器打開網站
        ▼
[Cloudflare Pages（免費託管）]
  ├─ 靜態頁面（Astro 建置，全球 CDN，無 cold start）
  └─ /api/auth/* 小功能（GitHub OAuth 登入用）
        │ 讀取：raw.githubusercontent.com（加時間戳，永遠最新）
        │ 寫入：GitHub Contents API（OAuth token）
        ▼
[GitHub 公開 repo（唯一資料來源）]
  ├─ src/content/recipes/*.md   食譜內容（改動 → 觸發重建，1-2 分鐘生效）
  └─ state/*.json               動態狀態（改動 → 不觸發重建，即時同步）
```

## 資料模型

### 食譜（md，frontmatter + 分節內文）

```markdown
---
title: "番茄燉雞腿"
photo: "r-xxxx.jpg"          # 存在 public/photos/，上傳時自動壓縮
photoThumb: "r-xxxx.jpg"     # 小圖版在 public/photos/thumbs/
category: "雞肉"             # 8 大料理分類（單選）
type: "主菜"                  # 早午餐/主菜/副菜/湯品/飯類/麵食/點心/醬料
cuisine: "歐式"              # 日/台/韓/歐/美/東南亞
time: 45                     # 分鐘
source: ""                   # 網址或純文字（如「MASA食譜 P.99」）
servings: 4                  # 基準人份（詳情頁 ± 動態換算）
createdAt: "…"
updatedAt: "…"
---

## 主食材           ← 一行一項，自由文字（可多項）
## 醃料             ← 有才顯示（條件式渲染）
## 調味料           ← 有才顯示
## 步驟             ← 一行一步驟；`*` 開頭 → 前一步的 💡 小撇步
```

**智慧解析**（`src/lib/parser.ts`）：
- 食材：`雞腿 2 隻` `100g 麵粉` `高麗菜 一顆`（中文數詞含「半」）→ `{name, qty, unit}`；`鹽 少許` → 保留文字不加總
- 換算：可數單位（顆、隻、匙…）以 0.5 步進；g/ml 保留兩位小數
- 排版：中英數之間自動加空格（`sp()`）

### 狀態（JSON，前端直連 GitHub 讀寫）

| 檔案 | 內容 | 寫入時機 |
|---|---|---|
| `state/menu/YYYY-MM-DD.json` | 當日餐點（每日一檔 = 手帳歷史） | 🧑‍🍳 切換 |
| `state/cook-count.json` | 每道食譜烹調次數（加入即 +1，移出不減） | 加入時 |
| `state/shopping-list.json` | 採買項目（同名同單位加總、模糊詞合併標多來源、勾選狀態） | 勾選/匯入/清空 |

寫入機制（`src/lib/github.ts`）：debounce 佇列 + 衝突重試（409/422 重抓 sha）+ `keepalive`（頁面切換不中斷）。讀取走 raw + 時間戳快取繞過，**不需登入、永遠最新**。

## 登入（OAuth）

- 每台裝置第一次「寫入」時 → `/api/auth/login` → GitHub 授權 → callback 帶 `#auth_token=` 回網站 → 存 localStorage，之後不再問
- Client ID/Secret 放 Cloudflare Pages 環境變數（`functions/api/auth/[action].ts` 使用）
- 看網站永遠不用登入；權限 scope 是 `public_repo`（只能動你自己的 repo）

## 主要檔案

| 檔案 | 作用 |
|---|---|
| `src/lib/parser.ts` | 自然語言智慧解析 + 排版工具 |
| `src/lib/github.ts` | repo 設定、OAuth token、讀寫佇列 |
| `src/lib/state.ts` | 今日餐點 / 烹調次數 / 採購清單操作 |
| `src/lib/ui.ts` | 事件代理、食譜 Modal、Toast、確認視窗、卡片渲染 |
| `src/components/EditForm.astro` | 客製編輯頁（即時解析預覽、照片壓縮上傳、防呆刪除） |
| `src/pages/index.astro` | 首頁（今日餐點 + 食譜列表：最近新增/經常烹調 + 分類篩選） |
| `src/pages/search.astro` | 搜尋（多關鍵字 + 類型 Pills + 菜系 + 8 分類插畫 + ↺ 清除篩選） |
| `src/pages/shopping.astro` | 採購清單 |
| `scripts/resolve-repo.mjs` | 建置前自動解析 git remote → `src/config/repo.json`（前端就知道要同步哪個 repo） |

## 設計決策紀錄

- **狀態存 GitHub 而非 localStorage**：滿足「跨裝置同步」核心需求；repo 公開（看不用登入、改需授權，採購清單非敏感資料）
- **狀態寫入不觸發重建**：前端直連 GitHub API，避開每月 500 次重建額度
- **照片上傳自動壓縮**（1600px 全圖 + 480px 縮圖）：100 張照片僅 ~30MB，遠離 GitHub 1GB 建議上限
- **中文檔名 = 食譜 slug**：編輯頁用 `?s=` query 避開路徑編碼問題
- **純靜態輸出**：無 cold start、無伺服器維護、SEO 友善；唯一動態端點是 OAuth 小功能
- **8 插畫分類 = 料理分類（單選）**，主食材是獨立的自由文字欄位（兩個不同欄位）
