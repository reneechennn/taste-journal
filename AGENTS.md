# AGENTS.md

味覺手帳（Taste Journal）：Astro 5 純靜態食譜網站 + Cloudflare Pages。食譜是 GitHub repo（taste-journal）裡的 md 檔，執行期狀態存在**獨立 repo（taste-journal-data）**的 JSON。

**使用者不是工程師**：一律用繁體中文回覆，技術決定要用白話解釋，不要假設對方看得懂程式碼。

## 指令與驗證

- 本機預設 `node` 是 v18（太舊，package.json 要求 >=20）。每個 shell 指令前先 `export PATH=/opt/homebrew/bin:$PATH`（Node 24）。
- `npm run dev` → http://localhost:4321（會先執行 `scripts/resolve-repo.mjs`）。
- **`npm run build` 是唯一的驗證手段**：沒有測試、lint、CI；`astro build` 也不做型別檢查。改完必 build 通過再 commit。
- Commit 直接進 `main`，一個改動一個 commit（commit message 用繁體中文）。

## 架構重點

細節見 `ARCHITECTURE.md`；部署步驟見 `SETUP.md`。

- 食譜＝`src/content/recipes/*.md`，**中文檔名就是 slug**（`src/content.config.ts` 的 generateId 保留原檔名）。frontmatter schema 也在該檔；body 固定用 `## 主食材 / ## 醃料 / ## 調味料 / ## 步驟` 分節（後兩者可省略），`*` 開頭的行＝小撇步。
- 食譜來源有兩種：網站編輯器手動建立，或從 Notion 批次匯入（`scripts/import-notion.mjs`，見「Notion 匯入」章節）。目前約 45 道（7 道原始範例＋test＋36 道 Notion 匯入），**都是使用者的真實資料、不是 fixture**，不要刪。
- 執行期狀態（今日餐點、烹調次數、採購清單）**不進建置流程**：存在**獨立 repo `taste-journal-data`** 的 `state/*.json`，前端讀取（登入時走 GitHub API 即時讀、未登入用 raw）與寫入（Contents API，token 在 localStorage `tj_token`）都指向該 repo。狀態寫入**完全不觸發 Cloudflare 建置**——曾因狀態寫入觸發建置燒額度，也發生過舊分頁整份蓋回資料的 bug，已用獨立 repo + 動作制寫入解決，不要改回同 repo 或快照式寫入。
- 狀態寫入是「**動作制**」：`writeJSON` 收到的是使用者動作（op）+ 套用函式（apply），flush 時抓 GitHub 最新資料、依序套用動作再寫回；多分頁／多裝置不會互相覆蓋。切換頁面前要 `flushNow()` 等寫入完成（頁面腳本用 `onReady`）。
- `scripts/resolve-repo.mjs` 從 `git remote` 解析 owner/repo → `src/config/repo.json`（含 dataRepo）。owner 為空時狀態功能會靜默關閉（例如尚未 git init 的全新環境）；本機要測寫入需在網址加 `?token=<PAT>`（scope `public_repo`）。
- 唯一的動態端點是 Cloudflare Pages Function `functions/api/auth/[action].ts`（GitHub OAuth，env：`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`）。讀取永遠不需要登入。
- **雙重渲染陷阱**：食譜卡片同時存在 `src/components/RecipeCard.astro`（SSR）與 `src/lib/ui.ts` 的 `recipeCardHtml()`（前端重排用），改卡片一定兩邊同步改。食譜資料以 `<script type="application/json" id="recipes-data">` 島嵌入 index/search；編輯頁抓 `/recipes.json`。

## 前端慣例（踩過的坑）

