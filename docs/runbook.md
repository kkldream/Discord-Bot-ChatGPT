# 交付與恢復 runbook

正式操作部分是擁有者批准後的檢查清單，不是已執行紀錄；隔離實測部分另有明確證據與邊界。不要以此文件代替部署批准。

## 本機隔離 MongoDB／image 驗收

基線 main `ac708c3ea82f4e57ac919926dca8cc2e0d845503` 已包含合併的 PR #2／#3，該 SHA 的 hosted Verify 成功、150 個離線 tests 通過。本次新增獨立整合入口，不關閉或替換 `test/no-network.cjs`。

前置需求：Linux 的 Bash、Docker daemon、GNU `timeout`／一般 coreutils，且可下載固定公開 image／npm 套件。整合入口**不需要 host Node 或 host node_modules**；image 內依 production Dockerfile 使用固定 Node 24.21.0／npm 11.19.0。canonical 指令則必須使用 `.nvmrc`／`packageManager` 的工具鏈，且 secret checker 需要 Git：

```sh
npm ci --ignore-scripts --no-audit
npm run verify
bash scripts/test-integration.sh
# 支援工具鏈的 host 也可用：
npm run test:integration
# 分別只跑 6 個 store tests 或 5 個 context／image tests：
bash scripts/test-integration.sh store
bash scripts/test-integration.sh image
```

`all` 是完整驗收；`store`／`image` 是聚焦子集，不能把子集 GREEN 當成全部通過。每個模式均 build 真正 production Dockerfile，使用相同安全隔離、cleanup 與缺設定 CMD 檢查。

### 安全／可重跑契約

- 不讀 `.env`，不接受 DB URI／憑證覆寫；fixture URI 固定為新的隔離 network 內 `mongodb://mongo:27017`，DB 僅 `hermes_issue1_store`／`hermes_issue1_image`。新 network 每次唯一，資料不是正式 DB，也不做啟動 migration／索引建立。
- 只把 production build 白名單複製到 scratch context；另外放入**無秘密的合成 canary**，檢查 `.env` 與 `lib`／provider／scripts 備份均未進入 daemon COPY 可見 context／production image。context probe 為 `FROM scratch`、只 create／copy、不啟動。
- 真正 build 使用固定 Node digest；MongoDB 固定為 `mongo:8.0.17@sha256:9814652e33f0cf8b9fddea8b46dfc9d8e19b130dcfdd7b510ca58bb0d40c8b71`。只有公開 image／npm 下載需要外部網路；正式 CMD 缺設定 probe 是 `network=none`，DB／fixture runner 僅連新建 `--internal` network。
- 無 host port publication、無 Docker socket mount、無既有 service／container／network 編輯。應用 fixture 只掛載測試檔與 context 證據唯讀目錄；root filesystem 唯讀、cap-drop、no-new-privileges。
- MongoDB 使用 tmpfs（DB 512 MiB、config 16 MiB、tmp 32 MiB）、memory 1 GiB／CPU 1；fixture runner memory 512 MiB／CPU 1。下載、build、就緒與 test 各保留原有 soft timeout；test 180 秒，production build 600 秒。所有 Docker CLI、cleanup 查詢／移除與 scratch 刪除均在 TERM 後最多 5 秒升級 KILL（同 process group 的子程序亦包含），不再以 TERM-only 當作硬時限。無背景無限 polling。這是 Linux Docker 驗收，不宣稱 Windows／rootless／所有架構通過。
- 所有明示資源以唯一 `hermes-issue1-` 前綴命名。EXIT／INT／TERM／HUP cleanup 移除本次容器、network、兩個 image tags 與 scratch context；**不 prune 其他 image／base image／build cache**。cleanup 使用成功的 Docker 清單精確比對本次名稱，移除後再次查詢；查詢失敗／timeout 不等於不存在。每個移除命令（含 scratch）均檢查結果，並確認 context 已消失。任何不確定／失敗都不能印出已清理：原本成功改為 exit 1，原本失敗／signal 狀態不覆寫。SIGKILL／host crash 無法由 shell trap 保證。
- `test/integration` 與 runtime fake 都是另行明示的 fixtures，**沒有放進 production image**。Discord login／model 呼叫均由假物件提供；真實 Mongo driver、server、runtime handlers、HTTP readiness 與 image dependencies 才是此項實測範圍。

### cleanup 離線回歸

```sh
# 另行需要 Python 3 標準函式庫；不是整合 harness 的 runtime 依賴。
python3 test/integration/cleanup.test.py
```

