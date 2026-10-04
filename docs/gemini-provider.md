# Gemini provider 與草稿移植

此功能從已合併的 main 基線重新實作，沒有合併舊 dev、ESM／Babel 草稿或它們的 lockfile。維持 CommonJS、npm 與既有 Discord／資料庫／錯誤／資源限制契約；不增加 SDK 或 node-fetch 依賴，使用 Node 原生 fetch。

## 設定

預設 `AI_PROVIDER=openai`，既有 OpenAI 設定仍有效。選 Gemini 時只要求 Gemini key，不要求 OpenAI key：

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=replace-gemini-key
GEMINI_MODEL=gemini-3.5-flash-lite
AI_TIMEOUT_MS=30000
```

上面只有 placeholder。Discord token、MongoDB URI／DB 名與受眾白名單仍須另設，`npm run check:config` 可離線檢查格式。`GEMINI_MODEL` 必須明示，程式不悄悄回退至已停用的舊模型。2026-10-04 查閱的 [Google deprecations](https://ai.google.dev/gemini-api/docs/deprecations) 將 3.5 Flash-Lite 列為新專案選項；這不是對特定帳號可用性、免費額度或成本的驗證。上線前需由擁有者核對模型與 key 的有效性。

`AI_TIMEOUT_MS` 優先；未設定時相容原本 `OPENAI_TIMEOUT_MS`，再回退 30 秒。兩個 provider 都使用既有的輸出 token／byte、上下文、速率、並發與使用者佇列限制。Gemini 不自動重試，避免未知結果下重複計費。

預設仍讀 `.env`，**不會按照 `ENV` 自動切換 `.env.dev`／`.env.prod`**。選擇具名檔案時，使用 Node 的明示方式：

```sh
node --env-file=.env.dev index.js --check-config
```

這只檢查設定，不連線；Node 預載的值不會被 dotenv 的預設非覆寫行為取代。未設定的欄位仍可能由根目錄 `.env` 補入，因此不同環境應使用完整獨立設定或部署時注入環境變數；不要把混合來源當成環境隔離。

## API 與安全契約

- `system` 轉為獨立 `systemInstruction`；`user`／`assistant` 僅在 API 邊界轉為 `user`／`model`，不更動儲存格式。
- 合併同角色相鄰 turns 時保留全部文字 parts；多段文字回應完整串接；thought 文字與 thought signature 不顯示、不保存。
- 使用 `x-goog-api-key` header，key 不放 URL。端點固定 Google Generative Language API，停用自動 redirect。舊 `GEMINI_BASE_URL` 只接受官方 origin；第三方 proxy、Vertex AI endpoint 不在本功能範圍。
- 不覆寫供應商 safety 設定。被擋、無 candidates、非文字／tool 回應、格式錯誤均安全失敗；到達 `MAX_TOKENS` 不將半段答案當完整成功輪次保存。
- HTTP 錯誤只保留安全狀態分類，不解析／記錄原始 error body；請求 deadline 包含讀 body，另外限制解碼後 wire bytes 與回覆 UTF-8 bytes。
- Gemini `cost=null` 表示尚無費率估算，不是 0 元。usage 僅保存白名單數值欄位，缺欄位為 null；`lastUsage.provider` 區分來源。供應商 token 口徑不應混算成帳單。
- `store:false` 關閉該 API 請求的可設定 logging，但不是供應商零保留、免費層資料使用、備份或法規符合性的承諾。DM 提示會依 provider 告知資料接收方。

官方契約：[generateContent](https://ai.google.dev/api/generate-content)、[API key](https://ai.google.dev/gemini-api/docs/api-key)。

## 舊 Gemini DM 資料

舊草稿曾把 system 存成 `user`、assistant 存成 `model`。本版不自動猜測／覆寫這種歷史，仍安全拒絕不符標準角色的 session。若舊版確實運行過，擁有者須另行備份、盤點與批准轉換；也可在獲准啟動後使用 `/ai` 建立新 session，舊資料仍保留。此 PR 沒有讀寫正式 DB 或執行 migration。

## 提交前檢查

```sh
npm run verify
npm run check:secrets -- --staged
```

`verify` 含本機／CI 機密 tripwire，檢查 tracked／未忽略檔案；`--staged` 讀取實際 index blob，連強制加入的 `.env.*` 與 backup 路徑也拒絕。輸出只有檔案路徑、規則與行號，不回顯疑似機密。此檢查涵蓋常見格式，不能取代完整 secret scanner、review 或憑證輪替。

機密與原草稿僅留本機 repository 外的私有備份，不進入任何 commit、stash 或遠端分支。`.env`、`.env.dev`、`.env.prod` 保持不變；不在 PR 列出它們的值、私人 endpoint 或金鑰片段。

## 驗證邊界

離線測試使用 fake credentials、攔截 fetch 與 mock DB／Discord。未啟動 bot、未註冊 commands、未呼叫付費模型、未驗證真實 provider key／模型／DB，也未部署或實際遷移資料。既有單程序限制、隱私與 LICENSE 待決事項仍適用。
