'use strict';
// Read only audited source, never import the old live entrypoint.
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const revision = 'fec0daca6695afb2e8024f4e6b6a92f9eb99427b';
const source = file => execFileSync('git', ['show', `${revision}:${file}`], { encoding: 'utf8' });
const index = source('index.js');
const functions = index.slice(index.indexOf('async function actionGuildTextChannel'), index.indexOf('(async () => {'));
function handlers(extra = {}) {
  const context = vm.createContext({ console: { error() {} }, botClient: { user: { id: 'bot' } },
    stringValue: { chatGptSystemMessage: 'system' }, dmChannelMode: { running: 'running', finish: 'finish' },
    getDiscordMsgHeader: (_token, _cost, content) => content, ...extra });
  vm.runInContext(functions, context);
  return context;
}
for (const text of ['Hello', 'first\nsecond', 'first\n\nsecond']) {
  test(`B01: preserve complete assistant body ${JSON.stringify(text)}`, async () => {
    let sent;
    const h = handlers({ openai: { msgRole: { assistant: 'assistant', user: 'user' }, chat: async messages => {
      sent = messages; return { message: 'answer' };
    } } });
    const chain = {
      reply: { author: { id: 'bot' }, content: text, reference: { messageId: 'question' } },
      question: { author: { id: 'user' }, content: 'question', reference: { messageId: 'seed' } },
      seed: { author: { id: 'bot' }, content: '[seed]', reference: null },
    };
    await h.actionGuildTextChannel({ reference: { messageId: 'reply' }, content: 'next',
      channel: { messages: { fetch: async id => chain[id] } }, reply: async () => ({ edit: async () => {} }) });
    assert.equal(sent.find(m => m.role === 'assistant').content, text);
  });
}
test('B02: preserve transport error instead of throwing TypeError', async () => {
  const transport = new Error('network unavailable');
  const context = { module: { exports: {} }, process: { env: {} }, require: name => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'openai') return { Configuration: class {}, OpenAIApi: class {
      async createChatCompletion() { throw transport; }
    } };
    throw new Error('Unexpected dependency');
  } };
  vm.runInNewContext(source('openaiApi.js'), context);
  await assert.rejects(context.module.exports.chat([]), error => error === transport || error.cause === transport);
});
test('B04: concurrent DM retains both rounds', async () => {
  let doc = { _id: 'session', messages: [{ role: 'system', content: 'system' }] };
  const h = handlers({ dbClient: { dmChannelCol: {
    findOne: async () => structuredClone(doc), updateOne: async (_filter, update) => { doc = { ...doc, ...update.$set }; },
  } }, openai: { msgRole: { user: 'user', assistant: 'assistant' }, chat: async () => ({ message: 'answer', token: 1 }) } });
  const message = content => ({ content, createdTimestamp: 0,
    author: { id: 'user', send: async () => ({ edit: async () => {} }) } });
  await Promise.all([h.actionDmTextChannel(message('one')), h.actionDmTextChannel(message('two'))]);
  assert.deepEqual(Array.from(doc.messages.filter(m => m.role === 'user'), m => m.content), ['one', 'two']);
});
test('B09: long output uses Discord-safe payload', () => {
  const context = vm.createContext({});
  vm.runInContext(index.slice(index.indexOf('function getDiscordMsgHeader')), context);
  const payload = context.getDiscordMsgHeader(1, 0, '😀'.repeat(1500));
  assert.ok(typeof payload === 'object' || payload.length <= 2000);
});
