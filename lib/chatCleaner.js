/**
 * Хранит message_id сообщений бота по chat_id для последующего удаления по кнопке «Очистить чат».
 * В личке бот может удалять только свои сообщения; старые (>48 ч) Telegram может не удалить.
 */

const MAX_MESSAGES_PER_CHAT = 100;

/** @type {Map<number, number[]>} chatId -> messageId[] */
const byChat = new Map();

function trackMessage(chatId, messageId) {
  if (!chatId || !messageId) return;
  let list = byChat.get(chatId);
  if (!list) {
    list = [];
    byChat.set(chatId, list);
  }
  list.push(messageId);
  if (list.length > MAX_MESSAGES_PER_CHAT) list.shift();
}

function getTrackedMessageIds(chatId) {
  return byChat.get(chatId) ?? [];
}

function clearTracked(chatId) {
  byChat.delete(chatId);
}

module.exports = {
  trackMessage,
  getTrackedMessageIds,
  clearTracked,
};
