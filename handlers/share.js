const db = require("../db");
const { userState } = require("../lib/state");
const { escapeHtml } = require("../lib/utils");
const { getOwnerKeyboard, choiceInlineButtons } = require("../lib/keyboards");

function registerShareHandlers(bot) {
  bot.action("owner_share", async (ctx) => {
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    const payload = wishlistId
      ? await db.getShareSlug(wishlistId)
      : await db.getShareLinkPayload(ctx.from.id);
    if (!payload) {
      return ctx.replyWithHTML(
        "Сначала создайте вишлист (кнопка «Создать свой вишлист»).",
        choiceInlineButtons
      );
    }
    const botName = ctx.botInfo?.username || process.env.BOT_USERNAME || "";
    const link = botName
      ? `https://t.me/${botName}?start=${encodeURIComponent(payload)}`
      : null;
    const linkText = link
      ? `Перешли друзьям:\n<a href="${link}">${escapeHtml(link)}</a>`
      : `Отправь друзьям: <code>/start ${escapeHtml(payload)}</code>`;
    return ctx.replyWithHTML(
      `🔗 <b>Ссылка для друзей</b>\n\nДрузья переходят по ссылке и видят этот список. У каждого события своя ссылка.\n\n${linkText}`,
      getOwnerKeyboard(ctx)
    );
  });
}

module.exports = { registerShareHandlers };
