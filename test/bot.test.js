'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { createHandlers } = require('../lib/bot');
const { seedMessage } = require('../lib/messages');
const { config, userId, guildId, channelId, tick, response } = require('./helpers');
function fixture(overrides = {}) {
  const state = { session: { _id: 'session', userId, version: 0, eventIds: [], messages: [{ role: 'system', content: 'system' }] },
    calls: [], resets: [], logs: [], saved: [], edits: [], replies: [] };
  const store = {
    getActive: async () => structuredClone(state.session),
    reset: async (user, id, system) => {
      state.resets.push(id);
      state.session = { _id: id, userId: user.id, version: 0, eventIds: [], messages: [{ role: 'system', content: system }] };
      return structuredClone(state.session);
    },
    append: async (session, id, question, result) => {
      assert.equal(session.version, state.session.version);
      state.session.version++;
      state.session.messages.push({ role: 'user', content: question }, { role: 'assistant', content: result.message });
      state.session.eventIds.push(id);
    },
    getReply: async () => null,
    saveReply: async (...args) => state.saved.push(args),
  };
  const provider = { chat: async messages => { state.calls.push(structuredClone(messages)); await tick(); return response(`answer:${messages.at(-1).content}`); } };
  const client = { user: { id: 'bot' } };
  const settings = config({ requestsPerMinute: 100, globalRequestsPerMinute: 1000 });
  const logger = { error: value => state.logs.push(value) };
  const handlers = createHandlers({ client, store, provider, config: settings, system: 'system', logger, ...overrides });
  function message(id, content, extra = {}) {
    return { id, content, author: { id: userId, username: 'offline' }, guildId: null, channelId,
      channel: { type: ChannelType.DM },
      reply: async payload => { state.replies.push(payload); return { id: `reply-${id}`, edit: async next => state.edits.push(next) }; }, ...extra };
  }
  function interaction(id, extra = {}) {
    const value = { id, commandName: 'ai', user: { id: userId, username: 'offline' }, guildId: null, channelId,
      channel: null, isChatInputCommand: () => true,
      deferReply: async () => { value.deferred = true; },
      editReply: async payload => { state.edits.push(payload); return { id: `seed-${id}` }; },
      reply: async payload => { state.replies.push(payload); value.replied = true; }, ...extra };
    return value;
  }
  return { state, store, provider, handlers, message, interaction, client, settings, logger };
}
test('B04: two simultaneous DM messages retain both rounds and the second sees the first', async () => {
  const f = fixture();
  await Promise.all([f.handlers.messageCreate(f.message('1', 'one')), f.handlers.messageCreate(f.message('2', 'two'))]);
  assert.equal(f.state.logs.length, 0); assert.equal(f.state.session.messages.length, 5);
  assert.deepEqual(f.state.calls[1].map(m => m.content), ['system', 'one', 'answer:one', 'two']);
  assert.deepEqual(f.state.session.eventIds, ['1', '2']); assert.equal(f.handlers.queue.total, 0);
});
test('B04: initialization and DM use the same queue, and acknowledgement happens before waiting', async () => {
  const f = fixture(); let release;
  f.provider.chat = async messages => { f.state.calls.push(messages); if (messages.at(-1).content === 'one') await new Promise(r => { release = r; }); return response(); };
  const first = f.handlers.messageCreate(f.message('1', 'one')); await tick();
  const interaction = f.interaction('reset'); const reset = f.handlers.interactionCreate(interaction); await tick();
  assert.equal(interaction.deferred, true); assert.equal(f.state.resets.length, 0);
  const second = f.handlers.messageCreate(f.message('2', 'two')); release(); await Promise.all([first, reset, second]);
  assert.deepEqual(f.state.resets, ['reset']);
  assert.deepEqual(f.state.session.messages.map(m => m.content), ['system', 'two', 'answer']);
});
test('duplicate DM delivery is ignored in flight and across handler recreation', async () => {
  const f = fixture(); const m = f.message('same', 'question');
  await Promise.all([f.handlers.messageCreate(m), f.handlers.messageCreate(m)]);
  assert.equal(f.state.calls.length, 1);
  const restarted = createHandlers({ client: f.client, store: f.store, provider: f.provider, config: f.settings, system: 'system', logger: f.logger });
  await restarted.messageCreate(m); assert.equal(f.state.calls.length, 1);
});
test('cold DM needs no user cache warmup and missing session receives /ai guidance', async () => {
  const f = fixture(); f.state.session = null;
  await f.handlers.messageCreate(f.message('1', 'question'));
  assert.equal(f.state.calls.length, 0); assert.match(f.state.replies[0].content, /\/ai/);
});
test('B03: uncached DM /ai interaction works even with channel=null', async () => {
  const f = fixture(); await f.handlers.interactionCreate(f.interaction('1'));
  assert.deepEqual(f.state.resets, ['1']); assert.equal(f.state.logs.length, 0);
});
test('guild /ai returns a public reply-chain seed and persists its type', async () => {
  const f = fixture(); await f.handlers.interactionCreate(f.interaction('1', { guildId }));
  assert.equal(f.state.edits[0].content, seedMessage); assert.equal(f.state.saved[0][3], 'seed');
});
test('guild continuation persists full answer before sending long attachment', async () => {
  const f = fixture(); const long = '```\n' + '😀'.repeat(1300) + '\n```';
  f.provider.chat = async messages => { f.state.calls.push(messages); return response(long); };
  const m = f.message('guild-1', 'question', { guildId, reference: { messageId: 'seed' }, channel: { type: ChannelType.GuildText,
    messages: { fetch: async () => ({ author: { id: 'bot' }, content: seedMessage }) } } });
  await f.handlers.messageCreate(m);
  assert.equal(f.state.saved[0][2], long); assert.equal(f.state.edits[0].files[0].attachment.toString(), long);
  assert.equal(f.state.calls.length, 1); assert.equal(f.state.logs.length, 0);
});
for (const mode of ['bot', 'webhook', 'unauthorized', 'empty', 'unrelated-channel']) {
  test(`S05: ${mode} message is ignored without a model request`, async () => {
    const f = fixture(); const m = f.message('1', 'question');
    if (mode === 'bot') m.author.bot = true;
    if (mode === 'webhook') m.webhookId = 'webhook';
    if (mode === 'unauthorized') m.author.id = 'other';
    if (mode === 'empty') m.content = ' ';
    if (mode === 'unrelated-channel') m.channel.type = ChannelType.GuildVoice;
    await f.handlers.messageCreate(m); assert.equal(f.state.calls.length, 0); assert.equal(f.state.replies.length, 0);
  });
}
for (const failure of ['read', 'reply', 'provider', 'append', 'edit', 'reference']) {
  test(`B06: ${failure} rejection stays within the event boundary and logs no sensitive error`, async () => {
    const f = fixture(); const fail = async () => { throw new Error('private-key-and-prompt'); }; const m = f.message('1', 'question');
    if (failure === 'read') f.store.getActive = fail;
    if (failure === 'reply') m.reply = fail;
    if (failure === 'provider') f.provider.chat = fail;
    if (failure === 'append') f.store.append = fail;
    if (failure === 'edit') m.reply = async () => ({ id: 'reply', edit: fail });
    if (failure === 'reference') {
      m.guildId = guildId; m.reference = { messageId: 'deleted' };
      m.channel = { type: ChannelType.GuildText, messages: { fetch: fail } };
    }
    await assert.doesNotReject(f.handlers.messageCreate(m));
    assert.ok(f.state.logs.length >= 1); assert.ok(!JSON.stringify(f.state.logs).includes('private-key-and-prompt'));
    assert.equal(f.handlers.queue.total, 0);
  });
}
test('command defer failure and error-delivery failure are both contained', async () => {
  const f = fixture(); const fail = async () => { throw new Error('missing permission'); };
  await assert.doesNotReject(f.handlers.interactionCreate(f.interaction('1', { deferReply: fail, reply: fail })));
  assert.equal(f.state.logs.length, 2);
});
test('unauthorized slash command does not initialize data', async () => {
  const f = fixture(); await f.handlers.interactionCreate(f.interaction('1', { user: { id: 'other' }, guildId }));
  assert.equal(f.state.resets.length, 0); assert.equal(f.state.replies[0].flags, 64);
});
test('draining stops new messages without accepting paid work', async () => {
  const f = fixture(); await f.handlers.drain(); await f.handlers.messageCreate(f.message('1', 'question'));
  assert.equal(f.state.calls.length, 0);
});
