# 貢獻與驗證

使用 `.nvmrc`／`packageManager` 指定的版本；只維護 `package-lock.json`，不要重建 Yarn lockfile。新增依賴前說明必要性及安全影響；預設禁止 install lifecycle scripts。

```sh
npm ci --ignore-scripts --no-audit
npm run verify
npm run test:coverage
npm audit --audit-level=high
npm run sbom
```

測試必須能在沒有 `.env`、Discord token、模型 key 或正式 DB 的情況下執行。新事件處理路徑需包含上游失敗與回覆失敗測試；用 dependency injection，不要關閉 `test/no-network.cjs`。普通 import 不得註冊指令、載入正式環境檔、登入 bot 或連 DB。

B01/B02/B04/B09 的原始缺陷可用 `npm run test:baseline` 檢查；這個命令刻意讀原始基線，因此預期失敗，不可併入一般 verify。

PR 應標明 issue ID、行為變更、回歸案例、實際跑過與未跑過的檢查，以及相容／資料遷移影響。不把 static／mock tests 稱為端對端驗收。不在 PR 內容重貼被移除的憑證。

CI 只在無正式秘密、非正式 host 的環境執行。main protection、required checks、Jenkins trust boundary 與部署 approvals 由擁有者另外設定；修改 YAML 不等於已啟用保護。發布前 review 所有必要檢查、依賴／模型狀態、LICENSE 與 rollout/runbook；不得只因 CI 綠燈就合併並部署。
