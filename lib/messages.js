'use strict';
const { AppError } = require('./errors');
const allowedMentions = Object.freeze({ parse: [], repliedUser: false, users: [], roles: [] });
const seedMessage = '[已開啟對話，請使用回覆功能接話。]';
const pendingMessage = '[正在等待模型回覆…]';
const attachmentNotice = '[回覆較長，完整內容見 ai-response.txt 附件。]';
function textPayload(content) { return { content, allowedMentions }; }
function responsePayload(content, maxBytes = 262144) {
  if (typeof content !== 'string' || !content.trim()) throw new AppError('EMPTY_OUTPUT');
  if (Buffer.byteLength(content, 'utf8') > maxBytes) throw new AppError('OUTPUT_LIMIT');
  if (content.length <= 2000) return textPayload(content);
  return { ...textPayload(attachmentNotice), files: [{ attachment: Buffer.from(content, 'utf8'), name: 'ai-response.txt' }] };
}
function boundContext(messages, config) {
  const system = messages[0];
  const newest = messages.at(-1);
  if (system?.role !== 'system' || newest?.role !== 'user') throw new AppError('INPUT_LIMIT');
  const size = m => {
    if (!['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') throw new AppError('HISTORY');
    return Buffer.byteLength(m.content, 'utf8') + 64;
  };
  let bytes = size(system) + size(newest);
  if (bytes > config.maxContextBytes) throw new AppError('INPUT_LIMIT');
  const tail = [];
  for (let i = messages.length - 2; i > 0 && tail.length < config.maxContextMessages - 2; i--) {
    const m = messages[i];
    if (m.role === 'system') continue;
    const nextBytes = size(m);
    if (bytes + nextBytes > config.maxContextBytes) break;
    tail.unshift({ role: m.role, content: m.content }); bytes += nextBytes;
  }
  // A truncated history should begin on a user turn, never an orphan assistant.
  while (tail[0]?.role === 'assistant') tail.shift();
  return [{ role: 'system', content: system.content }, ...tail, { role: 'user', content: newest.content }];
}
async function guildContext(message, botId, store, system, config) {
  const history = []; const seen = new Set(); let reference = message.reference;
  for (let depth = 0; reference && depth < config.maxChainDepth; depth++) {
    const id = reference.messageId;
    if (!id || seen.has(id) || (reference.channelId && reference.channelId !== message.channelId)) throw new AppError('HISTORY');
    seen.add(id);
    let previous;
    try { previous = await message.channel.messages.fetch(id); } catch (cause) { throw new AppError('HISTORY', { cause }); }
    if (!previous?.author) throw new AppError('HISTORY');
    if (depth === 0 && previous.author.id !== botId) return null;
    if (previous.author.id === botId) {
      const saved = await store.getReply(id, message.channelId);
      const legacySeed = !previous.reference && /^\[我是.*請使用回覆/.test(previous.content || '');
      if (saved?.kind === 'seed' || previous.content === seedMessage || legacySeed) break;
      if (!saved && (previous.content === attachmentNotice || previous.content === pendingMessage)) throw new AppError('HISTORY');
      // No header slicing: persisted context and Discord display are separate.
      history.unshift({ role: 'assistant', content: saved?.content ?? previous.content });
    } else if (!previous.author.bot && !previous.webhookId) {
      history.unshift({ role: 'user', content: previous.content });
    }
    reference = previous.reference;
  }
  return boundContext([{ role: 'system', content: system }, ...history, { role: 'user', content: message.content }], config);
}
module.exports = { allowedMentions, seedMessage, pendingMessage, attachmentNotice, textPayload, responsePayload, boundContext, guildContext };
