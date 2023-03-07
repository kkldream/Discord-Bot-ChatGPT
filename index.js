require("dotenv").config();
const {Client, GatewayIntentBits, Events, ChannelType} = require('discord.js');
const MongodbClient = require("./db");
const openai = require("./openaiApi");
const {applicationCommands} = require("./commands");
const {dmChannelMode} = require("./constant");
const stringValue = require("./stringValue");

const dbClient = new MongodbClient(process.env.MONGODB_URL);
const botClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageTyping,
    ]
});

// 監聽指令訊息
botClient.on(Events.InteractionCreate, async msg => {
    if (!msg.isChatInputCommand() || msg.user.bot || msg.user.system) return;
    if (!msg.channel) await (await getUserById(msg.user.id)).createDM();
    switch (msg.channel.type) {
        case ChannelType.GuildText:
            switch (msg.commandName) {
                case "ai":
                    await msg.reply("[我是共用的AI助理，請使用回覆來接續對話]");
                    break;
            }
            break;
        case ChannelType.DM:
            switch (msg.commandName) {
                case "ai":
                    const requestTime = new Date(msg.createdTimestamp);
                    await msg.reply("[已初始化對話串內容，請使用回覆來接續對話]");
                    let userDoc = await dbClient.userCol.findOne({userId: msg.user.id});
                    await dbClient.userCol.updateOne({userId: msg.user.id}, {
                        $set: {
                            createTime: userDoc?.createTime ?? requestTime,
                            updateTime: requestTime,
                            userId: msg.user.id,
                            username: msg.user.username,
                            userIndex: msg.user.discriminator
                        }
                    }, {upsert: true});
                    await dbClient.dmChannelCol.updateMany(
                        {userId: msg.user.id, mode: {$ne: dmChannelMode.finish}},
                        {
                            $set: {
                                updateTime: requestTime,
                                mode: dmChannelMode.finish
                            }
                        });
                    await dbClient.dmChannelCol.insertOne({
                        createTime: requestTime,
                        updateTime: requestTime,
                        userId: msg.user.id,
                        mode: dmChannelMode.init,
                        messages: [{role: openai.msgRole.system, content: stringValue.chatGptSystemMessage}],
                        usageToken: 0
                    });
                    break;
            }
            break;
    }
});

// 監聽一般訊息
botClient.on(Events.MessageCreate, async msg => {
    if (msg.author.id === botClient.user.id) return;
    switch (msg.channel.type) {
        case ChannelType.GuildText:
            if (!msg.reference) return;
            await actionGuildTextChannel(msg);
            break;
        case ChannelType.DM:
            await actionDmTextChannel(msg);
            break;
    }
});

async function actionGuildTextChannel(msg) {
    let chatMsgList = [];
    let reference = msg.reference;
    let referenceTimestamp = msg.createdTimestamp;
    let replyMessage;
    while (reference) {
        let replyMsg = await msg.channel.messages.fetch(reference.messageId);
        if (chatMsgList.length === 0) {
            if (replyMsg.author.id !== botClient.user.id) return;
            else replyMessage = await msg.reply("[思考回應中...]");
        }
        chatMsgList.unshift({
            role: replyMsg.author.id === botClient.user.id ? openai.msgRole.assistant : openai.msgRole.user,
            content: replyMsg.author.id === botClient.user.id ? replyMsg.content.slice((replyMsg.content.indexOf("\n") + 2)) : replyMsg.content
        });
        reference = replyMsg.reference;
        referenceTimestamp = replyMsg.createdTimestamp;
    }
    chatMsgList.shift();
    chatMsgList.unshift({role: openai.msgRole.system, content: stringValue.chatGptSystemMessage});
    chatMsgList.push({role: "user", content: msg.content});
    try {
        let response = await openai.chat(chatMsgList);
        let cost = Math.round(response.usage.total_tokens / 1000 * 0.002 * 10000) / 10000;
        await replyMessage.edit(`[此次請求的Token使用量為${response.usage.total_tokens}/4096 `
            + `(${Math.round(response.usage.total_tokens / 4096 * 100)}%)，預估花費${cost}美元 (${cost * 30}台幣)]\n\n`
            + response.message.content)
    } catch (e) {
        console.error(e);
        await replyMessage.edit(`[請求失敗，錯誤訊息如下]\n${e.message}`);
    }
}

async function actionDmTextChannel(msg) {
    const requestTime = new Date(msg.createdTimestamp);
    const sendMsg = await msg.author.send("[思考回應中...]");
    const dmChannelDoc = await dbClient.dmChannelCol.findOne({
        userId: msg.author.id,
        mode: {$ne: dmChannelMode.finish}
    });
    if (!dmChannelDoc) {
        await sendMsg.edit("[發生錯誤，請輸入指令`/ai`來初始化對話串]")
        return;
    }
    const chatMsgList = [
        ...dmChannelDoc.messages,
        {role: openai.msgRole.user, content: msg.content}
    ];
    let response;
    try {
        response = await openai.chat(chatMsgList);
    } catch (e) {
        console.error(e);
        await sendMsg.edit(`[發生錯誤，請輸入指令\`/ai\`來初始化對話串，錯誤訊息如下]\n${e.message}`);
        return;
    }
    await dbClient.dmChannelCol.updateOne({_id: dmChannelDoc._id}, {
        $set: {
            createTime: dmChannelDoc?.createTime ?? requestTime,
            updateTime: requestTime,
            userId: msg.author.id,
            mode: dmChannelMode.running,
            messages: [
                ...chatMsgList,
                {role: openai.msgRole.assistant, content: response.message.content}
            ],
            usageToken: response.usage.total_tokens
        }
    }, {upsert: true});
    const cost = Math.round(response.usage.total_tokens / 1000 * 0.002 * 10000) / 10000;
    await sendMsg.edit(`[此次請求的Token使用量為${response.usage.total_tokens}/4096 `
        + `(${Math.round(response.usage.total_tokens / 4096 * 100)}%)，預估花費${cost}美元 (${cost * 30}台幣)]\n\n`
        + response.message.content)
}

(async () => {
    // 伺服器設定指令
    await applicationCommands();
    console.log("已建立\"/\"命令");
    // DB連線
    try {
        await dbClient.connect();
        console.log("資料庫連線成功");
    } catch (e) {
        throw new Error("資料庫連線失敗");
    }
    // Bot連線
    await botClient.login(process.env.DISCORD_BOT_TOKEN);
    console.log(`Logged in as ${botClient.user.tag}!`);
    let userDocList = await dbClient.userCol.find({}).toArray();
    userDocList.map(userDoc => {
        getUserById(userDoc.userId).then(async user => {
            await user.createDM();
            console.log(`已建立 ${userDoc.username}#${userDoc.userIndex} 的文字頻道`);
        });
    })

})()

async function getUserById(userId) {
    return await botClient.users.fetch(userId);
}
