# 📖 味覺手帳 (Taste Journal)

溫潤日系手帳風的個人食譜網站：**今日餐點 × 食譜收藏 × 採買清單**，跨裝置同步。

## 快速開始

第一次部署請照著 **[SETUP.md](./SETUP.md)** 一步一步做（約 15 分鐘，免費）。

本機預覽：

```sh
export PATH=/opt/homebrew/bin:$PATH   # 這台電腦需要新版的 node
npm install
npm run dev                            # → http://localhost:4321
```

## 特色

- 🍳 **食譜用 Markdown 檔儲存**（`src/content/recipes/`），一道一檔，永遠是你的資料
- ✍️ **自然語言智慧解析**：「高麗菜 一顆」「醬油 一大匙」「鹽 少許」自動拆成數量單位；步驟開頭打 `*` 變小撇步
- 👨‍🍳 **今日餐點**：每天自動歸檔，像真正的手帳一樣能翻舊帳
- 🛒 **採買清單**：多食譜食材自動彙總、同單位加總，勾選劃掉
- 🔍 **多關鍵字搜尋** + 餐點類型 + 菜系 + 8 大料理分類插畫
- 📱 **完全響應式**：手機底部 Tab Bar（App 感）、桌機頂部導覽
- 🌸 **日系雜誌風**：大圓角、留白、中英數自動空格、手帳紙感
- 🔄 **跨裝置同步**：狀態存在 GitHub repo（`state/`），讀寫不經伺服器、不耗重建額度

## 技術

| 項目 | 選擇 |
|---|---|
| 網站 | Astro 5（純靜態輸出） |
| 樣式 | Tailwind CSS 4 |
| 字體 | LXGW WenKai TC（霞鶩文楷） |
| 資料 | GitHub repo（md 食譜 + JSON 狀態檔） |
| 託管 | Cloudflare Pages（免費子網域） |
| 登入 | GitHub OAuth（Pages Function `functions/api/auth`） |

詳細架構說明見 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 專案結構

```
├── src/
│   ├── content/recipes/     # 每道食譜一個 .md
│   ├── lib/                 # 智慧解析、GitHub 同步、狀態管理、UI 核心
│   ├── components/           # 卡片、編輯表單、圖示
│   ├── pages/               # 首頁 / 搜尋 / 採買 / 編輯
│   └── styles/              # 設計系統
├── state/                   # 跨裝置狀態（每日餐點歸檔、採買清單）
├── public/photos/           # 食譜照片（上傳自動壓縮成兩種尺寸）
└── functions/api/auth/      # GitHub OAuth 登入（Cloudflare Pages Function）
```
