require("dotenv").config();
const {Client, GatewayIntentBits, Collection, Events, TextChannel, Guild, MessageCollector} = require('discord.js');
const {applicationCommands} = require("./commands");

// applicationCommands().then(res => console.log(res));
let client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on(Events.InteractionCreate, async interaction => {
    console.log(interaction);
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'ping') {
        await interaction.reply('Pong!');
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.id === process.env.DISCORD_BOT_CLIENT_ID) return;
    let {channelId, guildId, id, createdTimestamp, content, author, reference} = message;
    // console.log(message);
    console.log({channelId, guildId, id, createdTimestamp, content, author, reference});
    message.reply("Hey!");
    while (true) {
        if (!reference) break;
        let replyMsg = await message.channel.messages.fetch(reference.messageId);
        reference = replyMsg.reference;
        console.log({replyMsg: replyMsg.content, author: replyMsg.author.username});
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
