'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readdirSync } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const { appRequire, connect, close, mongoUrl, user, response } = require('./fixture.cjs');
const exec = promisify(execFile);

test('Docker daemon context：排除合成 .env／備份，保留兩個 provider', () => {
  for (const excluded of ['.env', 'lib/context-canary.backup', 'lib/providers/context-canary.backup', 'scripts/context-canary.backup']) {
    assert.equal(existsSync(`/context-proof/${excluded}`), false, excluded);
  }
  assert.equal(existsSync('/context-proof/lib/providers/index.js'), true);
  assert.equal(existsSync('/context-proof/lib/providers/gemini.js'), true);
});

test('實際 image：非 root、固定 Node／npm、production-only 依賴與 COPY 白名單', async () => {
  assert.equal(process.getuid(), 1000);
  assert.equal(process.version, 'v24.21.0');
  assert.equal((await exec('npm', ['--version'])).stdout.trim(), '11.19.0');
  assert.deepEqual(readdirSync('/app').sort(), ['.npmrc', 'commands.js', 'constant.js', 'db.js', 'index.js', 'lib',
    'node_modules', 'openaiApi.js', 'package-lock.json', 'package.json', 'scripts', 'stringValue.js'].sort());
  assert.deepEqual(readdirSync('/app/scripts'), ['healthcheck.js']);
  assert.deepEqual(readdirSync('/app/lib').sort(), ['bot.js', 'config.js', 'control.js', 'errors.js', 'messages.js',
    'providers', 'runtime.js', 'store.js'].sort());
  assert.deepEqual(readdirSync('/app/lib/providers').sort(), ['gemini.js', 'index.js']);
  for (const excluded of ['.env', '.git', 'test', 'docs', 'node_modules/eslint']) {
    assert.equal(existsSync(`/app/${excluded}`), false, excluded);
  }
});

test('實際 image：缺設定的真正 entrypoint 回報 CONFIG，未進入登入流程', async () => {
  await assert.rejects(exec(process.execPath, ['/app/index.js'], {
    env: { PATH: process.env.PATH }, timeout: 10000,
  }), error => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /"code":"CONFIG"/);
    assert.doesNotMatch(error.stderr, /MODULE_NOT_FOUND|started|offline-discord/);
    return true;
  });
});

test('實際 image：兩個 provider 的設定與公開模組完整載入，不呼叫模型', () => {
  const { loadConfig } = appRequire('./lib/config');
  const { createProvider } = appRequire('./lib/providers');
  const env = { DISCORD_BOT_TOKEN: 'offline-discord-token', OPENAI_API_KEY: 'offline-openai-key',
    GEMINI_API_KEY: 'offline-gemini-key', MONGODB_URL: mongoUrl, MONGODB_DB_NAME: 'hermes_issue1_image',
    ALLOWED_USER_IDS: user.id };
  const deniedFetch = () => { throw new Error('此測試不可呼叫外部模型'); };
  for (const provider of ['openai', 'gemini']) {
    const config = loadConfig({ ...env, AI_PROVIDER: provider, GEMINI_MODEL: 'gemini-fixture' });
    assert.equal(typeof createProvider(config, { fetch: deniedFetch }).chat, 'function');
  }
  for (const path of ['./index', './commands', './db', './openaiApi', './lib/runtime']) {
    assert.doesNotThrow(() => appRequire(path));
  }
});

test('實際 image＋MongoDB：假 Discord／模型的 DM、readiness 探針與 stop', { timeout: 20000 }, async t => {
  const { db } = await connect('image');
  const { createRuntime } = appRequire('./lib/runtime');
  const { loadConfig } = appRequire('./lib/config');
  const { ChannelType } = appRequire('discord.js');
  const calls = []; const edits = []; let ready = false; let server;
  const client = new EventEmitter();
  client.user = { id: '400000000000000001' };
  client.isReady = () => ready;
  client.login = async token => { assert.equal(token, 'offline-discord-token'); calls.push('假登入'); ready = true; };
  client.destroy = async () => { calls.push('destroy'); ready = false; };
  const config = { ...loadConfig({ DISCORD_BOT_TOKEN: 'offline-discord-token', OPENAI_API_KEY: 'offline-openai-key',
    MONGODB_URL: mongoUrl, MONGODB_DB_NAME: db.dbName, ALLOWED_USER_IDS: user.id }), readinessPort: 0 };
  const runtime = createRuntime(config, { db, client, system: '隔離測試系統訊息',
    provider: { chat: async messages => {
      calls.push('假模型'); assert.equal(messages.at(-1).content, '隔離問題'); return response('隔離答案');
    } }, logger: { info() {}, error() {} },
    createServer: handler => { server = http.createServer(handler); return server; } });
  t.after(async () => {
    try { await runtime.stop(); } finally { await db.connect(); await close(db); }
  });
  await runtime.start();
  const port = server.address().port;
  const readyz = () => fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(3000) });
  assert.equal((await readyz()).status, 200);
  await exec(process.execPath, ['/app/scripts/healthcheck.js'], { env: { READINESS_PORT: String(port) }, timeout: 5000 });
  await runtime.handlers.interactionCreate({ id: 'image-reset', user, guildId: null, channelId: 'dm-channel',
    isChatInputCommand: () => true, commandName: 'ai', deferReply: async () => {}, editReply: async payload => edits.push(payload) });
  await runtime.handlers.messageCreate({ id: 'image-message', author: user, guildId: null, channelId: 'dm-channel',
    channel: { type: ChannelType.DM }, content: '隔離問題',
    reply: async () => ({ id: 'image-placeholder', edit: async payload => edits.push(payload) }) });
  const saved = await db.dmChannelCol.findOne({ userId: user.id });
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.messages.map(message => message.content), ['隔離測試系統訊息', '隔離問題', '隔離答案']);
  assert.equal(edits.at(-1).content, '隔離答案');
  assert.deepEqual(calls, ['假登入', '假模型']);
  ready = false;
  assert.equal((await readyz()).status, 503);
  await assert.rejects(exec(process.execPath, ['/app/scripts/healthcheck.js'], { env: { READINESS_PORT: String(port) }, timeout: 5000 }), { code: 1 });
  ready = true;
  // 關閉真實 MongoClient 證明 DB 不可用時 fail-closed；不是正式 server 故障演練。
  await db.close();
  assert.equal((await readyz()).status, 503);
  assert.deepEqual(calls, ['假登入', '假模型']);
  await Promise.all([runtime.stop(), runtime.stop()]);
  assert.equal(server.listening, false);
  assert.deepEqual(calls, ['假登入', '假模型', 'destroy']);
});