此入口直接 source harness 同用的 `scripts/integration-cleanup.sh`，沒有擷取／eval shell 原始碼。明示 fake Docker／rm CLI 只操作獨立 JSON 與 `TMPDIR`（未設定時為 `$HOME/.cache`）下的 scratch fixture，**不使用 Docker daemon，也不代表真實 daemon 故障演練**。原有 32 個語義 cases 使用 fake timeout 確定性注入 exit 124，每個 shell 子程序有 10 秒外層時限，不靠 sleep 注入故障。另有 3 個真實 GNU timeout cases，對查詢、Docker 移除與 scratch 刪除各建立明確忽略 TERM 的 CLI＋descendant；source 實際 helper 後只在該測試 shell 將 soft timeout 調為 0.3 秒、KILL grace 調為 0.2 秒，要求 3 秒內完成且不能由外層 watchdog 代為成功。測試以 Linux subreaper 回收並驗證兩個 process 均因 KILL 結束、PID 不存在；RED 失敗亦只終止並回收本次 process groups。production 預設固定為查詢 10 秒、每次移除與 scratch 刪除 30 秒、KILL grace 5 秒，忽略環境覆寫；沒有 global timeout alias。

目前共 **37 個 cases**：原有 32 個 cases 涵蓋三類 Docker 資源查詢錯誤／timeout、清理後讀回錯誤、移除失敗（包含資源已消失但命令仍報錯）、假成功卻殘留、scratch 刪除失敗／假成功、確定不存在、原始 exit 73 與 HUP／INT／TERM 狀態保存。每個 fixture 均保留無關與近似名稱 canary，禁止越界清理，且 fixture 不認得的命令即使被 cleanup 吞掉也會使測試失敗。新增 3 個真實 process cases 驗證 KILL／無殘留、原始 exit 73 與 TERM exit 143 保存；另 2 個契約 cases 檢查 production 正值預設不受環境覆寫，以及每個 harness Docker CLI 的一致 KILL grace。

### 已實測的行為與回歸

完整入口：**11／11 pass**，其中 MongoDB store 6 個 cases 覆蓋 reset→append→dedup、序列 reset 保留歷史／隔離使用者、兩 snapshot 的 CAS、legacy 缺 version、重複 active fail-closed、reply／seed channel scoping。

context／image 5 個 cases 驗證 canary 排除、實際 UID 1000／Node／npm／production-only 依賴／COPY 內容、真正 entrypoint 缺設定 exit 1／CONFIG、兩個 provider 的載入、假 Discord／模型＋真實 MongoDB 的 DM 回合與健康檢查。readiness 實際 HTTP 200，假 Gateway 未就緒為 503，關閉真實 MongoClient 為 503；healthcheck 子程序成功／失敗與 `stop()` 關閉 server 也通過。**不是 MongoDB server 斷線、真實 Gateway、SIGTERM／supervisor 或正式 bot smoke。**

三項語義 RED／GREEN 證據：

1. 原始 `.dockerignore` 的 `!lib/`／`!scripts/` 意外開放整個子樹。合成備份 canary 出現在 daemon COPY 可見 context 與 image，5 tests 內 2 個 assertion 失敗；最小修正只重新排除子樹再開放必要 JS／provider／healthcheck，完整入口 GREEN。
2. repo 外 scratch 副本只移除 `lib/store.js` 的 `version: session.version ?? { $exists: false }` filter，store 6 tests 內 2 個失敗：兩 writer 都成功（應只有 1 個），legacy stale snapshot 不再 CONFLICT。還原 filter 後 6／6 pass。主 worktree store 從未被 sabotage。這證明測試會咬到 CAS 語義，不是網路／Mongo 啟動故障。

3. 原 cleanup 原封移到實際 helper 後，32 個 cleanup cases **26 個失敗**：查詢錯誤／timeout 與 scratch 刪除失敗仍 exit 0 並印出已清理。成功的資源移除也缺少 authoritative read-back。修正後同一測試 **32／32 pass**；重跑真正完整隔離 harness **11／11 pass**，再從 daemon 清單與 scratch 父目錄獨立讀回確認本次資源均不存在，canonical verify 仍 **150／150 pass**。證據與逐 case JSON 位於 `bot-evidence/cleanup-fix/`；可用 `CLEANUP_TEST_HELPER` 指向保存的 `cleanup-before.sh` 並只跑 `python3 test/integration/cleanup.test.py CleanupTests` 重現原有 32 個 cases 的 RED，預設永遠測試目前真正 helper。

   TERM-only timeout 的後續語義 RED：保留原有 production soft 值、僅加入可在 source 後調小的測試 seam，3 個真實 process cases 全部因超過外層 3 秒而失敗，並安全回收 fixture；新增一致 KILL escalation 後 **37／37 pass**，3 個 process cases 不需外層介入且 CLI／descendant 均因 SIGKILL 終止、無 PID 殘留。證據與 before helper 位於 `bot-evidence/timeout-fix/`；`cleanup-term-only-small-test-seam.sh` 是維持 TERM-only 行為的測試副本，非原始 helper 的逐位元副本。修正後完整 Docker harness 仍 **11／11 pass**，獨立 Docker／scratch 讀回確認本次資源不存在；canonical verify 的 lint、secret tripwire 與 **150／150 pass** 亦通過。

