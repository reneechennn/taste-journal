# 🚀 部署指南（SETUP）

照著這份一步步做，大約 15 分鐘就能讓網站上線。
遇到任何卡住的地方，隨時把畫面截圖丟給我（工程師協作者）看。

## 你已經完成

- ✅ GitHub 帳號
- ✅ Cloudflare 帳號

## 第 0 步：確認本機能跑（可略過，上線不依賴本機）

這台電腦的 Node 版本有點舊，本機預覽網站時請用這個指令：

```sh
export PATH=/opt/homebrew/bin:$PATH
npm run dev
```

然後瀏覽器打開 `http://localhost:4321`。**部署到 Cloudflare 不受此影響**（Cloudflare 那邊的環境是新的）。

---

## 第 1 步：把專案放上 GitHub

1. 安裝 GitHub 官方工具（如果還沒有）：到終端機輸入 `brew install gh`
2. 在專案資料夾輸入：

   ```sh
   cd ~/Code/taste-journal
   gh auth login
   ```

   - 問題都照預設：選 **GitHub.com** → **HTTPS** → **Login with a web browser**
   - 瀏覽器會打開，輸入終端顯示的代碼，按 **Authorize** ✓
3. 建立遠端 repo 並推上去：

   ```sh
   gh repo create taste-journal --public --source=. --push
   ```

完成後 `github.com/你的帳號/taste-journal` 會看到所有檔案（含 7 道範例食譜）。

---

## 第 2 步：讓 Cloudflare Pages 發佈網站

1. 打開 [dash.cloudflare.com](https://dash.cloudflare.com) → 左側 **Workers & Pages** → **Create** → 切到 **Pages** 頁籤 → **Connect to Git**
2. 授權 Cloudflare 存取你的 GitHub（第一次會跳 GitHub 頁面按 **Install & Authorize**）
3. 選 `taste-journal` repo → **Begin setup**
4. 設定頁：
   - Project name：`taste-journal`（會決定你的免費網址 `tastejournal.pages.dev`，可以改）
   - Framework preset：**Astro**（會自動帶入 Build command `npm run build`、輸出資料夾 `dist`，不用改）
5. 按 **Save and Deploy**，等 1-2 分鐘 ⏳
6. 完成後打開 `https://你的名字.pages.dev` —— 網站上線了！🎉

> 此時網站可以瀏覽、搜尋，但「加入今日餐點」「採購清單」還不能改動（因為登入還沒設定）——這是第 3、4 步要做的事。

---

## 第 3 步：建立 GitHub 登入授權（OAuth App）

1. 打開 [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App** → 填：
   - **Application name**：`Taste Journal`（隨意）
   - **Homepage URL**：`https://你的名字.pages.dev`
   - **Authorization callback URL**：`https://你的名字.pages.dev/api/auth/callback`
     ⚠️ 這串必須一模一樣（含 `https://`、結尾不能有 `/` 之外的差錯）
2. 按 **Register application** → 頁面上複製 **Client ID**
3. 同頁點 **Generate a new client secret** → 複製 **Client Secret**（只顯示一次！）

---

## 第 4 步：把授權金鑰填進 Cloudflare

1. 回 Cloudflare 儀表板 → **Workers & Pages** → 點你的 `taste-journal` 專案
2. **Settings** → **Variables and Secrets**（變數與密碼）→ **Add**
   - 變數 1：名稱 `GITHUB_CLIENT_ID`，值 = 剛才的 Client ID
   - 變數 2：名稱 `GITHUB_CLIENT_SECRET`，值 = 剛才的 Client Secret
   - 都選 **Production** 環境
3. 到 **Deployments** 分頁 → 最新那筆右邊 `⋯` 選 **Retry deployment**（重新部署讓設定生效）

---

## 第 5 步：開始使用 🎉

1. 打開你的網站，隨便找一張食譜卡片點 🧑‍🍳
2. 會跳出「需要登入 GitHub」→ 按 **前往登入** → GitHub 頁面按 **Authorize**
3. 回到網站，看到「登入成功」—— 這台裝置以後都不用再登了
4. 試試看：
   - 點食譜卡片 → 詳情頁按 ± 調人數，食材即時換算
   - 「全部加入」把食材送進採購清單
   - 換到採買 Tab 勾選已購買的項目
   - 拿起你的 iPad/手機打開網站 → 一切同步 ✓

## 驗收檢查清單

| 試什麼 | 期望結果 |
|---|---|
| 電腦加入今日餐點，手機重新整理 | 手機也看得到 |
| 採購清單勾選項目 | 劃掉變淡 |
| 搜尋「雞腿 番茄」多關鍵字 | 兩個字都要符合 |
| 新增食譜（一行一項） | 儲存後 1-2 分鐘網站出現 |
| 照片上傳 | 自動壓縮成小圖 |

---

## 常見問題

**Q：儲存食譜後網站沒馬上出現？**
A：正常，Cloudflare 需要 1-2 分鐘重建。等一下再重新整理。

**Q：本機開發時想測「寫入」功能？**
A：`npm run dev` 後，在網址後面加上 `?token=你的PAT`（GitHub → Settings → Developer settings → Personal access tokens 建立，勾 `public_repo`）。正式環境用不到這招。

**Q：之後想換自己的網域？**
A：Cloudflare 專案 → Custom domains → 加入網域（需先在 Cloudflare DNS 註冊商買/轉入網域）。記得 GitHub OAuth App 的 callback URL 也要改成新網域。

**Q：想清掉範例食譜？**
A：上線後到網站裡用 🗑️ 刪除，或在 GitHub repo 的 `src/content/recipes/` 資料夾直接刪檔案。
