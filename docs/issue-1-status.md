# Issue #1 處理狀態

- 日期：2026-10-04（Asia/Taipei）。
- 來源：https://github.com/kkldream/Discord-Bot-ChatGPT/issues/1
- 基線：`fec0daca6695afb2e8024f4e6b6a92f9eb99427b`。
- 工作分支：`fix/issue-1-formalization`。
- 本次對話授權在指定 workspace 處理工單，因此實作程式與離線驗證；不把這視為正式 DB、憑證、Discord app、部署或授權條款的全面批准。

## 程式層對照

| 工單項目 | 本次內容 | 未覆蓋／限制 |
| --- | --- | --- |
| B01 | 不再切除回覆正文；顯示與持久化上下文分離；三種換行 fixtures | 既有被刪除／缺少全文的歷史回覆無法憑空還原 |
| B02、S03 | SDK error class 契約、安全分類、cause、追蹤碼、log 欄位白名單 | 無真實服務故障演練 |
| B03 | `Partials.Channel`、移除全部使用者預熱、channel=null 的 DM 指令路徑 | 真實 Discord 冷快取端對端 smoke 待批准 |
| B04 | 單程序 user queue、原子 push、版本 compare-and-set、reset／event 去重、重複 active 拒絕 | **未完成跨程序 reset 原子化、唯一 active 索引／schema migration、真實 DB 整合** |
| B05 | nano 版本化價格、cached input 拆分、未知費率 null、非帳單標示 | 實際帳單與替代模型費率不在本次驗證內 |
| B06 | 事件入口涵蓋 fetch／reply／模型／DB／edit 與二次失敗 | 真實權限、斷線與 supervisor 行為待 smoke |
| B07 | Jenkins 候選 image 改為 commit SHA tag | Live Jenkins／Docker build 未執行 |
| B08 | Node 原生 watch，無隱含 nodemon 依賴 | dev 會連線啟動；本次未執行 |
| B09 | >2000 字元使用完整 UTF-8 附件；輸出大小／空輸出檢查 | 真實 Attach Files 權限與上傳 smoke 未執行 |
| O01–O03 | Node24／Bookworm、SDK 契約升級、移除 Moment、exact npm lockfile | 實際 Mongo server 相容、OS image 掃描與模型替換仍待驗證 |
| S01 | README／env 改為無帳密 URI 範例 | **舊憑證是否有效、撤銷／輪替、Git 歷史清理仍由擁有者處理** |
| S02 | Docker allowlist context、explicit COPY、非 root | Image 內容實測未完成 |
| S04 | 清楚記錄既有／新增資料保存、/ai 不刪資料、DM 告知 | **TTL、delete/export、同意流程、備份與保留政策未實作；須先決策** |
| S05、F04 | Audience fail-closed、bot/webhook 排除、allowedMentions、rate／並發／queue／context／output／timeout 限制 | 單程序計數、非金額硬預算；不是分散式帳本或完整反濫用機制 |
| V01–V09 | 重建依賴樹、移除過時路徑、npm audit 與 CycloneDX SBOM | 公告命中結果不等於 OS／實際部署／完整安全或可達性驗證 |
| F01 | 離線回歸、mock DB／Discord、真實 SDK 假 transport、lint 與 hosted CI | GitHub-hosted CI 尚未因本分支執行；外部整合未完成 |
| F02 | 移除 checked-in 自動破壞式 deploy；只產候選 image | **人工切換、rollback 與故障演練仍未執行** |
| F03 | 無副作用 import、明示 command upsert、env/dbName 驗證、readiness、shutdown | 真實 app／DB／程序停止時序待整合驗收 |
| D01、D03 | 重寫 onboarding、受眾／persona／限制文件，移除無依據快／便宜宣稱 | 保留 persona；沒有自行把娛樂 bot 改成一般助理 |
| D02 | SECURITY、CONTRIBUTING、CHANGELOG，private npm package | **LICENSE 條款與版權確認未完成；未發布 release** |
| G01 | Hosted PR 驗證、read-only CI 權限、pin actions、專用 Jenkins agent 契約 | **未修改或確認 live branch protection／rules、Jenkins trigger／secrets 邊界** |

## 已執行的驗證

