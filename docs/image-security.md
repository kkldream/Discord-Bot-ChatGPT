# 本機映像安全掃描與剩餘閘門

日期：2026-10-08（台灣時間）。此文件記錄本機 actual image 的 Trivy 0.75.0 掃描及 CycloneDX SBOM；**不是 registry release、完整可達性稽核、正式環境已修復或安全放行**。

## 掃描來源與快照

- Build source：main `ac708c3ea82f4e57ac919926dca8cc2e0d845503` 加本次本機隔離驗收變更；未替換 production runtime／store／provider。掃描對象以下列精確 image ID 為準，不冒充最終 PR SHA 的 release。
- Scanner：Trivy **0.75.0**；同一次漏洞 DB schema **2**，`UpdatedAt=2026-10-07T07:38:55.515026687Z`、`DownloadedAt=2026-10-08T14:45:04.998567642Z`（原始 UTC metadata）。
- 此次 DB 檔 SHA-256：`5f4b978a55284b1997dc31e9f2fc3f4f1abae80829f51451ade221d5675a69b9`。所有比較使用相同 cache 並帶 `--skip-db-update`，結果只適用此快照，不能當作後續最新漏洞狀態。

## 精確對象與結果

- Dockerfile 基底：`node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`。
- 實際 production build 的本機 image ID：`sha256:075d6d29f3355f0075bd13e9b6a1a83ced51a48662650d9c43645ae5fc456c15`。這是本機 image ID，**不是已發布的 registry manifest digest**。
- OS 與 language package 掃描紀錄：CRITICAL **4**、HIGH **61**、MEDIUM **113**、LOW **78**、UNKNOWN **2**。
- 分類：Debian 12.15 為 4 critical／53 high；Node package 類為 8 high。
- high／critical 紀錄涵蓋 **27 個不同 CVE ID**；**15 筆**有 scanner 提供的修補版本。這些數字是 package/advisory 命中，可能同一 CVE 重複命中多個 binary package；不能當作 65 個可被此 bot 遠端利用的漏洞。
- CycloneDX SBOM 已在本機生成並解析，**275 components**；未發布到 registry。

已生成 `bot-vulnerabilities.json`、`bot-sbom.cdx.json` 與彙總證據，保留於此次 checkout 旁的 `../parent-evidence/`（本機 scratch；與 `../bot-evidence/` 的整合測試證據分開），不提交原始報告。scratch 可能被清理，可依下方命令對精確候選重跑；不把 scanner 的成功退出碼或 SBOM 生成等同於零漏洞。

## 已核對、尚未採用的基底候選

同一 Node tag 的目前官方 digest 為 `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`，實際 Node 24.21.0／npm 11.19.0。只掃描該 base candidate 得到 4 critical／60 high，**更新 tag digest 不能消除已知安全閘門**；本次沒有悄悄替換 production Dockerfile 或 toolchain。

## 後續修補與放行條件

1. 對 `perl-base`、`libpcre2-8-0` 等有官方修補版本的 OS 命中，評估受維護 base refresh／同 distribution 的安全更新；重新固定輸入、build、11 個整合 tests、canonical verify、掃描與 SBOM。不得只改 digest 後宣稱安全。
2. Node package 命中要查明實際安裝路徑與使用範圍，包括 base 內的 npm 工具鏈；不能把 app 的 `npm audit` 0 findings 套用到整張 OS image，也不能任意覆寫 bundled dependency 宣稱契約相容。
3. 未提供 fix 的紀錄逐項核對 vendor status、受影響功能與 runtime 可達性，留下明確且有期限的風險處置。不要無證據刪除／忽略 scanner 命中。
4. 例如 [Debian CVE-2023-45853 tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853) 說明漏洞位於 MiniZip，並將 bookworm 的 zlib source 列為 vulnerable；本次沒有完成 image 所含 binary／呼叫路徑分析，**不將此項自行標成 false positive**。
5. 映像尚未 security cleared。正式 release／部署還須 owner-only 的 LICENSE、隱私、模型、憑證、authenticated smoke、資料相容與 rollback 閘門，見 [Issue 狀態](issue-1-status.md)。

## 可重跑命令

在先前已建置、確認屬於測試的 image 上執行；`<image>` 必須指向精確候選：

```sh
trivy image --scanners vuln --format json --output image-vulnerabilities.json <image>
trivy image --format cyclonedx --output image-sbom.cdx.json <image>
```

本次 Trivy binary 已核對官方 release SHA-256，漏洞 DB 已下載後以相同 cache 執行掃描。第二條只產生 SBOM，不代表進行漏洞掃描。未新增自動忽略名單、未輪替憑證、未操作正式服務。
