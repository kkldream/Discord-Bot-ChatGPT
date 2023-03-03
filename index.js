require("dotenv").config();
const {Client, GatewayIntentBits, Collection, Events, TextChannel, Guild, MessageCollector} = require('discord.js');
const {applicationCommands} = require("./commands");
const openai = require("./openaiApi");
const moment = require("moment");

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

    if (interaction.commandName === "ai") {
        await interaction.reply("Input：");
    }
});

client.on(Events.MessageCreate, async message => {
    if (message.author.id === process.env.DISCORD_BOT_CLIENT_ID) return;
    // let {channelId, guildId, id, createdTimestamp, content, author, reference} = message;
    // console.log(message);
    // console.log({channelId, guildId, id, createdTimestamp, content, author, reference});
    let messages = [];
    // let messages = [
    //     {"role": "system", "content": "你是位繁體中文助理"},
    //     {"role": "user", content: message.content}
    // ];
    

    let reference = message.reference;
    let referenceTimestamp = message.createdTimestamp;
    while (reference) {
        let replyMsg = await message.channel.messages.fetch(reference.messageId);
        if (messages.length === 0 && replyMsg.author.id !== process.env.DISCORD_BOT_CLIENT_ID) break;
        messages.unshift({
            role: replyMsg.author.id === process.env.DISCORD_BOT_CLIENT_ID ? "assistant" : "user",
            content: replyMsg.author.id === process.env.DISCORD_BOT_CLIENT_ID ? replyMsg.content.slice((replyMsg.content.indexOf("\n") + 2)) : replyMsg.content
        });
        reference = replyMsg.reference;
        referenceTimestamp = replyMsg.createdTimestamp;
    }
    messages.unshift({"role": "system", "content": "你是一位助理，預設回答使用繁體中文"});
    messages.push({"role": "user", content: message.content});
    let response = await openai.chat(messages);
    console.log(`token = ${response.usage.total_tokens}`);
    console.log(messages);
    // let formattedDate = moment(referenceTimestamp).format("MM/DD, hh:mm:ss");
    await message.reply(`[此次請求預估花費${response.usage.total_tokens / 1000 * 0.002}美元]\n${response.message.content}`);
});

client.login(process.env.DISCORD_BOT_TOKEN);
