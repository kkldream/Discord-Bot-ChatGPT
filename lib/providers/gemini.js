'use strict';
const { AppError } = require('../errors');
const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/';
const blockedReasons = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII',
  'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'ESCALATION']);
function validateGeminiModel(model) {
  // A model ID, never an arbitrary URL/path/query that could redirect credentials.
  if (typeof model !== 'string' || model.length > 128 || !/^gemini-[a-zA-Z0-9._-]+$/.test(model)) throw new AppError('CONFIG');
  return model;
}
function toGeminiRequest(messages, maxOutputTokens) {
  if (!Array.isArray(messages) || messages.length < 2 || messages[0]?.role !== 'system' ||
      messages.at(-1)?.role !== 'user') throw new AppError('HISTORY');
  const contents = [];
  for (const [index, message] of messages.entries()) {
    if (typeof message?.content !== 'string' || !['system', 'user', 'assistant'].includes(message.role) ||
        (index > 0 && message.role === 'system')) throw new AppError('HISTORY');
    if (index === 0) continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    const part = { text: message.content };
    // Preserve consecutive same-role turns without dropping text or inventing roles.
    if (contents.at(-1)?.role === role) contents.at(-1).parts.push(part);
    else contents.push({ role, parts: [part] });
  }
  if (contents[0]?.role !== 'user') throw new AppError('HISTORY');
  return { systemInstruction: { parts: [{ text: messages[0].content }] }, contents,
    generationConfig: { candidateCount: 1, maxOutputTokens }, store: false };
}
async function readJson(response, maxBytes, signal) {
  if (!response.body) throw new AppError('UPSTREAM');
  const chunks = []; let bytes = 0;
  // Bound the decoded HTTP body, including thought/metadata overhead and JSON escaping.
  for await (const chunk of response.body) {
    signal.throwIfAborted(); bytes += chunk.byteLength;
    if (bytes > maxBytes) throw new AppError('OUTPUT_LIMIT');
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AppError('UPSTREAM'); }
}
function count(value) { return Number.isSafeInteger(value) && value >= 0 ? value : null; }
function parseGeminiResponse(data, config) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new AppError('UPSTREAM');
  if (data.promptFeedback?.blockReason && data.promptFeedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') throw new AppError('BLOCKED_OUTPUT');
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : undefined;
  if (!candidate) throw new AppError('EMPTY_OUTPUT');
  if (blockedReasons.has(candidate.finishReason)) throw new AppError('BLOCKED_OUTPUT');
  // Do not persist partial answers as a successful round.
  if (candidate.finishReason === 'MAX_TOKENS') throw new AppError('OUTPUT_LIMIT');
  if (candidate.finishReason !== 'STOP') throw new AppError('UPSTREAM');
  if (candidate.content?.role && candidate.content.role !== 'model') throw new AppError('UPSTREAM');
  const parts = candidate.content?.parts;
  if (!Array.isArray(parts)) throw new AppError('EMPTY_OUTPUT');
  const text = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') throw new AppError('UPSTREAM');
    if (part.thought) continue; // Never expose thought text or thought signatures.
    if (typeof part.text !== 'string') throw new AppError('UPSTREAM');
    text.push(part.text);
  }
  const message = text.join('');
  if (!message.trim()) throw new AppError('EMPTY_OUTPUT');
  if (Buffer.byteLength(message, 'utf8') > config.maxOutputBytes) throw new AppError('OUTPUT_LIMIT');
  const fields = ['promptTokenCount', 'candidatesTokenCount', 'totalTokenCount', 'cachedContentTokenCount', 'thoughtsTokenCount'];
  const usage = data.usageMetadata && typeof data.usageMetadata === 'object' ?
    Object.fromEntries(fields.map(key => [key, count(data.usageMetadata[key])])) : null;
  return { id: typeof data.responseId === 'string' ? data.responseId : null, provider: 'gemini',
    model: typeof data.modelVersion === 'string' ? data.modelVersion : config.model,
    message, token: usage?.totalTokenCount ?? null, usage, cost: null,
    estimate: { currency: 'USD', rateDate: null, isBillingRecord: false } };
}
function createGeminiProvider(config, { fetch: transport = globalThis.fetch } = {}) {
  const model = validateGeminiModel(config.model);
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim() || /[\r\n]/.test(config.apiKey) ||
      typeof transport !== 'function') throw new AppError('CONFIG');
  return {
    async chat(messages, { signal } = {}) {
      const body = toGeminiRequest(messages, config.maxOutputTokens);
      const deadline = AbortSignal.timeout(config.timeoutMs);
      const abort = signal ? AbortSignal.any([deadline, signal]) : deadline;
      try {
        abort.throwIfAborted();
        let response;
        try {
          response = await transport(`${endpoint}${model}:generateContent`, {
            method: 'POST', redirect: 'manual', signal: abort,
            headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
            body: JSON.stringify(body),
          });
        } catch (cause) { throw new AppError('NETWORK', { cause }); }
        if (!response.ok) {
          // Never parse, persist, log or display upstream error bodies or redirect URLs.
          try { await response.body?.cancel(); } catch { /* Preserve safe HTTP classification. */ }
          const status = response.status;
          const code = status === 401 || status === 403 ? 'AUTH' : status === 429 ? 'RATE_LIMIT' : 'UPSTREAM';
          throw new AppError(code, { status });
        }
        const maxWireBytes = Math.min(8 * 1024 * 1024, config.maxOutputBytes * 8 + 65536);
        return parseGeminiResponse(await readJson(response, maxWireBytes, abort), config);
      } catch (error) {
        if (abort.aborted) throw new AppError(signal?.aborted ? 'STOPPING' : 'TIMEOUT');
        if (error instanceof AppError) throw error;
        throw new AppError('NETWORK', { cause: error });
      }
    },
  };
}
module.exports = { createGeminiProvider, toGeminiRequest, parseGeminiResponse, validateGeminiModel };
