'use strict';
const http = require('node:http');
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const MongodbClient = require('../db');
const { ConversationStore } = require('./store');
const { createProvider } = require('./providers');
const { createHandlers } = require('./bot');
const { allowedMentions } = require('./messages');
const { AppError, errorEnvelope } = require('./errors');
function clientOptions() {
  return { intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel], allowedMentions, rest: { timeout: 10000, retries: 0 } };
}
function createRuntime(config, dependencies = {}) {
  const logger = dependencies.logger || console;
  const client = dependencies.client || new Client(clientOptions());
  const db = dependencies.db || new MongodbClient(config.mongoUrl, config.dbName);
  const store = dependencies.store || new ConversationStore(db);
  const provider = dependencies.provider || createProvider(config, dependencies.providerOptions);
  const system = dependencies.system ?? require('../stringValue').chatGptSystemMessage;
  const controller = new AbortController();
  const handlers = createHandlers({ client, store, provider, config, system, logger, signal: controller.signal });
  let connected = false; let stopping = false; let stopPromise; let startup; let startPromise;
  const server = (dependencies.createServer || http.createServer)((request, response) => {
    const check = async () => {
      if (request.url !== '/readyz') { response.writeHead(404).end(); return; }
      let ready = connected && !stopping && client.isReady();
      if (ready) { try { await db.ping(); } catch { ready = false; } }
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ready }));
    };
    void check().catch(() => { if (!response.writableEnded) response.writeHead(503).end(); });
  });
  function stop() {
    if (stopPromise) return stopPromise;
    stopping = true;
    const drained = handlers.drain();
    stopPromise = (async () => {
      const abortTimer = setTimeout(() => controller.abort(), Math.max(1, config.shutdownMs - 5000));
      abortTimer.unref();
      let cleanupError;
      try {
        // Await the raw startup, not its cleanup wrapper, to avoid a rejection deadlock.
        // A signal received while Mongo connects must not allow a later Discord login.
        if (startup) await Promise.allSettled([startup]);
        await drained;
      } finally {
        clearTimeout(abortTimer); connected = false;
        const results = await Promise.allSettled([
          Promise.resolve().then(() => client.destroy()),
          Promise.resolve().then(() => db.close()),
          new Promise((resolve, reject) => {
            if (server.listening) server.close(error => error ? reject(error) : resolve()); else resolve();
          }),
        ]);
        const failures = results.filter(result => result.status === 'rejected');
        for (const result of failures) errorEnvelope(result.reason, logger);
        if (failures.length) cleanupError = new AppError('UNEXPECTED', { cause: failures[0].reason });
      }
      if (cleanupError) throw cleanupError;
    })();
    return stopPromise;
  }
  function start() {
    if (startPromise) return startPromise;
    startup = (async () => {
      if (stopping) return;
      await db.connect(); connected = true;
      if (stopping) return;
      handlers.attach();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.readinessPort, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
      });
      server.on('error', error => { errorEnvelope(error, logger); });
      if (stopping) return;
      await client.login(config.token);
      if (stopping) return;
      logger.info(JSON.stringify({ event: 'started', node: process.version, provider: config.provider || 'openai', model: config.model }));
      if ((config.provider || 'openai') === 'openai' && ['gpt-4.1-nano', 'gpt-4.1-nano-2025-04-14'].includes(config.model)) {
        logger.info(JSON.stringify({ event: 'model_deprecation', model: config.model, shutdownDate: '2026-10-23' }));
      }
    })();
    startPromise = startup.catch(async error => {
      try { await stop(); } catch { /* Keep the original startup cause; cleanup failures are logged safely. */ }
      throw error;
    });
    return startPromise;
  }
  return { start, stop, handlers };
}
module.exports = { clientOptions, createRuntime };
