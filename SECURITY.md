# 安全處理

請勿在公開 issue、PR、log 或截圖貼出 token、MongoDB 帳密 URI、私訊、可識別資料或正式備份。

發現漏洞時，先與 repo 擁有者確認私密回報管道；若 repo 已啟用 GitHub private vulnerability reporting，可使用該功能。本次沒有確認或啟用該設定，不能把一般公開 issue 當成私密通道。回報應提供去敏的版本、受影響功能、前提及重現步驟，不測試未授權的正式系統。

原 README 曾包含帳密型 MongoDB URI，本版改為無帳密範例。**從文件移除不會使舊憑證失效，也不會清除 Git 歷史。**擁有者需確認是否曾為真實憑證；若是，另行核准撤銷／輪替，檢查使用紀錄，再評估歷史清理與協作者重新 clone。本次沒有登入該 URI、測試有效性、輪替或改寫歷史。

## 運作界線

本版以單一 bot 程序為前提。不要在舊版仍運作、或多個 replica 共寫資料時直接切換；reset 尚非跨程序交易。需要 unique active-session schema、索引、migration、備份和獨立整合測試，才能宣稱多實例安全。

應用程式日誌採安全欄位白名單，錯誤 cause 保留在程序內但不直接輸出。不得為了除錯重新啟用 SDK 的敏感 HTTP logging。憑證應由部署平台安全注入，不放 build args 或 image；Docker build context 採 allowlist。

## 驗證與更新

使用鎖定 Node/npm 執行 `npm ci --ignore-scripts --no-audit`、`npm run verify`、`npm audit --audit-level=high`、`npm run sbom`。每次升級應重新檢查 SDK 契約及相容表。依賴公告掃描、SBOM、OS image 掃描、行為可達性檢查是不同證據，不能互相取代。

Docker base image 已固定 digest；固定 digest 不會自動收到安全更新，更新 tag/digest 時需重新驗證。模型的停用公告亦須獨立檢查；`gpt-4.1-nano` 的公告停用日期為 2026-10-23，來源見 README。
