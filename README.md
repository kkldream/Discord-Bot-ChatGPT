# Discord-Bot-ChatGPT

Discord 文字聊天 bot，支援 OpenAI Chat Completions／Google Gemini，搭配 MongoDB。支援伺服器文字頻道的回覆串及私訊對話。

> 本分支是 issue #1 的程式與離線驗證基線，不代表已完成正式環境驗收。只支援**單一 bot 程序／一個 replica**；既有資料遷移、隱私政策、憑證處理、模型替換及正式部署仍需擁有者決定。詳見 [處理狀態](docs/issue-1-status.md)。
>
> **模型期限：**2026-10-04 查核的 OpenAI 官方公告列出 `gpt-4.1-nano`／`gpt-4.1-nano-2025-04-14` 於 **2026-10-23** 停用。此版本為維持既有行為仍以該模型為預設；上線前須指定並驗證替代 `OPENAI_MODEL`，不能只升 SDK 就視為已處理模型生命週期。[官方公告](https://developers.openai.com/api/docs/deprecations)

## 行為與定位

`stringValue.js` 的既有娛樂／角色扮演 persona 未更動；不是一般助理或官方人物帳號，不保證內容正確或適合所有受眾。本次不主張比 ChatGPT 更便宜或更快。

在一般伺服器文字頻道使用 `/ai` 後，回覆 bot 訊息即可續聊；不是回覆本 bot 的訊息不會呼叫模型。在 DM 使用 `/ai` 初始化，再傳送文字即可。`/ai` 會建立新對話並將舊對話標為完成，**不會刪除舊資料**。不處理其他 bot、webhook、空白訊息、語音／附件輸入或其他頻道類型。

超過 Discord 2,000 字元限制的輸出以完整 UTF-8 `ai-response.txt` 附件送出，不拆壞 Unicode 或程式碼圍欄。頻道回覆的完整正文另外存於 `temp` collection，供後續引用；不從顯示用文字猜測或切除標頭。

## 支援與鎖定版本

| 元件 | 本次鎖定版本 |
| --- | --- |
| Node.js | 24.21.0；本分支要求 `>=24.21.0 <25` |
| npm | 11.19.0；使用 `package-lock.json` |
| discord.js | 14.27.0 |
| OpenAI Node SDK | 7.27.0 |
| MongoDB Node driver | 7.7.0 |
| dotenv | 18.0.5 |

Docker 使用 `node:24.21.0-bookworm-slim`，以 manifest digest 固定；以非 root 使用者執行。MongoDB driver 的協定支援底線不代表伺服器仍在官方維護期；部署前須核對實際 MongoDB server／驗證機制與 [官方相容表](https://www.mongodb.com/docs/drivers/node/current/reference/compatibility/)。本次未讀取或升級正式 DB。

## 先做不連外的程式驗證

```sh
npm ci --ignore-scripts --no-audit
npm run verify
npm run test:coverage
```

安裝會下載 npm 套件；`verify`／測試本身不需要 `.env`，並封鎖實際網路傳輸。OpenAI 契約測試使用**真實安裝的 SDK + 注入的假 fetch**；DB、Discord 與 HTTP server 採 mock，不是外部整合測試。測試不啟動 bot、不註冊指令、不讀正式 DB、不呼叫付費模型。

```sh
npm audit --audit-level=high
npm run sbom
```

這兩個指令不是 bot 執行路徑。audit 會向 npm 查詢公告；SBOM 產生 `.artifacts/sbom.cdx.json`。公告零命中不等於無漏洞、已完成可達性分析或容器 OS 掃描。

需重現原始缺陷時，可單獨執行 `npm run test:baseline`。它只讀固定 baseline commit 的函式並注入 stub，**預期六個測試失敗**；不屬於正常 CI。需 clone 含 `fec0daca6695afb2e8024f4e6b6a92f9eb99427b` 的 Git 歷史。

## 設定

預設 `AI_PROVIDER=openai`；切換 `AI_PROVIDER=gemini` 時改用 `GEMINI_API_KEY` 與明示的 `GEMINI_MODEL`。環境設定、資料相容性與驗證邊界見 [Gemini provider](docs/gemini-provider.md)。

將 `.env.example` 複製成 `.env`，填入所選供應商的 API key、Discord token、MongoDB URI 與**明確的資料庫名稱**。範例不包含帳號密碼；不得把 `.env`、備份、log 或正式對話提交至 Git。

至少設定 `ALLOWED_USER_IDS` 或 `ALLOWED_GUILD_IDS`。ID 以逗號分隔；不填白名單且 `ALLOW_PUBLIC_ACCESS=false` 時，設定驗證會拒絕啟動，不會默認開放所有人。

| 設定 | 行為 |
| --- | --- |
| `ALLOWED_USER_IDS` | 設定後，所有情境皆限制為這些使用者 |
| `ALLOWED_GUILD_IDS` | 設定後，伺服器情境限制為這些伺服器；不會因此開放任意 DM |
| `ALLOWED_CHANNEL_IDS` | 設定後，伺服器情境再限制為這些頻道 |
| `ALLOW_PUBLIC_ACCESS` | 需明確為 `true` 才允許沒有使用者／伺服器白名單的使用範圍；已設定的限制仍有效 |
| `ENABLE_DMS` | 預設 `true`；DM 仍需使用者白名單或明示公開存取 |

白名單取交集，不是任一符合就通過。建議首次測試只填自己的使用者 ID。

```sh
npm run check:config
```

這個指令只載入／驗證設定，不登入任何服務。不要把 `npm start` 當成驗證設定的指令。

## Discord app 與明示啟動

擁有者應在 Discord Developer Portal 確認 Message Content Intent，依使用範圍安裝 app，使用 `bot` 與 `applications.commands` scopes。伺服器頻道需 View Channel、Send Messages、Read Message History；長回覆另需 Attach Files。這些是部署檢查事項，本次未修改 app 權限。

正常啟動**不會註冊指令**。只有擁有者批准使用選定 app 時才執行：

```sh
npm run register-commands -- --confirm-register
```

註冊需要 `DISCORD_BOT_CLIENT_ID`。設定 `DISCORD_COMMAND_GUILD_ID` 可限定測試伺服器；未設定則註冊全域 `/ai`。採單指令 upsert，不 bulk overwrite 其他指令。此指令會修改 Discord app，不能放進安裝／測試／日常啟動流程。

取得啟動授權並完成資料、模型與權限檢查後，才執行：

```sh
npm start
```

`npm run dev` 使用 Node 原生 watch，不依賴全域 nodemon；它也會真的啟動 bot，不是離線測試。

## 資源上限與錯誤

預設每人 5 次／分鐘、全域 60 次／分鐘、最多 4 個並行模型請求。使用者佇列最多 8 個、整體最多 100 個；同一使用者的 DM 與 `/ai` 共用序列化佇列。模型請求 30 秒逾時，**不自動重試**，避免不明狀態下重複計費。限額是單程序記憶體計數，重啟會歸零，固定分鐘邊界可能有突發量；不是每日／每月金額硬上限。

上下文最多 41 則、UTF-8 32 KiB（含每則保守 overhead），頻道最多追溯 40 層；保留 system 與最新提問，從較舊內容移除。這是 byte／message 預算，不是 tokenizer 精確 token 計算；不會為縮短模型輸入而刪除已儲存的 DM。輸出上限 2,048 tokens、256 KiB，單一 session 的 BSON 大小超過 8 MiB 時要求新建對話。

錯誤回覆只有固定分類與追蹤碼；應用程式不輸出上游原始錯誤、提示詞、headers 或 URI。模型費用是含 cached-input 拆分的版本化估算，不是帳單；未知模型費率為 `null`。`usageToken` 為最後一輪，新增 `usageTokensTotal` 只累計本版寫入的輪次，並非舊資料的完整歷史用量。

`/readyz` 僅綁定 `127.0.0.1:8080`，檢查 Discord ready 及有界 DB ping，不呼叫模型。容器不必對外開放此 port。SIGTERM／SIGINT 停止接收新工作、等待佇列並關閉連線；部署工具應給至少設定的關閉等待時間。readiness 通過不等於 bot 功能 smoke 通過。

## 資料與隱私限制

`user` 儲存使用者識別資料；`dmChannel` 儲存完整 DM 內容與用量；`temp` 儲存本版新增的頻道 bot 回覆全文、message/channel ID。Discord 訊息／附件也留在 Discord。提問與選入的歷史會傳至所選供應商（OpenAI 或 Google Gemini）；`store:false` 不是所有服務與備份零保留的保證。

**目前沒有本機資料 TTL、使用者自助刪除或匯出，也未實作完整同意流程。** `/ai` 的告知不是已完成隱私治理的證明。保留期限、通知／同意、備份刪除與存取權限須由擁有者先決定；在完成前，不應當成公開多使用者產品上線。不要輸入敏感資訊。

## 交付與授權

GitHub Actions 使用 GitHub-hosted runner 驗證，不使用此工作區的 self-hosted runner。Jenkinsfile 改成專用驗證 agent 與候選 image build，不含自動部署／刪除現役容器；該 agent 尚須擁有者配置，不能直接映射至正式 host。正式 rollback、保護規則與環境信任設定見 [runbook](docs/runbook.md)。

`package.json` 原有 MIT 宣告保留，但尚未加入經擁有者確認的 LICENSE。此變更不代替擁有者確認版權／授權；套件設為 private，避免意外 npm 發布。

其他文件：[安全](SECURITY.md)、[貢獻](CONTRIBUTING.md)、[變更記錄](CHANGELOG.md)。
