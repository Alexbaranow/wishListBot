const db = require("../db");
const { userState } = require("../lib/state");
const { choiceInlineButtons } = require("../lib/keyboards");
const { WELCOME_CHOICE } = require("../lib/constants");
const { sendVisitorWishlist } = require("./visitor");
const { sendOwnerList } = require("./owner");

async function handleStartWithRef(ctx, ref) {
  const wishlistOwner = await db.getWishlistByOwnerRef(ref.trim());
  if (!wishlistOwner) {
    return ctx.replyWithHTML(
      "❌ Вишлист не найден. Проверь ссылку или @username владельца.",
      choiceInlineButtons
    );
  }
  await db.ensureUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  const ownerName = wishlistOwner.username
    ? `@${wishlistOwner.username}`
    : wishlistOwner.first_name || "Владелец";
  userState.set(ctx.from.id, {
    viewingWishlistId: wishlistOwner.id,
    ownerName,
  });
  await sendVisitorWishlist(ctx, wishlistOwner.id, ownerName, wishlistOwner);
}

function registerStartHandlers(bot) {
  bot.start(async (ctx) => {
    const payload = ctx.startPayload?.trim();
    if (payload) {
      return handleStartWithRef(ctx, payload);
    }
    return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
  });

  bot.action("choice_create", async (ctx) => {
    await ctx.answerCbQuery();
    const wl = await db.getOrCreateWishlist(
      ctx.from.id,
      ctx.from.username,
      ctx.from.first_name
    );
    userState.set(ctx.from.id, { currentWishlistId: wl.id });
    return sendOwnerList(ctx, wl.id);
  });

  bot.action("choice_view", async (ctx) => {
    await ctx.answerCbQuery();
    userState.set(ctx.from.id, { waitingForOwnerRef: true });
    return ctx.replyWithHTML(
      "👀 Введите <b>@username</b> владельца вишлиста (например <code>@username</code>) или перейдите по ссылке, которую он вам прислал."
    );
  });
}

module.exports = {
  handleStartWithRef,
  registerStartHandlers,
};
