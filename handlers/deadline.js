const { Markup } = require("telegraf");
const db = require("../db");
const { userState } = require("../lib/state");
const { escapeHtml, formatEventDate } = require("../lib/utils");
const { getOwnerKeyboard } = require("../lib/keyboards");

function registerDeadlineHandlers(bot) {
  bot.action(/^event_deadline_(\d+)$/, async (ctx) => {
    const wishlistId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const meta = await db.getWishlistByIdAndOwner(wishlistId, ctx.from.id);
    if (!meta) {
      return ctx.replyWithHTML("Событие не найдено.", getOwnerKeyboard(ctx));
    }
    const dateStr = meta.event_date
      ? formatEventDate(meta.event_date)
      : "не указана";
    const remindStr = meta.remind_days_before
      ? `за ${meta.remind_days_before} дн.`
      : "не включено";
    const text =
      `📅 <b>Дедлайн</b> — событие «${escapeHtml(meta.title)}»\n\n` +
      `Дата события: ${dateStr}\n` +
      `Напоминание владельцу: ${remindStr}\n\n` +
      "Гости увидят «Подарки нужны до …». Вам придёт напоминание обновить список за N дней до даты.";
    return ctx.replyWithHTML(
      text,
      Markup.inlineKeyboard([
        [
          Markup.button.callback(
            "📆 Установить дату события",
            `event_setdate_${wishlistId}`
          ),
        ],
        [
          Markup.button.callback(
            "🔔 Напомнить за N дней",
            `event_setremind_${wishlistId}`
          ),
        ],
        [
          Markup.button.callback(
            "🗑 Убрать дедлайн",
            `event_cleardate_${wishlistId}`
          ),
        ],
        [Markup.button.callback("◀️ Назад к списку", "owner_list")],
      ])
    );
  });

  bot.action(/^event_setdate_(\d+)$/, async (ctx) => {
    const wishlistId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id) || {};
    userState.set(ctx.from.id, {
      ...state,
      editingEventDate: { wishlistId, step: "date" },
    });
    return ctx.replyWithHTML(
      "📆 Введите <b>дату события</b> в формате ДД.ММ.ГГГГ (например 15.06.2025) или ДД.ММ (год — текущий):",
      Markup.inlineKeyboard([
        [Markup.button.callback("« Отмена", "owner_list")],
      ])
    );
  });

  bot.action(/^event_setremind_(\d+)$/, async (ctx) => {
    const wishlistId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    return ctx.replyWithHTML(
      "🔔 Напомнить вам <b>обновить список</b> за сколько дней до даты события?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("1 день", `event_remind_${wishlistId}_1`),
          Markup.button.callback("3 дня", `event_remind_${wishlistId}_3`),
          Markup.button.callback("7 дней", `event_remind_${wishlistId}_7`),
        ],
        [
          Markup.button.callback("14 дней", `event_remind_${wishlistId}_14`),
          Markup.button.callback("Убрать", `event_remind_${wishlistId}_0`),
        ],
        [Markup.button.callback("◀️ Назад", "owner_list")],
      ])
    );
  });

  bot.action(/^event_remind_(\d+)_(\d+)$/, async (ctx) => {
    const wishlistId = parseInt(ctx.match[1], 10);
    const days = parseInt(ctx.match[2], 10);
    await ctx.answerCbQuery();
    const ok = await db.updateWishlist(wishlistId, ctx.from.id, {
      remind_days_before: days === 0 ? null : days,
    });
    if (!ok)
      return ctx.replyWithHTML("Не удалось обновить.", getOwnerKeyboard(ctx));
    const msg =
      days === 0
        ? "✅ Напоминание отключено."
        : `✅ Буду напоминать обновить список за ${days} дн. до даты события.`;
    return ctx.replyWithHTML(msg, getOwnerKeyboard(ctx));
  });

  bot.action(/^event_cleardate_(\d+)$/, async (ctx) => {
    const wishlistId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    await db.updateWishlist(wishlistId, ctx.from.id, {
      event_date: null,
      remind_days_before: null,
    });
    return ctx.replyWithHTML(
      "✅ Дедлайн убран. Гости больше не увидят «Подарки нужны до …».",
      getOwnerKeyboard(ctx)
    );
  });
}

module.exports = { registerDeadlineHandlers };
