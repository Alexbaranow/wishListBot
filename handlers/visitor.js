const { Markup } = require("telegraf");
const db = require("../db");
const { userState } = require("../lib/state");
const { escapeHtml, formatGiftLine, formatEventDate } = require("../lib/utils");
const { choiceInlineButtons } = require("../lib/keyboards");
const { WELCOME_CHOICE } = require("../lib/constants");

async function sendVisitorWishlist(ctx, wishlistId, ownerName, wishlistMeta) {
  const gifts = await db.getGifts(wishlistId);
  const lines = gifts.map((g, i) => formatGiftLine(g, i));
  const eventTitle = wishlistMeta?.title || "Вишлист";
  let header = `🎁 <b>${escapeHtml(eventTitle)}</b> — ${escapeHtml(
    ownerName
  )}\n\n`;
  if (wishlistMeta?.event_date) {
    const until = formatEventDate(wishlistMeta.event_date);
    if (until) header += `📅 Подарки нужны до <b>${until}</b>\n\n`;
  }
  const text = header + (lines.join("\n\n") || "Пока пусто.");

  const visitorId = ctx.from?.id;
  const freeGifts = gifts.filter((g) => !g.reserved_by_telegram_id);
  const myReserved = visitorId
    ? gifts.filter(
        (g) => String(g.reserved_by_telegram_id) === String(visitorId)
      )
    : [];

  const rows = freeGifts.map((g) => [
    Markup.button.callback(
      `🎁 Выбрать: ${g.title.slice(0, 30)}${g.title.length > 30 ? "…" : ""}`,
      `reserve_${g.id}`
    ),
  ]);
  myReserved.forEach((g) => {
    rows.push([
      Markup.button.callback(
        `↩️ Отменить выбор: ${g.title.slice(0, 28)}${
          g.title.length > 28 ? "…" : ""
        }`,
        `unreserve_${g.id}`
      ),
    ]);
  });
  rows.push(
    [Markup.button.callback("🔄 Обновить список", "refresh_visitor")],
    [Markup.button.callback("◀️ Главный экран", "visitor_back")]
  );
  return ctx.replyWithHTML(text, Markup.inlineKeyboard(rows));
}

function registerVisitorHandlers(bot) {
  bot.action(/^reserve_(\d+)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    const state = userState.get(ctx.from.id);
    const wishlistId = state?.viewingWishlistId;
    if (!wishlistId) {
      await ctx.answerCbQuery(
        "Сначала откройте вишлист по ссылке или введите @username."
      );
      return;
    }
    const ok = await db.reserveGift(
      giftId,
      ctx.from.id,
      ctx.from.username,
      ctx.from.first_name
    );
    if (!ok) {
      await ctx.answerCbQuery("Этот подарок уже кто-то выбрал.");
      return;
    }
    await ctx.answerCbQuery("Вы выбрали этот подарок!");

    const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
    const ownerTelegramId = await db.getWishlistOwnerTelegramId(wishlistId);
    if (ownerTelegramId && gift?.title) {
      await ctx.telegram
        .sendMessage(
          ownerTelegramId,
          `🎁 Кто-то зарезервировал подарок «<b>${escapeHtml(
            gift.title
          )}</b>».`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }

    const ownerName = state.ownerName || "Владелец";
    userState.set(ctx.from.id, { viewingWishlistId: wishlistId, ownerName });
    const meta = await db.getWishlistById(wishlistId);
    await sendVisitorWishlist(ctx, wishlistId, ownerName, meta);
  });

  bot.action(/^unreserve_(\d+)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    const state = userState.get(ctx.from.id);
    const wishlistId = state?.viewingWishlistId;
    if (!wishlistId) {
      await ctx.answerCbQuery(
        "Сначала откройте вишлист по ссылке или введите @username."
      );
      return;
    }
    const ok = await db.unreserveGift(giftId, ctx.from.id);
    if (!ok) {
      await ctx.answerCbQuery("Не удалось отменить (возможно, уже снято).");
      return;
    }
    await ctx.answerCbQuery("Вы отменили выбор этого подарка.");

    const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
    const ownerTelegramId = await db.getWishlistOwnerTelegramId(wishlistId);
    if (ownerTelegramId && gift?.title) {
      await ctx.telegram
        .sendMessage(
          ownerTelegramId,
          `↩️ Резерв подарка «<b>${escapeHtml(gift.title)}</b>» снят.`,
          { parse_mode: "HTML" }
        )
        .catch(() => {});
    }

    const ownerName = state.ownerName || "Владелец";
    userState.set(ctx.from.id, { viewingWishlistId: wishlistId, ownerName });
    const meta = await db.getWishlistById(wishlistId);
    await sendVisitorWishlist(ctx, wishlistId, ownerName, meta);
  });

  bot.action("refresh_visitor", async (ctx) => {
    const state = userState.get(ctx.from.id);
    if (!state?.viewingWishlistId) {
      await ctx.answerCbQuery();
      return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
    }
    await ctx.answerCbQuery();
    userState.set(ctx.from.id, state);
    const meta = await db.getWishlistById(state.viewingWishlistId);
    return sendVisitorWishlist(
      ctx,
      state.viewingWishlistId,
      state.ownerName || "Владелец",
      meta
    );
  });

  bot.action("visitor_back", async (ctx) => {
    userState.delete(ctx.from.id);
    await ctx.answerCbQuery();
    return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
  });
}

module.exports = {
  sendVisitorWishlist,
  registerVisitorHandlers,
};
