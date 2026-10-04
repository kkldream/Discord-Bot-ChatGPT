# Changelog

## Unreleased — Gemini provider

- Add opt-in Gemini text provider, canonical history conversion, safe responses and provider-specific privacy notices.
- Preserve OpenAI default, existing offline tests, bounded resources and npm/CommonJS runtime; no new dependencies.
- Add worktree/index secret checks and backup/env ignore rules.
- No legacy dev merge, database migration, secret rotation or deployment.

## Unreleased — issue #1 offline baseline

- 修正頻道續聊正文截斷、DM 冷快取、事件層錯誤邊界、SDK 傳輸錯誤及長輸出處理。
- DM 在單一程序按使用者序列化；以原子 append、版本條件與事件 ID 避免覆寫／重複處理，保留舊資料。跨程序 reset 與 unique active-session schema 仍待 migration。
- 加入 fail-closed audience、bot/webhook 排除、mention 控制、請求／佇列／上下文／輸出上限與安全錯誤追蹤碼。
- 升級 Node 24.21.0、discord.js 14.27.0、OpenAI SDK 7.27.0、MongoDB driver 7.7.0；移除未使用 Moment；改用單一 npm lockfile。
- 分離啟動、設定檢查、明示命令註冊；取消全部使用者預熱；加入 readiness 與 graceful shutdown。
- 固定 Docker base digest、最小化 build context、非 root 執行；CI 驗證先於候選 build，移除 checked-in 自動破壞式部署。
- 新增離線回歸／SDK 契約測試、lint、SBOM、安全與操作文件；移除文件內帳密型 URI 範例。
- 保留既有 persona、Chat Completions 與預設模型；提示 gpt-4.1-nano 於 2026-10-23 停用，替代模型須另行驗證。

尚未發布 release，未部署或改動任何正式服務／資料／GitHub 保護設定。完整驗證狀態見 `docs/issue-1-status.md`。
