'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
// 只接受專用容器哨兵與固定測試 URI；不讀取使用者的正式 DB 設定。
assert.equal(process.env.HERMES_ISOLATED_ACCEPTANCE, '1', '請使用 npm run test:integration');
const appRequire = createRequire('/app/package.json');
const MongodbClient = appRequire('./db');
const { ConversationStore } = appRequire('./lib/store');
const mongoUrl = 'mongodb://mongo:27017';
const user = { id: '100000000000000001', username: 'isolated-fixture', discriminator: '0' };
function response(message = '隔離假模型回覆') {
  return { message, provider: 'fixture', model: 'fixture-model', token: 2, cost: null,
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    estimate: { isBillingRecord: false } };
}
async function connect(suffix) {
  assert.ok(['store', 'image'].includes(suffix));
  const db = new MongodbClient(mongoUrl, `hermes_issue1_${suffix}`);
  try {
    await db.connect();
    await db.ping();
    const info = await db.client.db('admin').command({ buildInfo: 1 });
    assert.equal(info.version, '8.0.17');
    return { db, store: new ConversationStore(db) };
  } catch (error) { await db.close(); throw error; }
}
async function clear(db) {
  await Promise.all([db.userCol.deleteMany({}), db.dmChannelCol.deleteMany({}), db.tempCol.deleteMany({})]);
}
async function close(db) {
  try { await db.client.db(db.dbName).dropDatabase(); } finally { await db.close(); }
}
module.exports = { appRequire, connect, clear, close, mongoUrl, user, response };
