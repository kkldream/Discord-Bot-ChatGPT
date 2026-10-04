'use strict';
const { AppError, classifyError } = require('./lib/errors');
const rates = Object.freeze({
  // USD / 1M tokens; standard non-batch pricing checked 2026-10-04.
  // https://developers.openai.com/api/docs/models/gpt-4.1-nano
  'gpt-4.1-nano': { input: 0.10, cached: 0.025, output: 0.40 },
  'gpt-4.1-nano-2025-04-14': { input: 0.10, cached: 0.025, output: 0.40 },
});
function estimateCost(model, usage) {
  const rate = rates[model];
  if (!rate || !Number.isFinite(usage?.prompt_tokens) || !Number.isFinite(usage?.completion_tokens)) return null;
  const input = Math.max(0, usage.prompt_tokens);
  const cached = Math.min(input, Math.max(0, usage.prompt_tokens_details?.cached_tokens || 0));
  return ((input - cached) * rate.input + cached * rate.cached + Math.max(0, usage.completion_tokens) * rate.output) / 1e6;
}
function createChatProvider(config, { client, fetch } = {}) {
  if (!client) {
    const OpenAI = require('openai');
    client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 0,
      logLevel: 'off', baseURL: 'https://api.openai.com/v1', ...(fetch ? { fetch } : {}) });
  }
  return {
    async chat(messages, { signal } = {}) {
      const deadline = AbortSignal.timeout(config.timeoutMs);
      const abort = signal ? AbortSignal.any([deadline, signal]) : deadline;
      try {
        const completion = await client.chat.completions.create({ model: config.model, messages,
          max_completion_tokens: config.maxOutputTokens, store: false }, { signal: abort, timeout: config.timeoutMs, maxRetries: 0 });
        const content = completion.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) throw new AppError('EMPTY_OUTPUT');
        if (Buffer.byteLength(content, 'utf8') > config.maxOutputBytes) throw new AppError('OUTPUT_LIMIT');
        const model = completion.model || config.model;
        return { id: completion.id, model, message: content, token: completion.usage?.total_tokens ?? null,
          cost: estimateCost(model, completion.usage), usage: completion.usage ?? null,
          estimate: { currency: 'USD', rateDate: '2026-10-04', isBillingRecord: false } };
      } catch (error) {
        if (abort.aborted) throw new AppError('TIMEOUT', { cause: error });
        throw classifyError(error);
      }
    },
  };
}
module.exports = { createChatProvider, estimateCost };
