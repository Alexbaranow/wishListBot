const { Markup } = require("telegraf");
const db = require("../db");
const { userState } = require("../lib/state");
const { escapeHtml, formatGiftLine, formatEventDate } = require("../lib/utils");
const {
  getOwnerKeyboard,
  choiceInlineButtons,
  ownerListKeyboard,
  ownerInlineButtonsDefault,
} = require("../lib/keyboards");

async function sendOwnerEventsList(ctx) {
  const lists = await db.listUserWishlists(ctx.from.id);
  if (!lists.length) {
    return ctx.replyWithHTML(
      "У вас пока нет событий. Нажмите «Создать свой вишлист».",
      choiceInlineButtons
    );
  }
  const rows = lists.map((w) => [
    Markup.button.callback(
      `🎂 ${w.title.slice(0, 28)}${w.title.length > 28 ? "…" : ""}`,
      `event_${w.id}`
    ),
  ]);
  rows.push([Markup.button.callback("➕ Новое событие", "owner_new_event")]);
  const text =
    "📋 <b>Ваши события</b>\n\nВыберите событие, чтобы посмотреть или редактировать список подарков. У каждого события своя ссылка.";
  return ctx.replyWithHTML(text, Markup.inlineKeyboard(rows));
}

async function sendOwnerList(ctx, wishlistId) {
  const state = userState.get(ctx.from.id);
  const wlId =
    wishlistId ??
    state?.currentWishlistId ??
    (await db.getUserWishlistId(ctx.from.id));
  if (!wlId) {
    return sendOwnerEventsList(ctx);
  }
  const meta = await db.getWishlistByIdAndOwner(wlId, ctx.from.id);
  if (!meta) {
    userState.set(ctx.from.id, { ...state, currentWishlistId: null });
    return sendOwnerEventsList(ctx);
  }
  userState.set(ctx.from.id, { ...state, currentWishlistId: wlId });
  const gifts = await db.getGifts(wlId);
  const lines = gifts.map((g, i) => formatGiftLine(g, i));
  let header = `🎁 <b>${escapeHtml(meta.title)}</b>\n\n`;
  if (meta.event_date) {
    const until = formatEventDate(meta.event_date);
    if (until) header += `📅 Дедлайн: ${until}\n\n`;
  }
  const text =
    header + (lines.join("\n\n") || "Пока пусто. Нажми ➕ Добавить подарок.");
  const keyboard =
    gifts.length > 0
      ? ownerListKeyboard(gifts, wlId)
      : Markup.inlineKeyboard([
          [Markup.button.callback("➕ Добавить подарок", "owner_add")],
          [
            Markup.button.callback("🔗 Ссылка", "owner_share"),
            Markup.button.callback("📅 Дедлайн", `event_deadline_${wlId}`),
          ],
          [
            Markup.button.callback("📋 К событиям", "owner_events"),
            Markup.button.callback("❓ Помощь", "owner_help"),
          ],
        ]);
  return ctx.replyWithHTML(text, keyboard);
}

function registerOwnerHandlers(bot) {
  bot.action("owner_list", async (ctx) => {
    await ctx.answerCbQuery();
    return sendOwnerList(ctx);
  });

  bot.action("owner_events", async (ctx) => {
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id) || {};
    userState.set(ctx.from.id, { ...state, currentWishlistId: null });
    return sendOwnerEventsList(ctx);
  });

  bot.action(/^event_(\d+)$/, async (ctx) => {
    const wishlistId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const meta = await db.getWishlistByIdAndOwner(wishlistId, ctx.from.id);
    if (!meta) {
      return ctx.replyWithHTML(
        "Событие не найдено.",
        ownerInlineButtonsDefault
      );
    }
    userState.set(ctx.from.id, { currentWishlistId: wishlistId });
    return sendOwnerList(ctx, wishlistId);
  });

  bot.action("owner_new_event", async (ctx) => {
    await ctx.answerCbQuery();
    userState.set(ctx.from.id, { waitingForEventTitle: true });
    return ctx.replyWithHTML(
      "➕ Введите <b>название события</b> (например: День рождения 2025, Новый год):",
      Markup.inlineKeyboard([
        [Markup.button.callback("❌ Отмена", "owner_events")],
      ])
    );
  });
}

module.exports = {
  sendOwnerList,
  sendOwnerEventsList,
  registerOwnerHandlers,
};