本機證據放在 `/root/.hermes/cache/scratch/issue-formalization.nVqlzc/bot-evidence/`；檔名與結果見 [Issue #1 狀態](issue-1-status.md)。歷史 Windows 可攜工具鏈與「沒有 Docker」紀錄只屬原始 PR #2，不能套用於本次 Linux 隔離環境。

### CI 契約

checked-in Verify 的 `isolated-acceptance` job 使用 GitHub-hosted `ubuntu-24.04`、25 分鐘、依賴原本 verify、contents:read、pinned checkout、不保留 credentials；先執行 `python3 test/integration/cleanup.test.py` 的 37 個安全回歸，再執行相同 Docker shell harness，無 secrets、image publish 或部署。**實際 CI 結果以此次 PR current head checks 為準；本機證據與 YAML parser／安全設定檢查不替代遠端 CI。** main protection／required checks 仍由擁有者設定，不因新增 YAML 自動生效。

## 正式候選版本準備（仍需批准）

確認實際 MongoDB server、驗證方式、collection schema／既有索引相容性；使用另行核准的去識別備份／測試資料，不直接指向正式 DB 驗證 driver。standalone 8.0.17 的 fixture 不證明正式 authentication、TLS、replica set、交易、索引與資料分布相容。保持 persona，明示選定替代模型，驗證輸入／output token／錯誤／費率與成本額度。

在專用驗證 host 以固定工具鏈完成 clean install、verify、audit、SBOM，再 build 完整 commit SHA 候選 image、掃描 OS 套件與內容。固定 digest 更新需 review；branch／latest 不是可回復版本的唯一定位。本次有實際 production build 與非 root／內容驗證，**已有 [本機 image 掃描與 SBOM](image-security.md)，含 high／critical 命中，尚未安全放行（security cleared）、發布正式 image、正式容器 smoke 或切換**。

checked-in Jenkinsfile 使用 `discord-bot-verify` label，live Jenkins 是否配置專用 agent／安全 trigger 未確認；沒有部署 stage 是刻意保留人工閘門，不是自動 rollback 已完成。

## 資料相容與失敗語義

`user`／`dmChannel` 名稱與原始 mode 保留。舊 session 沒有 version 時首輪以 `$exists:false` CAS，實際 MongoDB fixture 已驗證首輪 version=1 與 stale writer 拒絕；沒有在 runtime 啟動 migration 或建立索引。

同一程序內 `/ai` reset 與 DM 序列化。reset 先新增再完成舊 session：新增失敗保留舊 session；完成舊 session 失敗可能留下多個 active，後續 getActive 回報 CONFLICT，不任意覆寫／刪除資料。**不可宣稱跨文件原子化。** 同 reset ID 回傳先前 document，即使它已 finish 也不復活；人工復原仍須檢查未完成狀態。

多 replica／更強 exactly-once 需另設計唯一 active schema、transaction／分散式互斥、既有重複資料調和與索引 migration，仍待批准。本版禁止多 replica，也不可與舊版共寫。實際 CAS fixture 使用兩個獨立 snapshot，不是兩個正式程序或 reset migration 的驗收。

DM 持久化去重保留最近 1,000 個 ID；程序內事件去重約 10 分鐘。頻道事件未跨重啟持久化，無無限時間／跨程序 exactly-once 保證。若模型完成但 DB／Discord 失敗仍可能產生費用；本版不自動重試，也不偽稱已回滾外部呼叫。

## 需批准的真實 smoke

使用擁有者明示指定的測試 app、token、channel、獨立 DB 與成本額度。測新的／重啟後冷 DM、伺服器 `/ai`／回覆串、長附件、缺權限、已刪引用、429／逾時降級和恢復。正式 runtime readiness 要驗證 Gateway／DB 斷線與 shutdown；健康探針不得呼叫付費模型。這些**尚未在 authenticated Discord／正式 DB／真實模型上執行**。

## 正式切換與回復

擁有者確認產品受眾、隱私 TTL／delete/export／同意／保留政策、LICENSE、憑證輪替與資料備份後才核准切換。保存舊 image immutable digest、設定版本與可還原備份；不得先 `docker rm -f` 現役容器再嘗試新 image。

維護窗先停止舊程序接單並 drain，再啟動唯一新程序。不能為零停機並跑兩個共寫 bot。候選不健康時停止新版本、人工回復核准 image／設定；schema／API 不相容時先處理資料／模型相容，不盲目啟動舊程式。舊缺陷與將停用模型也會重新出現，須列回復風險。

正式切換、資料還原、憑證撤銷／輪替、歷史清理、隱私／LICENSE 決策、索引 migration、branch protection 與 Jenkins 安全設定需要獨立授權。本次沒有執行，沒有演練正式 rollback，也不把 Issue #1 標為結案。
