'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatProvider, estimateCost } = require('../openaiApi');
const { config } = require('./helpers');
const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'question' }];
const body = (content = 'answer') => ({ id: 'offline-response', model: 'gpt-4.1-nano-2025-04-14',
  choices: [{ message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } });
test('B05: versioned per-model prices match uncached and cached input fixtures', () => {
  assert.equal(estimateCost('gpt-4.1-nano', body().usage), 0.0005);
  assert.equal(estimateCost('gpt-4.1-nano', { ...body().usage, prompt_tokens_details: { cached_tokens: 500 } }), 0.0004625);
  assert.equal(estimateCost('unknown', body().usage), null); assert.equal(estimateCost('gpt-4.1-nano', null), null);
});
test('O02: actual installed SDK uses Chat Completions contract with bounded output and storage disabled', async () => {
  const requests = [];
  const provider = createChatProvider(config(), { fetch: async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(body()), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await provider.chat(messages);
  assert.equal(requests.length, 1); assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
  const sent = JSON.parse(requests[0].init.body);
  assert.deepEqual(sent.messages, messages); assert.equal(sent.max_completion_tokens, 2048); assert.equal(sent.store, false);
  assert.equal(result.message, 'answer'); assert.equal(result.token, 2000); assert.equal(result.cost, 0.0005);
  assert.equal(result.estimate.isBillingRecord, false);
});
for (const [status, code] of [[401, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'UPSTREAM'], [503, 'UPSTREAM']]) {
  test(`actual SDK HTTP ${status} maps safely without automatic retries`, async () => {
    let calls = 0;
    const provider = createChatProvider(config(), { fetch: async () => {
      calls++; return new Response(JSON.stringify({ error: { message: 'private upstream error', type: 'test_error' } }),
        { status, headers: { 'content-type': 'application/json' } });
    } });
    await assert.rejects(provider.chat(messages), error => error.code === code && !!error.cause && !error.message.includes('private'));
    assert.equal(calls, 1);
  });
}
test('actual SDK transport failure has a cause and does not access response.data', async () => {
  const provider = createChatProvider(config(), { fetch: async () => { throw new TypeError('offline transport failure'); } });
  await assert.rejects(provider.chat(messages), error => error.code === 'NETWORK' && error.cause instanceof require('openai').APIConnectionError);
});
test('request deadline aborts mocked fetch without making a paid request', async () => {
  const provider = createChatProvider(config({ timeoutMs: 1000 }), { fetch: async (_url, init) => new Promise((_resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
  }) });
  // Keep the event loop alive because AbortSignal.timeout timers are unreferenced.
  const timer = setTimeout(() => {}, 2000);
  try { await assert.rejects(provider.chat(messages), error => error.code === 'TIMEOUT'); }
  finally { clearTimeout(timer); }
});
for (const content of [null, '', ' ']) {
  test(`SDK empty content ${String(content)} is not sent to Discord`, async () => {
    const provider = createChatProvider(config(), { client: { chat: { completions: { create: async () => body(content) } } } });
    await assert.rejects(provider.chat(messages), error => error.code === 'EMPTY_OUTPUT');
  });
}
test('unknown response model has no fabricated cost estimate', async () => {
  const provider = createChatProvider(config(), { client: { chat: { completions: { create: async () => ({ ...body(), model: 'unknown-model' }) } } } });
  assert.equal((await provider.chat(messages)).cost, null);
});
