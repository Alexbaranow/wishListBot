const { userState } = require("../lib/state");
const { getHelpKeyboard } = require("../lib/keyboards");

function getHelpMessage(owner = true) {
  let msg =
    "❓ <b>Помощь</b>\n\n" +
    "• <b>📋 События</b> — несколько вишлистов (ДР, Новый год и т.д.), у каждого своя ссылка\n" +
    "• <b>🎁 Мой список</b> — список подарков выбранного события (редактирование, удаление)\n" +
    "• <b>➕ Добавить</b> — добавить желание (название, описание, ссылка, приоритет 1–5)\n" +
    "• <b>🔗 Ссылка</b> — ссылка на текущее событие для друзей\n" +
    "• <b>📅 Дедлайн</b> — дата события и напоминание «обнови список» за N дней\n";
  if (!owner) {
    msg +=
      "\nВы смотрите чужой вишлист — можно только выбрать подарок (кнопки под списком).";
  }
  return msg;
}

function registerHelpHandlers(bot) {
  bot.action("owner_help", async (ctx) => {
    await ctx.answerCbQuery();
    const viewing = userState.get(ctx.from.id)?.viewingWishlistId;
    return ctx.replyWithHTML(getHelpMessage(!viewing), getHelpKeyboard(ctx));
  });
}

module.exports = {
  getHelpMessage,
  registerHelpHandlers,
};
