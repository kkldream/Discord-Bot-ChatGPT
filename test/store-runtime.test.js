'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Partials, GatewayIntentBits } = require('discord.js');
const { ConversationStore } = require('../lib/store');
const { clientOptions, createRuntime } = require('../lib/runtime');
const MongodbClient = require('../db');
const { applicationCommands } = require('../commands');
const { config, userId, response } = require('./helpers');
const session = () => ({ _id: 'session', userId, mode: 'init', messages: [{ role: 'system', content: 'system' }] });
test('B03: real Discord client options include Channel partial and DM intents', () => {
  const options = clientOptions(); assert.ok(options.partials.includes(Partials.Channel));
  assert.ok(options.intents.includes(GatewayIntentBits.DirectMessages));
  assert.deepEqual(options.allowedMentions.parse, []); assert.equal(options.rest.retries, 0);
});
test('importing every public entrypoint does not load env, register commands, or connect', () => {
  const before = process.listenerCount('SIGTERM');
  for (const path of ['../index', '../commands', '../db', '../openaiApi', '../scripts/register-commands']) assert.doesNotThrow(() => require(path));
  assert.equal(process.listenerCount('SIGTERM'), before);
});
test('command registration upserts only /ai, never bulk-overwrites other commands', async () => {
  const calls = [];
  await applicationCommands({ token: 'offline', applicationId: userId, guildId: '200000000000000001', rest: {
    post: async (...args) => calls.push(args), put: async () => { throw new Error('bulk overwrite prohibited'); },
  } });
  assert.equal(calls.length, 1); assert.match(calls[0][0], /guilds/); assert.equal(calls[0][1].body.name, 'ai');
});
test('getActive refuses ambiguous legacy sessions rather than choosing arbitrarily', async () => {
  let limit;
  const store = new ConversationStore({ dmChannelCol: { find: () => ({ limit: value => {
    limit = value; return { toArray: async () => [session(), session()] }; } }) } });
  await assert.rejects(store.getActive(userId), error => error.code === 'CONFLICT'); assert.equal(limit, 2);
});
test('B04: append uses atomic push and compare-and-set, including legacy documents with no version', async () => {
  let call;
  const store = new ConversationStore({ dmChannelCol: { updateOne: async (...args) => { call = args; return { matchedCount: 1 }; } } });
  await store.append(session(), 'message-1', 'question', response());
  assert.deepEqual(call[0].version, { $exists: false }); assert.equal(call[0].eventIds.$ne, 'message-1');
  assert.equal(call[1].$set.messages, undefined); assert.equal(call[1].$push.messages.$each.length, 2);
  assert.equal(call[1].$inc.version, 1); assert.equal(call[1].$inc.usageTokensTotal, 2);
  assert.equal(call[1].$push.eventIds.$slice, -1000);
});
test('optimistic write conflict is reported without overwriting another writer', async () => {
  const store = new ConversationStore({ dmChannelCol: { updateOne: async () => ({ matchedCount: 0 }) } });
  await assert.rejects(store.append({ ...session(), version: 3 }, 'message', 'question', response()), error => error.code === 'CONFLICT');
});
test('persisted duplicate message does not execute a database write', async () => {
  const store = new ConversationStore({});
  assert.equal(await store.append({ ...session(), eventIds: ['same'] }, 'same', 'question', response()), false);
});
test('session document ceiling rejects new data without deleting history', async () => {
  const store = new ConversationStore({});
  await assert.rejects(store.append({ ...session(), messages: [{ role: 'system', content: 'x'.repeat(9 * 1024 * 1024) }] },
    'message', 'question', response()), error => error.code === 'SESSION_LIMIT');
});
test('reset insert failure never retires the existing working session', async () => {
  let retired = false; let userUpdate;
  const store = new ConversationStore({ userCol: { updateOne: async (_filter, update) => { userUpdate = update; } }, dmChannelCol: {
    findOne: async () => null, insertOne: async () => { throw new Error('insert failed'); },
    updateMany: async () => { retired = true; },
  } });
  await assert.rejects(store.reset({ id: userId, username: 'offline' }, 'event', 'system'));
  assert.equal(retired, false); assert.equal(userUpdate.$setOnInsert.userId, userId);
});
test('serialized reset preserves old documents and retires only other active sessions', async () => {
  let retired;
  const store = new ConversationStore({ userCol: { updateOne: async () => {} }, dmChannelCol: {
    findOne: async () => null, insertOne: async () => ({ insertedId: 'new' }), updateMany: async filter => { retired = filter; },
  } });
  const created = await store.reset({ id: userId, username: 'offline' }, 'event', 'system');
  assert.equal(created._id, 'new'); assert.equal(retired._id.$ne, 'new'); assert.equal(retired.userId, userId);
});
test('duplicate reset event returns original session without creating another', async () => {
  const expected = { ...session(), resetEventId: 'event' };
  const store = new ConversationStore({ dmChannelCol: { findOne: async () => expected } });
  assert.equal(await store.reset({ id: userId }, 'event', 'system'), expected);
});
test('database constructor is lazy and close is awaitable', async () => {
  const calls = [];
  const fake = { connect: async () => calls.push('connect'), close: async () => calls.push('close'),
    db: name => ({ collection: collection => ({ name, collection }), command: async () => calls.push('ping') }) };
  const db = new MongodbClient('mongodb://127.0.0.1:27017', 'offline', { client: fake });
  assert.deepEqual(calls, []); await db.connect(); assert.equal(db.userCol.collection, 'user');
  await db.ping(); await db.close(); assert.deepEqual(calls, ['connect', 'ping', 'close']);
});
function runtimeFixture(failAt) {
  const calls = [];
  const db = { connect: async () => { calls.push('db.connect'); if (failAt === 'db') throw new Error('offline failure'); },
    ping: async () => {}, close: async () => calls.push('db.close') };
  const client = { user: { id: 'bot' }, on: () => {}, isReady: () => true,
    login: async () => { calls.push('login'); if (failAt === 'login') throw new Error('offline failure'); },
    destroy: async () => calls.push('destroy') };
  const server = new (require('node:events').EventEmitter)();
  server.listen = (_port, _host, callback) => { server.listening = true; callback(); };
  server.close = callback => { server.listening = false; callback(); };
  const runtime = createRuntime(config({ readinessPort: 0 }), { db, client, store: {}, provider: {}, system: 'system', createServer: () => server,
    logger: { error() {}, info() {} } });
  return { runtime, calls };
}
for (const failAt of ['db', 'login']) {
  test(`startup ${failAt} failure closes partially initialized resources`, async () => {
    const f = runtimeFixture(failAt); assert.deepEqual(f.calls, []);
    await assert.rejects(f.runtime.start()); assert.ok(f.calls.includes('db.close')); assert.ok(f.calls.includes('destroy'));
    if (failAt === 'db') assert.ok(!f.calls.includes('login'));
    await f.runtime.stop(); assert.equal(f.calls.filter(c => c === 'db.close').length, 1);
  });
}
test('runtime shutdown is idempotent and never registers commands or warms users', async () => {
  const f = runtimeFixture(); await f.runtime.start(); await Promise.all([f.runtime.stop(), f.runtime.stop()]);
  assert.deepEqual(f.calls, ['db.connect', 'login', 'destroy', 'db.close']);
});
test('Docker and Jenkins have explicit build inputs and no automatic production cutover', () => {
  const { readFileSync } = require('node:fs');
  const docker = readFileSync('Dockerfile', 'utf8'); const jenkins = readFileSync('Jenkinsfile', 'utf8');
  assert.match(docker, /node:24\.21\.0-bookworm-slim@sha256:[a-f0-9]{64}/);
  assert.match(docker, /USER node/); assert.doesNotMatch(docker, /COPY \. \./);
  assert.doesNotMatch(jenkins, /credentialsId|docker rm -f|BRANCH_NAME.*BUILD_NUMBER/);
  assert.ok(jenkins.indexOf("stage('Verify')") < jenkins.indexOf("stage('Candidate image')"));
});