- 頁面腳本**必須用 `onReady()`**（src/lib/ui.ts）等狀態載入，不要直接 `document.addEventListener('tj:ready')`——owner 為空時狀態會同步完成，晚註冊的監聽器永遠收不到（曾因此讓所有互動失效）。
- 狀態變動後派發 `CustomEvent('tj:state')`；互動統一走 ui.ts 的 `data-action` 事件代理（新增行為就擴充那個 switch）。
- 所有 `<select class="field">` 由 `initCustomSelects()` 換成自訂下拉；原生 select 只是被隱藏的資料源（change 事件照常）。macOS 會用系統選單渲染原生彈出視窗、不吃網頁字體，別試圖用 CSS 修。**程式若直接設定 `select.value`（如編輯頁回填），必須 `dispatchEvent(new Event('change'))`，否則自訂外殼顯示不會更新**（曾漏掉導致編輯頁分類顯示空白）。
- 輸出使用者內容一律 `esc()` 轉義 + `sp()` 做中英數自動空格。
- 食譜來源的顯示規則（ui.ts `sourceHtml`）：純網址 → favicon＋網域；「顯示名稱 + 網址」→ 顯示自訂名稱；純文字 → 書本圖示＋原文。IG 貼文網址只含貼文 ID、無法推導帳號名，要顯示帳號名得寫成「名稱 + 網址」。
- 沒有照片的食譜卡片顯示 `CATEGORY_EMOJI`（src/lib/types.ts）的分類 emoji，不是灰色佔位圖示。
- PWA 頂部是一組調過的設定：`apple-mobile-web-app-status-bar-style=black-translucent`＋header 的 `padding-top: calc(env(safe-area-inset-top) + 8px)`＋`theme-color=#F7F3EC`。三者互相配合（狀態列一體感＋捲動時有 iOS 毛玻璃＋logo 不被模糊），不要單獨改其中一個。
- 編輯頁是 `/edit?s=<slug>`（單一靜態頁 + query），**刻意不用** `/edit/[slug]`（中文路徑 percent-encoding 在某些靜態伺服器會 404），不要改回去。
- 食譜 Modal 用 URL hash `#r=<slug>` 開關（上一頁可關）。
- 照片：`public/photos/`（大圖）+ `public/photos/thumbs/`（卡片用，選填）；編輯器上傳時 canvas 壓縮出兩張。手動加照片要記得補縮圖。
- 樣式用 `src/styles/global.css` 的 `@theme` token（paper/cream/card/ink/soft/faint/line/accent/leaf）與既有元件 class（`.card` `.btn-accent` `.btn-ghost` `.chip` `.pill` `.field` `.quick-btn` `.tip-box`）；Tailwind v4 經 `@tailwindcss/vite`。
- GitHub 檔案讀取一律用 `getContentsRaw()`（只拿 sha＋原始文字）；**不要對非 JSON 檔（如食譜 md）呼叫 JSON.parse**——曾因把 md 當 JSON 解析，導致所有食譜儲存失敗（`JSON Parse error: Invalid number`）。
- 7 道範例食譜與 seed 的 `state/cook-count.json` 是示範內容、不是測試 fixture，使用者可能透過 UI 刪除。

## Notion 匯入

- 腳本：`scripts/import-notion.mjs`（`NOTION_TOKEN=ntn_... node scripts/import-notion.mjs`；DB id 預設寫在腳本內）。需要 `sharp`（`npm i -D sharp`；若載入失敗補 `npm i -D @img/sharp-darwin-arm64@<版本>`）。
- Notion API 陷阱：**`/blocks/{id}/children` 必須用 GET**（POST 會回 400 `invalid_request_url`）；database query 用 POST 正常。
- 資料結構：食材在 heading_2「材料／醃料／調味料」下的**表格（table_row）**；做法在 heading 下的 numbered_list_item；Notion 頁面通常沒有圖片或封面（視覺都在 IG）。
- 只匯入「有內容」的頁面（有食材或步驟）；只有菜名＋連結的（IG 約 54 道）由使用者整理後再匯入。
- 無標籤預設：其他／主菜／台式；Cuisine 是國旗 emoji（🇹🇼→台式、🇯🇵→日式、🇮🇹🇪🇸→歐式）；Tried 勾選 → 在 `taste-journal-data` 的 cook-count.json +1。

## 環境 quirks

- Cloudflare 建置額度：`Build watch paths`（v3 建置系統）與 `[CI Skip]` commit 前綴對 API 建立的 commit **實測都無效**，不要再嘗試用它們省建置；狀態寫入已靠獨立 data repo 解決。
- GitHub OAuth 的 token 若在 OAuth App 勾了「Expire user access tokens」會約 8 小時失效；線上突然登出時先檢查這個設定。

- 使用者貼截圖走剪貼簿時好時壞（OpenCode 對 opencode-go 模型的 `input` 能力判定 bug）；已用 `~/.config/opencode/opencode.json` 宣告 `modalities` 補救，**不要刪除該檔**。若再失敗，請使用者把截圖存檔，用 `read` 工具直接看檔。
- `browser.screenshot` 需要該 tab 的桌面視窗在最上層才拍得到；拍不到就改請使用者自己看畫面。
