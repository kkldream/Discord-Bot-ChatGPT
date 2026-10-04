'use strict';
const { loadConfig } = require('../lib/config');
const userId = '100000000000000001';
const guildId = '200000000000000001';
const channelId = '300000000000000001';
const env = () => ({ DISCORD_BOT_TOKEN: 'offline-discord-token', OPENAI_API_KEY: 'offline-openai-key',
  MONGODB_URL: 'mongodb://127.0.0.1:27017', MONGODB_DB_NAME: 'offline_test', ALLOWED_USER_IDS: userId });
const config = overrides => ({ ...loadConfig(env()), ...overrides });
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = (message = 'answer') => ({ message, model: 'gpt-4.1-nano', token: 2, cost: 0.0000005,
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  estimate: { currency: 'USD', rateDate: '2026-10-04', isBillingRecord: false } });
module.exports = { userId, guildId, channelId, env, config, tick, response };
