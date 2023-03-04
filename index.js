require("dotenv").config();
const {Client, GatewayIntentBits, Events} = require('discord.js');
const openai = require("./openaiApi");
const {applicationCommands} = require("./commands");

// 伺服器設定指令
applicationCommands().then(res => console.log(res));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 監聽指令訊息
client.on(Events.InteractionCreate, async interaction => {
    if (isDevGuild(interaction.guild) ||!interaction.isChatInputCommand()) return;
    switch (interaction.commandName) {
        case "ai":
            await interaction.reply("[我是你的AI助理，請使用回覆來接續對話]");
            break;
    }
});

// 監聽一般訊息
client.on(Events.MessageCreate, async message => {
    if (isDevGuild(message.guild) ||
        message.author.id === process.env.DISCORD_BOT_CLIENT_ID ||
        !message.reference) return;
    let messages = [];
    let reference = message.reference;
    let referenceTimestamp = message.createdTimestamp;
    let replyMessage;
    while (reference) {
        let replyMsg = await message.channel.messages.fetch(reference.messageId);
        if (messages.length === 0) {
            if (replyMsg.author.id !== process.env.DISCORD_BOT_CLIENT_ID) return;
            else replyMessage = await message.reply("[思考回應中...]");
        }
        messages.unshift({
            role: replyMsg.author.id === process.env.DISCORD_BOT_CLIENT_ID ? "assistant" : "user",
            content: replyMsg.author.id === process.env.DISCORD_BOT_CLIENT_ID ? replyMsg.content.slice((replyMsg.content.indexOf("\n") + 2)) : replyMsg.content
        });
        reference = replyMsg.reference;
        referenceTimestamp = replyMsg.createdTimestamp;
    }
    messages.shift();
    messages.unshift({"role": "system", "content": "你是一位助理，預設回答使用繁體中文"});
    messages.push({"role": "user", content: message.content});
    try {
        let response = await openai.chat(messages);
        console.log(messages);
        let cost = Math.round(response.usage.total_tokens / 1000 * 0.002 * 10000) / 10000;
        await replyMessage.edit(`[此次請求的Token使用量為${response.usage.total_tokens}/4096 `
            + `(${Math.round(response.usage.total_tokens / 4096 * 100)}%)，預估花費${cost}美元 (${cost * 30}台幣)]\n\n`
            + response.message.content)
    } catch (error) {
        console.error(error);
        await replyMessage.edit(`[請求失敗，錯誤訊息如下]\n${error.message}`);
    }
});

function isDevGuild(guild) {
    if (process.env.NODE_ENV === "production") return false;
    else if (!process.env.DISCORD_DEV_GUILD_ID) return false;
    else if (guild.id === process.env.DISCORD_DEV_GUILD_ID) return false;
    else return true;
}

client.login(process.env.DISCORD_BOT_TOKEN).then(() => {
    console.log(`Logged in as ${client.user.tag}!`);
});
