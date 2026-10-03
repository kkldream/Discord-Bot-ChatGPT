'use strict';
const { ChannelType, Events } = require('discord.js');
const { AppError, errorEnvelope } = require('./errors');
const { mayUse } = require('./config');
const { KeyedQueue, RequestGate, EventCache } = require('./control');
const { textPayload, responsePayload, boundContext, guildContext, seedMessage, pendingMessage } = require('./messages');
function createHandlers({ client, store, provider, config, system, logger = console, signal }) {
  const queue = new KeyedQueue(config); const gate = new RequestGate(config); const events = new EventCache();
  let stopping = false;
  async function report(error, deliver) {
    const safe = errorEnvelope(error, logger);
    try { await deliver(textPayload(safe.content)); } catch (deliveryError) { errorEnvelope(deliveryError, logger); }
  }
  async function messageCreate(message) {
    let placeholder;
    try {
      if (stopping || !message.author || message.author.bot || message.author.system || message.webhookId) return;
      const isDm = message.channel?.type === ChannelType.DM;
      if (!isDm && (message.channel?.type !== ChannelType.GuildText || !message.reference)) return;
      if (typeof message.content !== 'string' || !message.content.trim()) return;
      // Ignore disallowed message events without feeding bot loops or generating notifications.
      if (!mayUse(config, message.author.id, message.guildId, message.channelId)) return;
      if (!events.claim(message.id)) return;
      await queue.run(message.author.id, async () => {
        let session; let messages;
        if (isDm) {
          session = await store.getActive(message.author.id);
          if (!session) throw new AppError('SESSION');
          if ((session.eventIds || []).includes(message.id)) return;
          messages = boundContext([...session.messages, { role: 'user', content: message.content }], config);
        } else {
          messages = await guildContext(message, client.user.id, store, system, config);
          if (!messages) return;
        }
        await gate.run(message.author.id, async () => {
          placeholder = await message.reply(textPayload(pendingMessage));
          const response = await provider.chat(messages, { signal });
          const payload = responsePayload(response.message, config.maxOutputBytes);
          // Persist before display so an attached answer remains available as future context.
          if (isDm) await store.append(session, message.id, message.content, response);
          else await store.saveReply(placeholder.id, message.channelId, response.message);
          await placeholder.edit(payload);
        });
      });
    } catch (error) {
      await report(error, payload => placeholder ? placeholder.edit(payload) : message.reply(payload));
    }
  }
  async function interactionCreate(interaction) {
    try {
      if (stopping || !interaction.isChatInputCommand() || interaction.commandName !== 'ai' ||
          interaction.user.bot || interaction.user.system) return;
      if (!mayUse(config, interaction.user.id, interaction.guildId, interaction.channelId)) {
        await interaction.reply({ ...textPayload('目前未開放此帳號或頻道使用。'), ...(interaction.guildId ? { flags: 64 } : {}) });
        return;
      }
      if (!events.claim(interaction.id)) return;
      // Defer before queueing: another model request can take longer than Discord's acknowledgement deadline.
      await interaction.deferReply();
      await queue.run(interaction.user.id, async () => {
        if (!interaction.guildId) {
          await store.reset(interaction.user, interaction.id, system);
          await interaction.editReply(textPayload('[已初始化私訊對話。訊息將傳至 OpenAI，並儲存於管理員的資料庫；請勿輸入敏感資訊。]'));
        } else {
          const seed = await interaction.editReply(textPayload(seedMessage));
          await store.saveReply(seed.id, interaction.channelId, '', 'seed');
        }
      });
    } catch (error) {
      await report(error, payload => interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload));
    }
  }
  function attach() {
    // Both handlers own a complete error boundary, including secondary delivery failures.
    client.on(Events.MessageCreate, message => { void messageCreate(message).catch(e => errorEnvelope(e, logger)); });
    client.on(Events.InteractionCreate, interaction => { void interactionCreate(interaction).catch(e => errorEnvelope(e, logger)); });
    client.on(Events.Error, error => { errorEnvelope(error, logger); });
  }
  async function drain() { stopping = true; await queue.drain(); }
  return { messageCreate, interactionCreate, attach, drain, queue };
}
module.exports = { createHandlers };
