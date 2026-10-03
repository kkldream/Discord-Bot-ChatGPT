'use strict';
const { AppError } = require('./errors');
function required(env, name) {
  const value = env[name]?.trim();
  if (!value || value === '...' || value.startsWith('replace-')) throw new AppError('CONFIG');
  return value;
}
function integer(env, name, fallback, min, max) {
  const text = env[name];
  if (text === undefined || text === '') return fallback;
  if (!/^\d+$/.test(text)) throw new AppError('CONFIG');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AppError('CONFIG');
  return value;
}
function boolean(env, name, fallback = false) {
  if (env[name] === undefined || env[name] === '') return fallback;
  if (!['true', 'false'].includes(env[name])) throw new AppError('CONFIG');
  return env[name] === 'true';
}
function ids(env, name) {
  const values = (env[name] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (values.some(id => !/^\d{17,20}$/.test(id))) throw new AppError('CONFIG');
  return new Set(values);
}
function loadConfig(env = process.env) {
  const mongoUrl = required(env, 'MONGODB_URL');
  const dbName = required(env, 'MONGODB_DB_NAME');
  if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUrl) || /[\/\\. "$*<>:|?\x00]/.test(dbName)) throw new AppError('CONFIG');
  const config = {
    token: required(env, 'DISCORD_BOT_TOKEN'), apiKey: required(env, 'OPENAI_API_KEY'), mongoUrl, dbName,
    model: env.OPENAI_MODEL?.trim() || 'gpt-4.1-nano',
    allowedUsers: ids(env, 'ALLOWED_USER_IDS'), allowedGuilds: ids(env, 'ALLOWED_GUILD_IDS'),
    allowedChannels: ids(env, 'ALLOWED_CHANNEL_IDS'), publicAccess: boolean(env, 'ALLOW_PUBLIC_ACCESS'),
    enableDms: boolean(env, 'ENABLE_DMS', true),
    timeoutMs: integer(env, 'OPENAI_TIMEOUT_MS', 30000, 1000, 120000),
    maxOutputTokens: integer(env, 'MAX_OUTPUT_TOKENS', 2048, 16, 8192),
    maxOutputBytes: integer(env, 'MAX_OUTPUT_BYTES', 262144, 4000, 1048576),
    maxContextBytes: integer(env, 'MAX_CONTEXT_BYTES', 32768, 1024, 262144),
    maxContextMessages: integer(env, 'MAX_CONTEXT_MESSAGES', 41, 3, 101),
    maxChainDepth: integer(env, 'MAX_CHAIN_DEPTH', 40, 1, 100),
    requestsPerMinute: integer(env, 'REQUESTS_PER_MINUTE', 5, 1, 100),
    globalRequestsPerMinute: integer(env, 'GLOBAL_REQUESTS_PER_MINUTE', 60, 1, 1000),
    maxConcurrent: integer(env, 'MAX_CONCURRENT_REQUESTS', 4, 1, 32),
    maxPendingPerUser: integer(env, 'MAX_PENDING_PER_USER', 8, 1, 32),
    maxPendingTotal: integer(env, 'MAX_PENDING_TOTAL', 100, 1, 1000),
    readinessPort: integer(env, 'READINESS_PORT', 8080, 1024, 65535),
    shutdownMs: integer(env, 'SHUTDOWN_TIMEOUT_MS', 45000, 1000, 180000),
  };
  if (!config.publicAccess && !config.allowedUsers.size && !config.allowedGuilds.size) throw new AppError('CONFIG');
  return Object.freeze(config);
}
function mayUse(config, userId, guildId, channelId) {
  if (config.allowedUsers.size && !config.allowedUsers.has(userId)) return false;
  if (!guildId) return config.enableDms && (config.publicAccess || config.allowedUsers.has(userId));
  if (config.allowedGuilds.size && !config.allowedGuilds.has(guildId)) return false;
  if (config.allowedChannels.size && !config.allowedChannels.has(channelId)) return false;
  return config.publicAccess || config.allowedUsers.has(userId) || config.allowedGuilds.has(guildId);
}
module.exports = { loadConfig, mayUse, required };
