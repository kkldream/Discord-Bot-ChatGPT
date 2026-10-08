'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { connect, clear, close, user, response } = require('./fixture.cjs');
let db; let store;
before(async () => { ({ db, store } = await connect('store')); });
beforeEach(async () => clear(db));
after(async () => { if (db) await close(db); });

test('MongoDB：reset → append → 持久化去重保留全文、版本與用量', async () => {
  const session = await store.reset(user, 'reset-1', '測試系統訊息');
  assert.equal(session.version, 0);
  assert.equal(session.mode, 'init');
  assert.ok(session._id);
  assert.equal(await db.userCol.countDocuments({ userId: user.id }), 1);
  assert.equal(await store.append(session, 'message-1', '第一問', response('第一行\n\n第二行')), true);
  const saved = await store.getActive(user.id);
  assert.equal(saved.mode, 'running');
  assert.equal(saved.version, 1);
  assert.equal(saved.usageTokensTotal, 2);
  assert.equal(saved.usageToken, 2);
  assert.equal(saved.lastUsage.provider, 'fixture');
  assert.equal(saved.lastUsage.estimatedUsd, null);
  assert.deepEqual(saved.messages, [{ role: 'system', content: '測試系統訊息' },
    { role: 'user', content: '第一問' }, { role: 'assistant', content: '第一行\n\n第二行' }]);
  assert.deepEqual(saved.eventIds, ['message-1']);
  assert.ok(saved.updateTime instanceof Date);
  assert.equal(await store.append(saved, 'message-1', '不應寫入', response('不應寫入')), false);
  // stale snapshot 未看見 eventId 時，MongoDB filter 必須拒絕再次寫入。
  await assert.rejects(store.append(session, 'message-1', '不應寫入', response()), { code: 'CONFLICT' });
  assert.deepEqual(await store.getActive(user.id), saved);
  assert.equal((await store.reset(user, 'reset-1', '不應重置'))._id.toString(), saved._id.toString());
  assert.equal(await db.dmChannelCol.countDocuments({}), 1);
});

test('MongoDB：序列 reset 完成舊 session、不刪歷史且不影響其他使用者', async () => {
  const prior = await store.reset(user, 'old-reset', '舊系統訊息');
  await store.append(prior, 'old-message', '舊問題', response('舊答案'));
  const otherUser = { ...user, id: '100000000000000002' };
  const other = await store.reset(otherUser, 'other-reset', '別人的系統訊息');
  const latest = await store.reset(user, 'new-reset', '新系統訊息');
  const retired = await db.dmChannelCol.findOne({ _id: prior._id });
  assert.equal(retired.mode, 'finish');
  assert.equal(retired.messages.length, 3);
  assert.equal((await store.getActive(user.id))._id.toString(), latest._id.toString());
  assert.equal((await store.getActive(otherUser.id))._id.toString(), other._id.toString());
  assert.equal((await store.reset(user, 'old-reset', '不應復活')).mode, 'finish');
  assert.equal(await db.dmChannelCol.countDocuments({ userId: user.id }), 2);
  assert.equal(await db.userCol.countDocuments({ userId: user.id }), 1);
});

test('MongoDB：兩個相同版本 snapshot 競寫只能一勝，另一個必須 CONFLICT', async () => {
  await store.reset(user, 'race-reset', '競寫系統訊息');
  const first = await store.getActive(user.id);
  const second = await store.getActive(user.id);
  assert.notEqual(first, second);
  assert.equal(first.version, second.version);
  const results = await Promise.allSettled([
    store.append(first, 'race-a', '問題 A', response('答案 A')),
    store.append(second, 'race-b', '問題 B', response('答案 B')),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1, 'CAS 必須只允許一個 writer');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'CONFLICT');
  const saved = await store.getActive(user.id);
  assert.equal(saved.version, 1);
  assert.equal(saved.messages.length, 3);
  assert.equal(saved.eventIds.length, 1);
  assert.equal(saved.usageTokensTotal, 2);
  const winner = saved.eventIds[0] === 'race-a' ? 'A' : 'B';
  assert.equal(saved.messages[1].content, `問題 ${winner}`);
  assert.equal(saved.messages[2].content, `答案 ${winner}`);
});

test('MongoDB：legacy 缺 version 的首輪 CAS 升為 1，舊 snapshot 不可再寫', async () => {
  await db.dmChannelCol.insertOne({ userId: user.id, mode: 'init', messages: [{ role: 'system', content: '舊系統' }] });
  const first = await store.getActive(user.id);
  const stale = await store.getActive(user.id);
  assert.equal(Object.hasOwn(first, 'version'), false);
  await store.append(first, 'legacy-a', '舊格式第一問', response());
  await assert.rejects(store.append(stale, 'legacy-b', '不應寫入', response()), { code: 'CONFLICT' });
  const saved = await store.getActive(user.id);
  assert.equal(saved.version, 1);
  assert.equal(saved.usageTokensTotal, 2);
  assert.deepEqual(saved.eventIds, ['legacy-a']);
  assert.equal(saved.messages.length, 3);
});

test('MongoDB：重複 active session 拒絕選取且不擅自修復資料', async () => {
  await db.dmChannelCol.insertMany(['init', 'running'].map(mode => ({ userId: user.id, mode, messages: [] })));
  const before = await db.dmChannelCol.find({}).sort({ _id: 1 }).toArray();
  await assert.rejects(store.getActive(user.id), { code: 'CONFLICT' });
  assert.deepEqual(await db.dmChannelCol.find({}).sort({ _id: 1 }).toArray(), before);
});

test('MongoDB：reply／seed 讀取按 channel 隔離，其他 kind 不可作上下文', async () => {
  await store.saveReply('reply-1', 'channel-a', '完整回覆\n第二行');
  assert.equal((await store.getReply('reply-1', 'channel-a')).content, '完整回覆\n第二行');
  assert.equal(await store.getReply('reply-1', 'channel-b'), null);
  await store.saveReply('seed-1', 'channel-a', '', 'seed');
  assert.equal((await store.getReply('seed-1', 'channel-a')).kind, 'seed');
  await store.saveReply('other-1', 'channel-a', '不可作上下文', 'other');
  assert.equal(await store.getReply('other-1', 'channel-a'), null);
  await store.saveReply('reply-1', 'channel-a', '更新全文');
  assert.equal(await db.tempCol.countDocuments({ _id: 'reply-1' }), 1);
  assert.equal((await store.getReply('reply-1', 'channel-a')).content, '更新全文');
});
