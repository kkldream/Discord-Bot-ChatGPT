'use strict';
// Requiring this module must never load .env, connect, register commands, or log in.
async function main() {
  require('dotenv').config({ quiet: true });
  const { loadConfig } = require('./lib/config');
  const config = loadConfig();
  if (process.argv.includes('--check-config')) { console.log('Configuration valid (no external connections).'); return; }
  const { createRuntime } = require('./lib/runtime');
  const runtime = createRuntime(config);
  const shutdown = () => {
    const deadline = setTimeout(() => { process.exit(1); }, config.shutdownMs);
    deadline.unref();
    void runtime.stop().then(() => { clearTimeout(deadline); }, () => { clearTimeout(deadline); process.exitCode = 1; });
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  try { await runtime.start(); }
  catch (error) { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); throw error; }
}
if (require.main === module) {
  void main().catch(error => { require('./lib/errors').errorEnvelope(error); process.exitCode = 1; });
}
module.exports = { main };
