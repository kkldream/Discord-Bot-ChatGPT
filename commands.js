const {REST, Routes, SlashCommandBuilder} = require("discord.js");

const commands = [
    {name: 'ai', description: '向ChatGPT開新的話題'},
    new SlashCommandBuilder()
        .setName('echo')
        .setDescription('Replies with your input!')
        .addStringOption(option =>
            option.setName('input')
                .setDescription('The input to echo back')),
    new SlashCommandBuilder()
        .setName('image')
        .setDescription('Replies with your input!')
        .addStringOption(option =>
            option.setName('input')
                .setDescription('The input to echo back'))
];

async function applicationCommands() {
    const rest = new REST({version: '10'}).setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.DISCORD_BOT_CLIENT_ID), {body: commands});
}

async function deleteAllCommands() {
    const rest = new REST({version: '10'}).setToken(process.env.DISCORD_BOT_TOKEN);

    // for guild-based commands
    // rest.put(Routes.applicationGuildCommands(process.env.DISCORD_BOT_CLIENT_ID, guildId), { body: [] })
    //     .then(() => console.log('Successfully deleted all guild commands.'))
    //     .catch(console.error);

    // for global commands
    rest.put(Routes.applicationCommands(process.env.DISCORD_BOT_CLIENT_ID), { body: [] })
        .then(() => console.log('Successfully deleted all application commands.'))
        .catch(console.error);
}

module.exports = {
    applicationCommands,
};


