'use strict';
const commands = Object.freeze([{ name: 'ai', description: '開啟新的對話；私訊內容會傳至設定的模型供應商並儲存' }]);
async function applicationCommands({ token, applicationId, guildId, rest }) {
  const { REST, Routes } = require('discord.js');
  rest ||= new REST({ version: '10', timeout: 10000, retries: 0 }).setToken(token);
  const route = guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId);
  // Upsert only our named command. Never bulk overwrite unrelated global commands.
  for (const command of commands) await rest.post(route, { body: command });
}
module.exports = { commands, applicationCommands };
