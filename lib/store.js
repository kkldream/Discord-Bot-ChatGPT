'use strict';
const { BSON } = require('mongodb');
const { AppError } = require('./errors');
const activeModes = ['init', 'running'];
class ConversationStore {
  constructor(db) { this.db = db; }
  async getActive(userId) {
    const sessions = await this.db.dmChannelCol.find({ userId, mode: { $in: activeModes } }).limit(2).toArray();
    // Existing duplicates need operator reconciliation, not arbitrary selection/data deletion.
    if (sessions.length > 1) throw new AppError('CONFLICT');
    return sessions[0] || null;
  }
  async reset(user, eventId, system) {
    const prior = await this.db.dmChannelCol.findOne({ userId: user.id, resetEventId: eventId });
    if (prior) return prior;
    const now = new Date();
    await this.db.userCol.updateOne({ userId: user.id }, {
      $set: { username: user.username, userIndex: user.discriminator, updateTime: now },
      $setOnInsert: { userId: user.id, createTime: now },
    }, { upsert: true });
    const document = { userId: user.id, createTime: now, updateTime: now, mode: 'init',
      resetEventId: eventId, version: 0, messages: [{ role: 'system', content: system }],
      eventIds: [], usageToken: 0, usageTokensTotal: 0 };
    // Called only in the same user's queue. Insert first so an insert failure cannot
    // close the working session. A failure retiring old sessions fails closed via getActive.
    // Multi-process reset / unique active index require the separately approved migration.
    const inserted = await this.db.dmChannelCol.insertOne(document);
    document._id = inserted.insertedId;
    await this.db.dmChannelCol.updateMany({ userId: user.id, _id: { $ne: document._id }, mode: { $in: activeModes } },
      { $set: { mode: 'finish', updateTime: now } });
    return document;
  }
  async append(session, eventId, question, response) {
    if ((session.eventIds || []).includes(eventId)) return false;
    const round = [{ role: 'user', content: question }, { role: 'assistant', content: response.message }];
    if (BSON.calculateObjectSize({ ...session, messages: [...session.messages, ...round] }) > 8 * 1024 * 1024) throw new AppError('SESSION_LIMIT');
    const result = await this.db.dmChannelCol.updateOne({ _id: session._id, userId: session.userId,
      mode: { $in: activeModes }, version: session.version ?? { $exists: false }, eventIds: { $ne: eventId } }, {
      $push: { messages: { $each: round }, eventIds: { $each: [eventId], $slice: -1000 } },
      $inc: { version: 1, usageTokensTotal: response.token || 0 },
      $set: { mode: 'running', updateTime: new Date(), usageToken: response.token,
        lastUsage: { provider: response.provider || 'openai', model: response.model, usage: response.usage, estimatedUsd: response.cost, ...response.estimate } },
    });
    if (result.matchedCount !== 1) throw new AppError('CONFLICT');
    return true;
  }
  async getReply(id, channelId) {
    return this.db.tempCol.findOne({ _id: id, channelId, kind: { $in: ['reply', 'seed'] } });
  }
  async saveReply(id, channelId, content, kind = 'reply') {
    await this.db.tempCol.updateOne({ _id: id }, { $set: { channelId, content, kind, updateTime: new Date() } }, { upsert: true });
  }
}
module.exports = { ConversationStore };
