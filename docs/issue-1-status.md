# Issue #1 處理狀態

- 更新日期：2026-10-08（台灣時間）。
- 來源：https://github.com/kkldream/Discord-Bot-ChatGPT/issues/1
- 原始稽核基線：`fec0daca6695afb2e8024f4e6b6a92f9eb99427b`。
- 本次隔離驗收基線：main `ac708c3ea82f4e57ac919926dca8cc2e0d845503`；本機分支 `test/issue-1-isolated-acceptance`。
- [PR #2](https://github.com/kkldream/Discord-Bot-ChatGPT/pull/2) 與 [PR #3](https://github.com/kkldream/Discord-Bot-ChatGPT/pull/3) 均已合併。該 main SHA 的 [Verify run 37183771369](https://github.com/kkldream/Discord-Bot-ChatGPT/actions/runs/37183771369) 已完成且成功；實際 job log 為 **150 tests／150 pass／0 fail**。
- 本次授權包含拋棄式 MongoDB／image 驗收、最小安全修正與限定範圍的 PR 交付／Issue 進度／Project 更新；需要擁有者決策時再提出。**不授權操作正式服務或 DB、註冊 Discord commands、呼叫付費模型、輪替／撤銷憑證，或代決隱私政策／LICENSE**。既有 PR 合併不等於 umbrella issue 結案。

## 程式層對照

| 工單項目 | 已有程式與本次補證 | 未覆蓋／限制 |
| --- | --- | --- |
| B01 | 顯示與持久化全文分離；本次實際 MongoDB 讀回保留換行與完整回合 | 既有被刪除／缺少全文的歷史回覆無法還原 |
| B02、S03 | SDK error class、安全分類、cause、追蹤碼、log 白名單；離線回歸 | 無真實上游故障演練 |
| B03 | `Partials.Channel`、不預熱 user cache、channel=null 的 DM 指令路徑 | 真實 Discord 冷快取端對端 smoke 待批准 |
| B04 | 單程序 queue、原子 push、CAS、去重與 ambiguous active 拒絕；**真實 MongoDB 8.0.17** 驗證 reset→append→dedup、兩個 snapshot 競寫、legacy 缺 version、重複 active 與 reply channel scoping | **跨程序 reset 原子化、唯一 active 索引／schema migration 尚未完成**；不是 transaction／多 replica 驗收 |
| B05 | 版本化價格、cached input 拆分、未知費率 null、非帳單標示 | 帳單與替代模型費率未實測 |
| B06 | 事件完整錯誤邊界；image fixture 執行 DM handler 與持久化 | 假 Discord／模型不等於真實權限、斷線與 supervisor 驗收 |
| B07 | Jenkins 候選 image 使用 commit SHA tag；本次實際 build production Dockerfile | 未執行 live Jenkins／發布／切換 |
| B08 | Node 原生 watch，無隱含 nodemon 依賴 | dev 會連線；本次未執行 |
| B09 | 長輸出完整 UTF-8 附件、大小／空輸出檢查 | 真實 Attach Files 權限與上傳 smoke 未執行 |
| O01–O03 | Node 24.21.0／npm 11.19.0／Bookworm、exact lockfile；實際 MongoDB 8.0.17 與 production image 模組載入通過；已有 [本機 image 掃描與 SBOM](image-security.md) | 僅驗證此 MongoDB standalone 版本；掃描仍有 high／critical 命中，尚未安全放行；模型替換待驗證 |
| S01 | 無帳密 URI 範例、secret tripwire | **舊憑證撤銷／輪替、有效性確認與 Git 歷史清理仍由擁有者處理** |
| S02 | 實際 image 為 UID 1000、production-only 依賴、explicit COPY；合成 canary 證明 context／image 排除備份；另有 [本機 image 掃描與 SBOM](image-security.md) | 修正 `.dockerignore` 目錄例外意外放行整個子樹；high／critical 命中尚待處置，可達性稽核／安全放行未完成 |
| S04 | 已記錄資料保存、/ai 不刪資料與 DM 告知 | **TTL、delete/export、同意流程、備份與保留政策未實作；須先決策** |
| S05、F04 | Audience fail-closed、bot/webhook 排除、mentions、rate／queue／context／output／timeout 限制 | 單程序限制，非金額硬預算／分散式帳本 |
| V01–V09 | 既有 audit／SBOM 與依賴升級；本次 actual image 已完成 [本機漏洞掃描與 CycloneDX SBOM](image-security.md) | 有 high／critical 命中，尚未安全放行；package／advisory 命中不等於實際 runtime 可達性／正式環境已修復 |
| F01 | main hosted Verify 已成功；本次 canonical 離線 150 tests 與另行執行的 11 個實際 DB／image tests 通過 | `isolated-acceptance` job 先跑 37 個 cleanup／process 安全回歸，再跑 Docker 整合；**實際 CI 結果以此次 PR current head checks 為準，本機證據不替代遠端 CI** |
| F02 | Jenkins 無自動正式切換；隔離 harness 無 image publish／deploy | **正式 rollout、rollback、備份還原與故障演練未執行** |
| F03 | 缺設定的真正預設 CMD exit 1／CONFIG；image 中的實際 HTTP readiness、healthcheck 子程序與 stop 通過 | Discord／模型均為明示 fake；DB 不可用測試是關閉真實 MongoClient，不是正式 server／Gateway 故障演練；真實 signal／supervisor 時序待驗收 |
| D01、D03 | onboarding、受眾／persona／限制文件；維持 persona | 不自行改產品定位 |
| D02 | SECURITY、CONTRIBUTING、CHANGELOG、private npm package | **LICENSE 條款與版權確認未完成；未發布 release** |
| G01 | read-only hosted CI、pin actions；新增有時限、無秘密與無發布的隔離驗收 job | **未修改或確認 live branch protection／required checks、Jenkins trust／secrets 邊界** |

## 本次真實隔離驗證

平台為 Linux Docker Engine 29.1.3。主機 Node 不符合 repo 要求，因此只在固定 digest 的 Node image 使用 **Node 24.21.0／npm 11.19.0**；未改全域 runtime。canonical secret checker 需要 Git，另建拋棄式工具鏈 image 安裝 Git，沒有更改 production Dockerfile。

證據目錄（本機暫存、不提交 Git）：
`/root/.hermes/cache/scratch/issue-formalization.nVqlzc/bot-evidence/`

| 檢查 | 實際結果 | 證據檔 |
| --- | --- | --- |
| 基線 clean install | `npm ci --ignore-scripts --no-audit` 成功；114 packages | `baseline-install.log` |
| 基線 canonical verify | lint、secret tripwire 與 **150／150 pass**；Docker network=none，保留 `test/no-network.cjs` | `baseline-verify.log` |
| main hosted CI | job log 實際 **150／150 pass**；run conclusion=success | `main-ci.log` |
| 原始 Docker context 回歸 RED | **5 tests，3 pass／2 fail**；`lib/context-canary.backup` 出現在 daemon COPY 可見 context 與實際 image，不是 build／DB 故障 | `image-context-red.log` |
| 修正後 DB＋image GREEN | **11 tests／11 pass／0 fail／skip／cancel**；6 個 MongoDB store tests＋5 個 context／image tests | `integration-green.log` |
| scratch-only CAS mutation RED | 只在 repo 外副本移除 append 的 version predicate；**6 tests，4 pass／2 fail**；兩 writer 都成功（2≠1）且 legacy stale snapshot 未拒絕 | `cas-mutation-red.log` |
| scratch 副本還原 GREEN | 還原相同 CAS predicate 後 **6／6 pass**；正式 worktree 的 `lib/store.js` 始終未更動 | `cas-restored-green.log` |
| 補件 canonical verify | **150／150 pass**、lint／secret tripwire 通過；整合測試沒有混入預設離線入口 | `followup-verify.log` |
| Workflow YAML | parser、read-only 權限、hosted runner、依賴、時限與 cleanup-before-Docker 順序檢查通過；本機檢查不替代 PR current head checks | `workflow-validation.log`、`timeout-fix/workflow-validation.log` |
| cleanup 語義 RED | 原 cleanup 實際 helper：32 cases／26 fail；inspect 錯誤／timeout、scratch 刪除失敗仍 exit 0 並印出已清理 | `cleanup-fix/regression-red.log`、`cleanup-fix/red/*.json`、`cleanup-fix/cleanup-before.sh` |
| cleanup 修正 GREEN | 同一 helper 入口 **32／32 pass**；三類資源查詢／移除／讀回錯誤、scratch、確定不存在、原始失敗與三種 signal | `cleanup-fix/regression-green.log`、`cleanup-fix/green/*.json` |
| cleanup 修正後完整隔離重跑 | **11／11 pass**、exit 0；daemon 清單與 scratch 父目錄獨立讀回確認本次資源不存在 | `cleanup-fix/integration-green.log`、`cleanup-fix/cleanup-readback.json` |
| cleanup 修正後 canonical verify | lint、secret tripwire、**150／150 pass**；network=none，工具鏈不變 | `cleanup-fix/offline-verify.log` |
| TERM-only timeout 回歸 RED | 3 個真實 process cases 均超過外層 3 秒；維持原有 production soft 值，僅加 source 後可調小的測試 seam；外層安全回收 fixture，不視為通過 | `timeout-fix/regression-red.log`、`timeout-fix/red/*.json`、`timeout-fix/cleanup-term-only-small-test-seam.sh` |
| KILL escalation GREEN | **37／37 pass**（原有 32＋3 個真實 process＋2 個契約）；CLI／descendant 的退出原因為 SIGKILL、無 PID 殘留，原始 exit 73／TERM 143 保存 | `timeout-fix/regression-green.log`、`timeout-fix/green/*.json` |
| timeout 修正後完整隔離重跑 | **11／11 pass**、exit 0；本次完整 7 個資源名稱與 scratch 均獨立讀回確認不存在 | `timeout-fix/integration-green.log`、`timeout-fix/cleanup-readback.json` |
| timeout 修正後 canonical verify | lint、secret tripwire、**150／150 pass**；network=none，固定工具鏈不變 | `timeout-fix/offline-verify.log` |

整合入口為 `bash scripts/test-integration.sh` 或在支援工具鏈的 host 執行 `npm run test:integration`；細節見 [runbook](runbook.md)。MongoDB 固定為 `8.0.17@sha256:9814652e33f0cf8b9fddea8b46dfc9d8e19b130dcfdd7b510ca58bb0d40c8b71`。每次建立新的 `--internal` network、tmpfs 測試 DB 與唯一 `hermes-issue1-` 前綴資源；沒有 host port、Docker socket、正式 URL／憑證。成功與語義失敗均實際觸發 cleanup；base images／build cache 不做全域 prune。

隔離 harness 另修正 cleanup 假成功：實際共用 helper 只比對本次完整名稱，檢查每次移除並再次讀回 Docker／scratch 狀態。任何查詢不確定或移除錯誤都失敗且不印出已清理；不覆蓋既有失敗或 HUP／INT／TERM exit code。原有 32 個語義 cases 使用明示 fake CLI；新增 3 個真實 GNU timeout cases，忽略 TERM 的 CLI／descendant 均被 KILL 並回收、無殘留，另 2 個 cases 驗證正值預設與一致 KILL grace，共 37 cases。production 保留原有 soft timeout 並加入固定 5 秒 KILL grace；僅 source 後的測試 shell 調小至 0.3＋0.2 秒，不接受 production 環境覆寫。這仍不是真實 daemon 故障演練。

唯一產品相關修正是 `.dockerignore`：`!lib/` 與 `!scripts/` 原本連子樹的非白名單檔案也會放行，現在先重新排除子樹，再開放必要 JS／provider／healthcheck。合成 canary 無秘密且只出現在 scratch context，沒有把真實憑證放進 image。未修改 store、provider、persona 或正式資料規則。

## 歷史證據與模型期限

2026-10-04 的原始 PR #2 Windows 驗證是 **102 個離線 tests**，以及舊基線 6 個預期失敗回歸、audit／coverage／SBOM 記錄；這些是當時實測，不是本次 Linux 重跑，也不是目前 150 tests 的結果。當時「沒有 Docker daemon」與「未 push／未建立 PR」只描述原始本機交付，**不能再用來描述已合併 main 或本次可用 Docker 的環境**。

2026-10-04 查核的 OpenAI deprecations 頁列出 `gpt-4.1-nano` 與 snapshot 在 **2026-10-23** 停用，來源：https://developers.openai.com/api/docs/deprecations 。這是已有歷史查核，非本次重新查證。PR #3 已加入選擇式 Gemini provider，但沒有決定替代模型、正式費率／額度或真實 smoke；不因 SDK／Gemini 程式已合併就消除模型替換閘門。

## 結案與正式操作閘門

**不能把整張 umbrella issue 結案。** 仍待擁有者決策／批准：產品受眾與 persona、TTL／delete/export／同意與隱私生命週期、LICENSE、憑證輪替與歷史清理、跨程序 reset／唯一索引與 migration、替代模型與成本、測試 Discord app／token／channel、真實 DB 驗證與模型 smoke、正式部署目標／切換／rollback／備份還原，以及 branch protection／Jenkins trust boundary。

本次補的是可重跑的隔離證據與本機 image 掃描／SBOM，不是正式 readiness、帳單、authenticated Discord smoke、多程序保證、安全放行或 deployment approval。仍需獨立 reviewer 與父代理自行重跑；PR 交付與實際 CI 以此次 current head checks 為準，不能以本機 GREEN 或掃描成功退出替代。
