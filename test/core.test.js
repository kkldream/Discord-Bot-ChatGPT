'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig, mayUse } = require('../lib/config');
const { AppError, classifyError, errorEnvelope } = require('../lib/errors');
const { KeyedQueue, RequestGate, EventCache } = require('../lib/control');
const { responsePayload, boundContext, guildContext, seedMessage, attachmentNotice } = require('../lib/messages');
const { config, env, userId, guildId, channelId, tick } = require('./helpers');
const code = expected => error => error.code === expected;

test('configuration has bounded defaults and is immutable', () => {
  const actual = loadConfig(env());
  assert.equal(actual.model, 'gpt-4.1-nano'); assert.equal(actual.timeoutMs, 30000);
  assert.equal(actual.maxConcurrent, 4); assert.ok(Object.isFrozen(actual));
});
for (const field of ['DISCORD_BOT_TOKEN', 'OPENAI_API_KEY', 'MONGODB_URL', 'MONGODB_DB_NAME']) {
  test(`configuration rejects missing ${field} without exposing its value`, () => {
    const values = env(); delete values[field]; assert.throws(() => loadConfig(values), code('CONFIG'));
  });
}
for (const [field, value] of [['OPENAI_TIMEOUT_MS', '-1'], ['MAX_CONCURRENT_REQUESTS', '1.5'],
  ['MAX_CHAIN_DEPTH', '101'], ['ALLOW_PUBLIC_ACCESS', 'TRUE'], ['ALLOWED_USER_IDS', 'not-an-id'],
  ['MONGODB_DB_NAME', 'invalid/name'], ['MONGODB_URL', 'https://example.invalid']]) {
  test(`configuration rejects invalid ${field}`, () => assert.throws(() => loadConfig({ ...env(), [field]: value }), code('CONFIG')));
}
test('access fails closed when no audience is explicitly configured', () => {
  assert.throws(() => loadConfig({ ...env(), ALLOWED_USER_IDS: '' }), code('CONFIG'));
});
test('allowlists intersect and guild-only permission never grants DM access', () => {
  assert.equal(mayUse(config(), userId, null, channelId), true);
  assert.equal(mayUse(config(), 'other', null, channelId), false);
  const scoped = config({ allowedUsers: new Set(), allowedGuilds: new Set([guildId]), allowedChannels: new Set([channelId]) });
  assert.equal(mayUse(scoped, 'other', guildId, channelId), true);
  assert.equal(mayUse(scoped, 'other', guildId, 'wrong'), false);
  assert.equal(mayUse(scoped, 'other', null, channelId), false);
  assert.equal(mayUse({ ...scoped, enableDms: false, publicAccess: true }, userId, null, channelId), false);
});
for (const value of [null, '', '   ', undefined]) {
  test(`B09: empty output ${String(value)} is classified`, () => assert.throws(() => responsePayload(value), code('EMPTY_OUTPUT')));
}
test('B09: exactly 2000 UTF-16 units remain inline without allowing mentions', () => {
  const payload = responsePayload('😀'.repeat(1000));
  assert.equal(payload.content.length, 2000); assert.equal(payload.files, undefined);
  assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false, users: [], roles: [] });
});
test('B09: long Unicode/code-fenced output round-trips exactly in a UTF-8 attachment', () => {
  const text = '```js\n' + 'const x = "😀中文";\n'.repeat(400) + '```\n@everyone';
  const payload = responsePayload(text);
  assert.ok(payload.content.length <= 2000); assert.equal(payload.files[0].name, 'ai-response.txt');
  assert.equal(payload.files[0].attachment.toString('utf8'), text);
  assert.deepEqual(payload.allowedMentions.parse, []);
});
test('B09: output byte ceiling does not silently truncate', () => assert.throws(() => responsePayload('a'.repeat(5000), 4000), code('OUTPUT_LIMIT')));
test('context budget preserves system/newest input and selects complete recent rounds', () => {
  const messages = [{ role: 'system', content: 'system' }, ...Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 ? 'assistant' : 'user', content: `turn-${i}` })), { role: 'user', content: 'latest' }];
  const bounded = boundContext(messages, config({ maxContextMessages: 6 }));
  assert.ok(bounded.length <= 6); assert.deepEqual(bounded[0], messages[0]);
  assert.equal(bounded[1].role, 'user'); assert.equal(bounded.at(-1).content, 'latest');
  assert.equal(messages.length, 14);
});
test('context byte budget includes multibyte content and never changes original text', () => {
  const messages = [{ role: 'system', content: '系統' }, { role: 'user', content: 'a'.repeat(2000) },
    { role: 'assistant', content: 'old' }, { role: 'user', content: '問題😀' }];
  const bounded = boundContext(messages, config({ maxContextBytes: 300 }));
  assert.deepEqual(bounded, [messages[0], messages.at(-1)]);
});
test('oversize newest input is rejected before model calls', () => {
  assert.throws(() => boundContext([{ role: 'system', content: 'system' }, { role: 'user', content: '字'.repeat(1000) }],
    config({ maxContextBytes: 1024 })), code('INPUT_LIMIT'));
});
function guildFixture(text, saved = null) {
  const chain = {
    answer: { author: { id: 'bot' }, content: text, reference: { messageId: 'question' } },
    question: { author: { id: userId }, content: 'first question', reference: { messageId: 'seed' } },
    seed: { author: { id: 'bot' }, content: seedMessage },
  };
  const message = { content: 'next question', channelId, reference: { messageId: 'answer' },
    channel: { messages: { fetch: async id => chain[id] } } };
  return { message, chain, store: { getReply: async id => id === 'answer' ? saved : null } };
}
for (const text of ['Hello', 'first\nsecond', 'first\n\nsecond']) {
  test(`B01: full assistant body ${JSON.stringify(text)} and earliest question survive`, async () => {
    const f = guildFixture(text);
    const actual = await guildContext(f.message, 'bot', f.store, 'system', config());
    assert.deepEqual(actual, [{ role: 'system', content: 'system' }, { role: 'user', content: 'first question' },
      { role: 'assistant', content: text }, { role: 'user', content: 'next question' }]);
  });
}
test('guild continuation uses stored full output rather than an attachment notice', async () => {
  const full = '😀'.repeat(1500); const f = guildFixture(attachmentNotice, { kind: 'reply', content: full });
  const actual = await guildContext(f.message, 'bot', f.store, 'system', config());
  assert.equal(actual[2].content, full);
});
test('missing persisted attachment content fails safely instead of inventing context', async () => {
  const f = guildFixture(attachmentNotice);
  await assert.rejects(guildContext(f.message, 'bot', f.store, 'system', config()), code('HISTORY'));
});
test('deleted/cyclic/cross-channel references are bounded safe failures', async () => {
  const f = guildFixture('answer');
  f.message.channel.messages.fetch = async () => { throw new Error('deleted'); };
  await assert.rejects(guildContext(f.message, 'bot', f.store, 'system', config()), code('HISTORY'));
  const cyclic = guildFixture('answer'); cyclic.chain.answer.reference = { messageId: 'answer' };
  await assert.rejects(guildContext(cyclic.message, 'bot', cyclic.store, 'system', config()), code('HISTORY'));
  const cross = guildFixture('answer'); cross.message.reference.channelId = 'wrong';
  await assert.rejects(guildContext(cross.message, 'bot', cross.store, 'system', config()), code('HISTORY'));
});
test('reply to another person is ignored, not charged', async () => {
  const f = guildFixture('answer'); f.chain.answer.author.id = 'someone-else';
  assert.equal(await guildContext(f.message, 'bot', f.store, 'system', config()), null);
});
test('reference traversal stops at its configured depth', async () => {
  let count = 0; const f = guildFixture('answer');
  f.message.channel.messages.fetch = async id => { count++; return { author: { id: count === 1 ? 'bot' : userId },
    content: id, reference: { messageId: String(count) } }; };
  await guildContext(f.message, 'bot', f.store, 'system', config({ maxChainDepth: 4 })); assert.equal(count, 4);
});
test('B04: same-user work is serialized while different users run independently', async () => {
  const q = new KeyedQueue(); const order = []; let release;
  const first = q.run('u', async () => { order.push('first'); await new Promise(r => { release = r; }); order.push('done'); });
  const second = q.run('u', async () => { order.push('second'); });
  await q.run('v', async () => { order.push('other'); }); await tick();
  assert.deepEqual(order, ['first', 'other']); release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'other', 'done', 'second']); assert.equal(q.total, 0); assert.equal(q.tails.size, 0);
});
test('rejected queued work does not poison the next request or leak queue keys', async () => {
  const q = new KeyedQueue();
  const first = q.run('u', async () => { throw new Error('fail'); });
  const second = q.run('u', async () => 42);
  await assert.rejects(first); assert.equal(await second, 42); await q.drain();
  assert.equal(q.counts.size, 0); await assert.rejects(q.run('u', async () => {}), code('STOPPING'));
});
test('queue rejects saturation rather than accumulating unbounded promises', async () => {
  const q = new KeyedQueue({ maxPendingPerUser: 1, maxPendingTotal: 1 }); let release;
  const first = q.run('u', () => new Promise(r => { release = r; })); await tick();
  await assert.rejects(q.run('u', async () => {}), code('BUSY'));
  await assert.rejects(q.run('v', async () => {}), code('BUSY')); release(); await first;
});
test('request budgets reset by window and failed requests still consume quota', async () => {
  let now = 60000; const g = new RequestGate(config({ requestsPerMinute: 1 }), () => now);
  await assert.rejects(g.run('u', async () => { throw new Error('upstream'); }));
  await assert.rejects(g.run('u', async () => {}), code('RATE_LIMIT')); now += 60000;
  assert.equal(await g.run('u', async () => 7), 7); assert.equal(g.active, 0);
});
test('global concurrent request ceiling is enforced and permits are released', async () => {
  const g = new RequestGate(config({ maxConcurrent: 1 })); let release;
  const first = g.run('u', () => new Promise(r => { release = r; }));
  await assert.rejects(g.run('v', async () => {}), code('BUSY')); release(); await first;
  assert.equal(await g.run('v', async () => 2), 2);
});
test('dedup cache has a bounded size and expiry', () => {
  let now = 0; const cache = new EventCache({ max: 1, ttlMs: 10, now: () => now });
  assert.equal(cache.claim('a'), true); assert.equal(cache.claim('a'), false);
  assert.throws(() => cache.claim('b'), code('BUSY')); now = 11; assert.equal(cache.claim('b'), true);
});
for (const [error, expected] of [[{ code: 'ENOTFOUND' }, 'NETWORK'], [{ name: 'APIConnectionError' }, 'NETWORK'],
  [{ name: 'APIConnectionTimeoutError' }, 'TIMEOUT'], [{ name: 'AbortError' }, 'TIMEOUT'],
  [{ status: 401 }, 'AUTH'], [{ status: 403 }, 'AUTH'], [{ status: 429 }, 'RATE_LIMIT'],
  [{ status: 503 }, 'UPSTREAM'], [new Error('unknown'), 'UNEXPECTED']]) {
  test(`B02: classify ${JSON.stringify(error)} as ${expected} while preserving cause`, () => {
    const actual = classifyError(error); assert.equal(actual.code, expected); assert.equal(actual.cause, error);
  });
}
test('S03: logs and user responses exclude raw messages, credentials, headers, and stack', () => {
  const logs = []; const error = Object.assign(new Error('sensitive-prompt secret-api-key'), {
    status: 401, headers: { authorization: 'hidden-token' }, response: { data: 'private' } });
  const safe = errorEnvelope(error, { error: value => logs.push(value) });
  assert.equal(safe.code, 'AUTH');
  for (const sensitive of ['sensitive-prompt', 'secret-api-key', 'hidden-token', 'private', 'stack']) {
    assert.ok(!JSON.stringify({ safe, logs }).includes(sensitive));
  }
  assert.match(safe.correlationId, /^[a-f0-9-]{36}$/); assert.equal(JSON.parse(logs[0]).correlationId, safe.correlationId);
  assert.doesNotThrow(() => errorEnvelope(new AppError('NETWORK'), { error() { throw new Error('logger failed'); } }));
});
