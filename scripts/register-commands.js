'use strict';
async function main() {
  if (!process.argv.includes('--confirm-register')) throw new Error('Explicit --confirm-register is required.');
  require('dotenv').config({ quiet: true });
  const { required } = require('../lib/config');
  const applicationId = required(process.env, 'DISCORD_BOT_CLIENT_ID');
  const guildId = process.env.DISCORD_COMMAND_GUILD_ID?.trim();
  if (!/^\d{17,20}$/.test(applicationId) || (guildId && !/^\d{17,20}$/.test(guildId))) throw new Error('Invalid application/guild ID.');
  await require('../commands').applicationCommands({ token: required(process.env, 'DISCORD_BOT_TOKEN'), applicationId, guildId });
  console.log('The /ai command was registered. No bot or database was started.');
}
if (require.main === module) void main().catch(error => { require('../lib/errors').errorEnvelope(error); process.exitCode = 1; });
module.exports = { main };
