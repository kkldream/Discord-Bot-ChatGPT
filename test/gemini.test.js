'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');
const { loadConfig } = require('../lib/config');
const { errorEnvelope } = require('../lib/errors');
const { createProvider } = require('../lib/providers');
const { createGeminiProvider, toGeminiRequest } = require('../lib/providers/gemini');
const { config, env, userId } = require('./helpers');
const messages = () => [{ role: 'system', content: 'system instruction' }, { role: 'user', content: 'first' },
  { role: 'assistant', content: 'earlier answer' }, { role: 'user', content: 'latest' }];
const geminiConfig = overrides => config({ provider: 'gemini', model: 'gemini-offline-test', apiKey: 'offline-gemini-key', ...overrides });
const valid = () => ({ responseId: 'offline-response', modelVersion: 'gemini-offline-test',
  candidates: [{ content: { role: 'model', parts: [{ text: 'first' }, { text: 'second' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 2, totalTokenCount: 17, cachedContentTokenCount: 3 } });
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const provider = (data, overrides = {}) => createGeminiProvider(geminiConfig(overrides), { fetch: async () => json(data) });
const hasCode = code => error => error.code === code;

test('provider configuration remains OpenAI-compatible and selects only the necessary key', () => {
  assert.equal(loadConfig(env()).provider, 'openai');
  const source = { ...env(), AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-offline-test', GEMINI_API_KEY: 'offline-gemini-key' };
  delete source.OPENAI_API_KEY;
  const result = loadConfig(source);
  assert.equal(result.provider, 'gemini'); assert.equal(result.apiKey, source.GEMINI_API_KEY);
  assert.equal(result.model, source.GEMINI_MODEL);
  assert.throws(() => loadConfig({ ...source, GEMINI_API_KEY: '' }), hasCode('CONFIG'));
  assert.throws(() => loadConfig({ ...source, GEMINI_MODEL: '' }), hasCode('CONFIG'));
  assert.throws(() => loadConfig({ ...source, AI_PROVIDER: 'unknown' }), hasCode('CONFIG'));
  assert.equal(loadConfig({ ...source, AI_TIMEOUT_MS: '6000', OPENAI_TIMEOUT_MS: '7000' }).timeoutMs, 6000);
  assert.equal(loadConfig({ ...source, OPENAI_TIMEOUT_MS: '7000' }).timeoutMs, 7000);
});
for (const model of ['https://example.com', '../secret', 'gemini-test?key=other', 'gemini-test#fragment', 'gemini-test/extra', 'gemini-' + 'x'.repeat(200)]) {
  test(`invalid model identifiers are rejected: ${model.slice(0, 35)}`, () => {
    assert.throws(() => createGeminiProvider(geminiConfig({ model })), hasCode('CONFIG'));
  });
}
test('custom Gemini endpoints are rejected instead of forwarding credentials', () => {
  const source = { ...env(), AI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-offline-test', GEMINI_API_KEY: 'offline' };
  for (const url of ['http://generativelanguage.googleapis.com', 'https://example.com', 'https://generativelanguage.googleapis.com.evil.invalid',
    'https://generativelanguage.googleapis.com/?key=other']) {
    assert.throws(() => loadConfig({ ...source, GEMINI_BASE_URL: url }), hasCode('CONFIG'));
  }
  assert.doesNotThrow(() => loadConfig({ ...source, GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/' }));
});
test('request preserves system and conversation roles without mutating persisted messages', async () => {
  const input = messages(); const snapshot = structuredClone(input); let request; let url;
  const chat = createProvider(geminiConfig(), { fetch: async (target, options) => { url = target; request = options; return json(valid()); } });
  const result = await chat.chat(input);
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-offline-test:generateContent');
  assert.ok(!url.includes('offline-gemini-key')); assert.equal(request.redirect, 'manual');
  assert.equal(request.headers['x-goog-api-key'], 'offline-gemini-key'); assert.ok(request.signal instanceof AbortSignal);
  const body = JSON.parse(request.body);
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'system instruction' }] });
  assert.deepEqual(body.contents.map(turn => turn.role), ['user', 'model', 'user']);
  assert.equal(body.contents[1].parts[0].text, 'earlier answer');
  assert.equal(body.generationConfig.maxOutputTokens, 2048); assert.equal(body.generationConfig.candidateCount, 1);
  assert.equal(body.store, false); assert.equal(body.safetySettings, undefined); assert.equal(body.tools, undefined);
  assert.deepEqual(input, snapshot); assert.equal(result.message, 'firstsecond');
  assert.equal(result.provider, 'gemini'); assert.equal(result.cost, null); assert.equal(result.token, 17);
  assert.equal(result.usage.thoughtsTokenCount, 2); assert.equal(result.estimate.rateDate, null);
});
test('consecutive user turns keep every text part', () => {
  const body = toGeminiRequest([{ role: 'system', content: 'system' }, { role: 'user', content: 'a' }, { role: 'user', content: 'b' }], 10);
  assert.equal(body.contents.length, 1); assert.deepEqual(body.contents[0].parts, [{ text: 'a' }, { text: 'b' }]);
});
for (const input of [[], [{ role: 'user', content: 'old Gemini system' }, { role: 'user', content: 'question' }],
  [{ role: 'system', content: 'system' }, { role: 'model', content: 'old Gemini answer' }, { role: 'user', content: 'question' }],
  [{ role: 'system', content: 'system' }, { role: 'system', content: 'injected' }, { role: 'user', content: 'question' }]]) {
  test('legacy or malformed history is rejected, never silently reinterpreted', async () => {
    let calls = 0; const chat = createGeminiProvider(geminiConfig(), { fetch: async () => { calls++; return json(valid()); } });
    await assert.rejects(chat.chat(input), hasCode('HISTORY')); assert.equal(calls, 0);
  });
}
test('missing usage remains unknown and does not invent a zero-price bill', async () => {
  const data = valid(); delete data.usageMetadata;
  const result = await provider(data).chat(messages());
  assert.equal(result.token, null); assert.equal(result.usage, null); assert.equal(result.cost, null);
});
test('usage persistence is allowlisted and validates counts', async () => {
  const data = valid(); data.usageMetadata = { totalTokenCount: -1, promptTokenCount: '10', arbitrary: 'private metadata' };
  const result = await provider(data).chat(messages());
  assert.equal(result.token, null); assert.equal(result.usage.promptTokenCount, null);
  assert.equal(result.usage.arbitrary, undefined);
});
test('thought text and signatures never enter the answer', async () => {
  const data = valid(); data.candidates[0].content.parts.unshift({ text: 'private reasoning', thought: true, thoughtSignature: 'private signature' });
  assert.equal((await provider(data).chat(messages())).message, 'firstsecond');
});
for (const data of [{}, { candidates: [] }, { candidates: [{ finishReason: 'STOP' }] },
  { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
  { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '  ' }] } }] }]) {
  test('empty or missing candidates do not throw unsafe TypeErrors', async () => {
    await assert.rejects(provider(data).chat(messages()), hasCode('EMPTY_OUTPUT'));
  });
}
for (const reason of ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']) {
  test(`filtered candidate ${reason} is not displayed or persisted`, async () => {
    const data = valid(); data.candidates[0].finishReason = reason;
    await assert.rejects(provider(data).chat(messages()), hasCode('BLOCKED_OUTPUT'));
  });
}
test('blocked prompt, truncated output and unexpected tools are safe failures', async () => {
  await assert.rejects(provider({ promptFeedback: { blockReason: 'SAFETY' } }).chat(messages()), hasCode('BLOCKED_OUTPUT'));
  const data = valid(); data.candidates[0].finishReason = 'MAX_TOKENS';
  await assert.rejects(provider(data).chat(messages()), hasCode('OUTPUT_LIMIT'));
  data.candidates[0].finishReason = 'UNEXPECTED_TOOL_CALL';
  await assert.rejects(provider(data).chat(messages()), hasCode('UPSTREAM'));
  data.candidates[0].finishReason = 'STOP'; data.candidates[0].content.parts = [{ functionCall: {} }];
  await assert.rejects(provider(data).chat(messages()), hasCode('UPSTREAM'));
});
for (const [status, code] of [[400, 'UPSTREAM'], [401, 'AUTH'], [403, 'AUTH'], [404, 'UPSTREAM'], [429, 'RATE_LIMIT'], [500, 'UPSTREAM'], [503, 'UPSTREAM'], [302, 'UPSTREAM']]) {
  test(`HTTP ${status}: no retry, redirect follow, raw errors or credential logging`, async () => {
    let calls = 0; const logs = [];
    const chat = createGeminiProvider(geminiConfig(), { fetch: async () => {
      calls++; return new Response('upstream-private-token', { status, headers: { location: 'https://example.com/' } });
    } });
    await assert.rejects(chat.chat(messages()), error => {
      const safe = errorEnvelope(error, { error: line => logs.push(line) });
      assert.equal(error.code, code); assert.equal(error.status, status);
      assert.doesNotMatch(JSON.stringify(safe) + logs.join(''), /upstream-private-token|offline-gemini-key|example\.com/);
      return true;
    });
    assert.equal(calls, 1);
  });
}
test('network failure remains safe', async () => {
  const chat = createGeminiProvider(geminiConfig(), { fetch: async () => { throw new TypeError('transport with private context'); } });
  await assert.rejects(chat.chat(messages()), hasCode('NETWORK'));
});
test('invalid JSON is classified without exposing upstream contents', async () => {
  const chat = createGeminiProvider(geminiConfig(), { fetch: async () => new Response('not-json-private-token') });
  await assert.rejects(chat.chat(messages()), hasCode('UPSTREAM'));
});
test('HTTP body and displayed UTF-8 output both have byte limits', async () => {
  await assert.rejects(provider(valid(), { maxOutputBytes: 2 }).chat(messages()), hasCode('OUTPUT_LIMIT'));
  const chat = createGeminiProvider(geminiConfig({ maxOutputBytes: 2 }), { fetch: async () => new Response('x'.repeat(70000)) });
  await assert.rejects(chat.chat(messages()), hasCode('OUTPUT_LIMIT'));
});
test('oversized streaming response is cancelled', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(Buffer.alloc(70000)); }, cancel() { cancelled = true; } });
  const chat = createGeminiProvider(geminiConfig({ maxOutputBytes: 2 }), { fetch: async () => new Response(stream) });
  await assert.rejects(chat.chat(messages()), hasCode('OUTPUT_LIMIT')); assert.equal(cancelled, true);
});
test('request timeout aborts transport, with no retry', async () => {
  let calls = 0; const alive = setTimeout(() => {}, 1000);
  const chat = createGeminiProvider(geminiConfig({ timeoutMs: 20 }), { fetch: async (_url, options) => {
    calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  try { await assert.rejects(chat.chat(messages()), hasCode('TIMEOUT')); assert.equal(calls, 1); }
  finally { clearTimeout(alive); }
});
test('pre-aborted shutdown never sends a paid request', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const chat = createGeminiProvider(geminiConfig(), { fetch: async () => { calls++; return json(valid()); } });
  await assert.rejects(chat.chat(messages(), { signal: controller.signal }), hasCode('STOPPING')); assert.equal(calls, 0);
});
test('factory keeps OpenAI SDK path and rejects unknown providers', async () => {
  const chat = createProvider(config(), { fetch: async () => json({ id: 'offline', model: 'gpt-4.1-nano',
    choices: [{ message: { content: 'OpenAI answer' } }] }) });
  assert.equal((await chat.chat(messages())).provider, 'openai');
  assert.throws(() => createProvider(config({ provider: 'unknown' })), hasCode('CONFIG'));
});
test('real runtime selects Gemini and stores canonical user/assistant roles without environment loading', async () => {
  const { createRuntime } = require('../lib/runtime');
  const { ChannelType } = require('discord.js');
  let update; let output; let fetched = false;
  const original = { _id: 'session', userId, mode: 'init', messages: [messages()[0]] };
  const db = { dmChannelCol: { find: () => ({ limit: () => ({ toArray: async () => [original] }) }),
    updateOne: async (_filter, data) => { update = data; return { matchedCount: 1 }; } } };
  const runtime = createRuntime(geminiConfig(), { db, client: { user: { id: 'bot' } }, system: 'system', createServer: () => ({}),
    providerOptions: { fetch: async url => { fetched = url.startsWith('https://generativelanguage.googleapis.com/'); return json(valid()); } },
    logger: { error: line => { throw new Error(line); }, info() {} } });
  await runtime.handlers.messageCreate({ id: 'offline-message', author: { id: userId }, channel: { type: ChannelType.DM },
    content: 'question', reply: async () => ({ edit: async payload => { output = payload.content; } }) });
  assert.equal(fetched, true); assert.equal(output, 'firstsecond');
  assert.deepEqual(update.$push.messages.$each.map(turn => turn.role), ['user', 'assistant']);
  assert.equal(original.messages[0].role, 'system'); assert.equal(update.$set.lastUsage.provider, 'gemini');
  assert.equal(update.$set.lastUsage.estimatedUsd, null);
});
