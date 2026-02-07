const { getTrackedMessageIds, clearTracked } = require("../lib/chatCleaner");

function registerChatCleanerHandlers(bot) {
  bot.action("chat_clear", async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const messageIds = getTrackedMessageIds(chatId);
    let deleted = 0;
    for (const messageId of messageIds) {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
        deleted++;
      } catch {
        // Сообщение могло быть старше 48 ч или уже удалено — пропускаем
      }
    }
    clearTracked(chatId);

    const text =
      deleted > 0
        ? `🗑 Удалено сообщений бота: ${deleted}. Сообщения старше 48 часов Telegram не удаляет.`
        : "Нечего удалять или сообщения старше 48 часов (их удалить нельзя).";
    return ctx.replyWithHTML(text);
  });
}

module.exports = { registerChatCleanerHandlers };