固定舊 commit 的六個回歸案例預期失敗，證明 fixtures 能抓到 B01/B02/B04/B09，而非只有語法檢查。修正版本已通過正常離線測試；最終次數與 clean-install／audit／coverage 證據記錄於下方驗證區塊。

所有測試使用 fake credentials 且封鎖真實網路；SDK 採 injected fetch，DB／Discord／health server 採 mock。未讀 `.env` 或正式資料，不啟動正式 bot、不註冊 commands、不呼叫付費模型。

本機 Docker daemon 不可用；只有讀取公開 image manifest／digest，**沒有** build/run 容器、掃描 OS image 或聲稱 readiness／bot smoke 已在外部服務通過。也沒有停止或啟動 Docker Desktop／既有服務。

## 新查到的模型期限

OpenAI 官方 deprecations 頁在 2026-10-04 的查核結果，列出 `gpt-4.1-nano` 及 snapshot 於 **2026-10-23** 停用。此期限需獨立於 SDK 升級處理。來源：https://developers.openai.com/api/docs/deprecations 。本次保留預設以避免悄悄改變成本／行為，提供 `OPENAI_MODEL`；替代模型、契約、費率與真實 smoke 是上線前閘門。

## 結案條件

本次**不能把整張 umbrella issue 結案**。剩餘需擁有者決定／批准：產品受眾與 persona、隱私生命週期、LICENSE、疑似外洩憑證處理、資料遷移／唯一性方案、部署目標、模型替換、測試 app／DB／成本與正式切換。完成隔離整合、image 驗證、真實 smoke、回復演練與存取保護後，再逐項補證據；不能用本次 0 audit 命中或 mock tests 取代。

分支目前準備供 review；沒有直接改 main、建立 release 或觸發正式部署。

## 最終本機驗證紀錄

驗證平台：Windows，工作目錄內可攜 Node **24.21.0**／npm **11.19.0**；官方 Node zip 已比對官方 SHA256 清單，未變更電腦的全域 Node 設定。

| 檢查 | 本次結果 | 本機證據（不提交 Git） |
| --- | --- | --- |
| 舊版缺陷重現 | 6 tests，0 pass／6 fail，符合預期 | `.artifacts/baseline-red.txt` |
| Clean install | `npm ci --ignore-scripts --no-audit` 成功，lockfile SHA256 未變 | `.artifacts/clean-install.txt` |
| Lint + 正常離線測試 | 102 tests／102 pass，0 fail／skip／cancel | `.artifacts/verify-final.txt` |
| Coverage | 再跑 102 tests 全過；受測載入模組行覆蓋 93.91%、分支 88.57%、函式 84.00% | `.artifacts/coverage.txt` |
| npm 全依賴公告掃描 | info／low／moderate／high／critical 全為 0 | `.artifacts/audit.json` |
| npm production 公告掃描 | `npm audit --omit=dev --audit-level=high`：0 vulnerabilities | 同次命令輸出 |
| CycloneDX SBOM | JSON 解析成功，113 components | `.artifacts/sbom.cdx.json` |
| Jenkins shell | 2 段 multiline shell 的 `bash -n` 通過，非 Groovy／Jenkins 驗收 | `.artifacts/final-review.txt` |
| Workflow YAML | parser、read-only permissions、hosted runner、trigger、action SHA 檢查通過 | `.artifacts/final-review.txt` |
| 設定 CLI | 真實 CLI + 假環境值 + 封鎖網路通過，未連外 | `.artifacts/final-review.txt` |
| Working-tree 去敏與 UTF-8 | 43 個文字檔，指定憑證型態／replacement-character 掃描無命中；不是完整 secret scanner | `.artifacts/final-review.txt` |
| 範圍隔離 | persona 不變；外層 runner repo 的 tracked files／index 不變 | `.artifacts/final-review.txt` |

Coverage 不是全專案所有檔案／所有入口的驗收，特別是命令註冊 CLI、真實啟動、健康探針程序與外部整合仍有刻意未執行的路徑。資料庫測試是 mock contract，不能代替 MongoDB 的實際交易、索引與寫入語義驗證。

本次交付為本機 commit 與分支，**未 push、未建立 PR、未修改 GitHub issue 狀態**，避免觸發尚未確認的遠端 Jenkins／部署流程。外層 runner repo 會看見新增的 bot clone 目錄，但原有追蹤檔案沒有變更。
