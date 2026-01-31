const db = require("../db");
const { message } = require("telegraf/filters");
const { getOwnerKeyboard, choiceInlineButtons } = require("../lib/keyboards");
const { escapeHtml } = require("../lib/utils");
const { getHelpMessage } = require("./help");
const { sendOwnerList } = require("./owner");

function registerCommandHandlers(bot) {
  bot.command("wishlist", sendOwnerList);

  bot.command("add", async (ctx) => {
    const wishlistId = await db.getUserWishlistId(ctx.from.id);
    if (!wishlistId) {
      return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
    }
    const title = ctx.message.text.split(" ").slice(1).join(" ").trim();
    if (!title) {
      return ctx.replyWithHTML(
        "Напиши: <code>/add название подарка</code> или нажми кнопку ➕ Добавить.",
        getOwnerKeyboard(ctx)
      );
    }
    await db.addGift(wishlistId, title);
    return ctx.replyWithHTML(
      `✅ Подарок <b>${escapeHtml(title)}</b> добавлен!`,
      getOwnerKeyboard(ctx)
    );
  });

  bot.help((ctx) =>
    ctx.replyWithHTML(getHelpMessage(true), getOwnerKeyboard(ctx))
  );

  bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
  bot.hears("hi", (ctx) => ctx.reply("Hey there"));
}

module.exports = { registerCommandHandlers };
