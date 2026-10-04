'use strict';
const { randomUUID } = require('node:crypto');
const { APIConnectionError, APIConnectionTimeoutError } = require('openai');
const publicMessages = Object.freeze({
  UNEXPECTED: '處理失敗，請稍後再試。',
  CONFIG: '服務設定有誤，請聯絡管理員。',
  TIMEOUT: '請求逾時，請稍後再試。',
  NETWORK: '目前無法連線至模型服務。',
  AUTH: '模型服務驗證失敗，請聯絡管理員。',
  RATE_LIMIT: '請求太頻繁，請稍後再試。',
  UPSTREAM: '模型服務暫時無法使用。',
  BLOCKED_OUTPUT: '模型未提供可顯示的回覆，請調整問題後再試。',
  EMPTY_OUTPUT: '模型未傳回文字，請重新提問。',
  INPUT_LIMIT: '訊息或系統提示超過目前上下文限制。',
  OUTPUT_LIMIT: '模型回覆超過目前輸出大小限制。',
  HISTORY: '無法取得完整歷史，請以 /ai 開啟新對話。',
  SESSION: '請先使用 /ai 初始化私訊對話。',
  CONFLICT: '對話狀態已變更，本輪未儲存；請重新提問。',
  SESSION_LIMIT: '此對話已達儲存上限，請使用 /ai 開啟新對話。',
  BUSY: '目前請求較多，請稍後再試。',
  FORBIDDEN: '目前未開放此帳號或頻道使用。',
  STOPPING: '服務正在關閉，請稍後再試。',
});
class AppError extends Error {
  constructor(code, options = {}) {
    super(publicMessages[code] || publicMessages.UNEXPECTED, options);
    this.name = 'AppError';
    this.code = Object.hasOwn(publicMessages, code) ? code : 'UNEXPECTED';
    if (Number.isInteger(options.status)) this.status = options.status;
  }
}
function classifyError(error) {
  if (error instanceof AppError) return error;
  const status = error?.status ?? error?.response?.status;
  let code = 'UNEXPECTED';
  if (error instanceof APIConnectionTimeoutError || ['APIConnectionTimeoutError', 'AbortError', 'TimeoutError'].includes(error?.name) ||
      ['ETIMEDOUT', 'ECONNABORTED'].includes(error?.code)) code = 'TIMEOUT';
  else if (error instanceof APIConnectionError || error?.name === 'APIConnectionError' ||
      ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(error?.code)) code = 'NETWORK';
  else if (status === 401 || status === 403) code = 'AUTH';
  else if (status === 429) code = 'RATE_LIMIT';
  else if (status >= 500 && status <= 599) code = 'UPSTREAM';
  return new AppError(code, { cause: error, status });
}
function errorEnvelope(error, logger = console) {
  const safe = classifyError(error);
  const correlationId = randomUUID();
  // Deliberately allow-list fields. Never serialize cause, headers, URI, input, or stack.
  const record = { event: 'operation_failed', code: safe.code, correlationId };
  if (safe.status >= 400 && safe.status <= 599) record.status = safe.status;
  try { logger.error(JSON.stringify(record)); } catch { /* Logging must not crash a handler. */ }
  return { code: safe.code, correlationId, content: `${safe.message}\n追蹤碼：${correlationId}` };
}
module.exports = { AppError, classifyError, errorEnvelope };
