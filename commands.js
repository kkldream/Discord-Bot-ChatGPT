const {REST, Routes} = require("discord.js");

const commands = [
    {name: 'ai', description: '向ChatGPT開新的話題'},
];

async function applicationCommands() {
    const rest = new REST({version: '10'}).setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.DISCORD_BOT_CLIENT_ID), {body: commands});
    return "Successfully reloaded application (/) commands.";
}

module.exports = {applicationCommands};

