# 交付與恢復 runbook

本文件是擁有者批准後的操作檢查清單，不是已執行紀錄。不要以此文件代替部署批准。

## 候選版本準備

先確認實際 MongoDB server、驗證方式、collection schema 與既有索引的相容性。使用單獨核准的去識別備份／測試資料，不能直接指向正式 DB 來驗證新 driver。全程保留既有 persona，明示選定替代模型並驗證 Chat Completions 輸入、output token 參數、錯誤與費率。

在專用驗證 host 以鎖定工具鏈完成 clean install、verify、audit、SBOM，再 build 以完整 commit SHA 標記的候選 image，掃描 image OS 套件／內容。固定 digest 的更新須 review；不能用 branch 名或 latest 作為可回復版本的唯一定位。

本次環境沒有可用 Docker daemon，因此 image build、OS 掃描、候選容器／健康檢查實測皆尚未完成。checked-in Jenkinsfile 使用 `discord-bot-verify` label，live Jenkins 是否有這個專用 agent 未確認；它沒有部署 stage，這是刻意保留人工閘門，不是已完成自動回滾。

## 資料相容與失敗語義

`user`、`dmChannel` 名稱與原始 `mode` 值保留。舊 session 沒有 `version` 時，第一輪以 `$exists:false` 作 compare-and-set；新欄位只在獲准實際使用時寫入。沒有在啟動時執行 migration 或建立索引。

同一程序內 `/ai` reset 與 DM 序列化。reset 先新增再完成舊 session：新增失敗保留舊 session；若中途完成舊 session 失敗，可能留下多個 active，後續 DM 會回報 CONFLICT，而不是任意選擇並覆寫資料。不可宣稱 reset 跨文件原子化。重複 reset ID 有去重，但人工復原仍須檢查未完成的狀態。

上線前應以隔離資料驗證原子 append／版本衝突、同時兩問、reset 中途失敗、重送及原始舊 session。多 replica 或更強 exactly-once 保證需另行設計 unique active-session schema、交易／分散式互斥與索引 migration；本版禁止多 replica，亦不可與舊版並跑共寫。

DM 的持久化事件去重保留最近 1,000 個 ID；程序內事件去重約 10 分鐘。頻道事件去重未跨重啟持久化，不保證無限時間或跨程序 exactly-once。若模型已完成但儲存／Discord 送出失敗，仍可能產生費用；本版不自動重試，也不偽稱回滾已完成的外部呼叫。

## 需批准的真實 smoke

使用擁有者明示指定的測試 app、token、channel、獨立 DB 與成本額度。先測新的／重啟後的冷 DM、伺服器 `/ai` 和回覆串，再驗證長附件、缺權限、已刪引用、429／逾時降級和恢復。readiness 應驗證 ready／Gateway 斷線／DB 斷線／關閉狀態；健康探針不得呼叫付費模型。這些測試尚未在真實外部服務上執行。

## 正式切換與回復

擁有者確認產品受眾、隱私保留／delete/export、LICENSE、憑證輪替與資料備份後，才核准正式切換。保存舊 image 的不可變 digest、設定版本及經核對可還原的備份；不得先 `docker rm -f` 現役容器再嘗試新 image。

應在計畫的維護窗先停止舊程序接單並等候工作完成，再啟動唯一新程序。不能為「零停機」同時運行兩個會共寫同一資料庫的 bot。候選不健康時停止新版本並人工回復核准的舊 image／設定；若新舊 schema 或 API 不相容，先處理資料／模型相容性，不能盲目啟動舊程式。舊版的已知缺陷與將停用的模型也會重新出現，需列入回復風險。

正式切換、資料還原、憑證撤銷與歷史清理都需要獨立授權。本次未執行任何這類操作，也未演練 rollback；完成後才可在 issue 記錄實測證據。

## 遠端工作區的重跑方式

本次可攜 Node 放在 `.artifacts/node-v24.21.0-win-x64`，不屬於 Git 內容。Windows PowerShell 可暫時在目前 shell 使用它：

```powershell
Set-Location 'C:\source\github-runner-docker\Discord-Bot-ChatGPT'
$env:PATH = (Join-Path $PWD '.artifacts\node-v24.21.0-win-x64') + ';' + $env:PATH
npm.cmd run verify
```

一般 clone 請自行安裝 `.nvmrc` 指定版本；不需此工作目錄的可攜工具才能開發。
