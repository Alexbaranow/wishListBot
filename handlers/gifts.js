const { Markup } = require("telegraf");
const db = require("../db");
const { userState } = require("../lib/state");
const { escapeHtml, priorityStars } = require("../lib/utils");
const { PRIORITY_LABELS } = require("../lib/constants");
const { getOwnerKeyboard, choiceInlineButtons } = require("../lib/keyboards");

async function saveAddingGift(ctx, add) {
  userState.delete(ctx.from.id);
  await db.addGift(
    add.wishlistId,
    add.title,
    add.description || null,
    add.link || null,
    add.priority || 0
  );
  let msg = `✅ Подарок <b>${escapeHtml(add.title)}</b> добавлен!`;
  if (add.priority) msg += ` ${priorityStars(add.priority)}`;
  return ctx.replyWithHTML(msg, getOwnerKeyboard(ctx));
}

function registerGiftHandlers(bot) {
  bot.action("owner_add", async (ctx) => {
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId) {
      return ctx.replyWithHTML(
        "Сначала выберите событие или создайте вишлист.",
        choiceInlineButtons
      );
    }
    userState.set(ctx.from.id, {
      ...state,
      currentWishlistId: wishlistId,
      addingGift: { step: "title", wishlistId },
    });
    return ctx.replyWithHTML(
      "➕ Напиши <b>название подарка</b> (обязательно):",
      Markup.inlineKeyboard([
        [Markup.button.callback("« Отмена", "owner_add_cancel")],
      ])
    );
  });

  bot.action("owner_add_cancel", async (ctx) => {
    userState.delete(ctx.from.id);
    await ctx.answerCbQuery();
    return ctx.replyWithHTML("Добавление отменено.", getOwnerKeyboard(ctx));
  });

  bot.action(/^add_priority_(\d+)$/, async (ctx) => {
    const priority = parseInt(ctx.match[1], 10);
    const state = userState.get(ctx.from.id);
    const add = state?.addingGift;
    if (!add || add.step !== "priority") {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    add.priority = Math.max(1, Math.min(5, priority));
    await saveAddingGift(ctx, add);
  });

  bot.action("add_priority_skip", async (ctx) => {
    const state = userState.get(ctx.from.id);
    const add = state?.addingGift;
    if (!add || add.step !== "priority") {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    add.priority = 0;
    await saveAddingGift(ctx, add);
  });

  bot.action("add_desc_skip", async (ctx) => {
    const state = userState.get(ctx.from.id);
    const add = state?.addingGift;
    if (!add || add.step !== "description") {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    add.step = "link";
    return ctx.replyWithHTML(
      "🔗 Добавить <b>ссылку</b> на товар?",
      Markup.inlineKeyboard([
        [Markup.button.callback("⏭ Пропустить", "add_link_skip")],
        [Markup.button.callback("« Отмена", "owner_add_cancel")],
      ])
    );
  });

  bot.action("add_link_skip", async (ctx) => {
    const state = userState.get(ctx.from.id);
    const add = state?.addingGift;
    if (!add || add.step !== "link") {
      await ctx.answerCbQuery();
      return;
    }
    await ctx.answerCbQuery();
    add.step = "priority";
    return ctx.replyWithHTML(
      "⭐ <b>Приоритет</b>: насколько это важно?",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("1", "add_priority_1"),
          Markup.button.callback("2", "add_priority_2"),
          Markup.button.callback("3", "add_priority_3"),
          Markup.button.callback("4", "add_priority_4"),
          Markup.button.callback("5", "add_priority_5"),
        ],
        [
          Markup.button.callback("⏭ Пропустить", "add_priority_skip"),
          Markup.button.callback("« Отмена", "owner_add_cancel"),
        ],
      ])
    );
  });

  // Редактирование подарка
  bot.action(/^edit_(\d+)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId) {
      return ctx.replyWithHTML(
        "Сначала создайте вишлист.",
        choiceInlineButtons
      );
    }
    const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
    if (!gift) {
      return ctx.replyWithHTML("Подарок не найден.", getOwnerKeyboard(ctx));
    }
    return ctx.replyWithHTML(
      `✏️ Что изменить в «<b>${escapeHtml(gift.title)}</b>»?`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📌 Название", `editf_${giftId}_title`)],
        [
          Markup.button.callback("📝 Описание", `editf_${giftId}_desc`),
          Markup.button.callback("🔗 Ссылка", `editf_${giftId}_link`),
        ],
        [
          Markup.button.callback("⭐ Приоритет", `editf_${giftId}_prio`),
          Markup.button.callback("◀️ Назад к списку", "owner_list"),
        ],
      ])
    );
  });

  bot.action(/^editf_(\d+)_(title|desc|link)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    const field = ctx.match[2];
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId)
      return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
    const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
    if (!gift)
      return ctx.replyWithHTML("Подарок не найден.", getOwnerKeyboard(ctx));
    const dbField = field === "desc" ? "description" : field;
    userState.set(ctx.from.id, {
      editingGift: {
        giftId,
        wishlistId,
        field: dbField,
        currentTitle: gift.title,
      },
    });
    const prompts = {
      title: "Введите новое название:",
      description: "Введите описание (или «—» чтобы очистить):",
      link: "Введите ссылку (или «—» чтобы убрать):",
    };
    return ctx.replyWithHTML(
      `✏️ ${prompts[dbField]}`,
      Markup.inlineKeyboard([
        [Markup.button.callback("« Отмена", "owner_list")],
      ])
    );
  });

  bot.action(/^editf_(\d+)_prio$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId)
      return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
    const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
    if (!gift)
      return ctx.replyWithHTML("Подарок не найден.", getOwnerKeyboard(ctx));
    return ctx.replyWithHTML(
      "⭐ Выберите приоритет (1 — мелочь, 5 — мечта):",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("1", `setprio_${giftId}_1`),
          Markup.button.callback("2", `setprio_${giftId}_2`),
          Markup.button.callback("3", `setprio_${giftId}_3`),
          Markup.button.callback("4", `setprio_${giftId}_4`),
          Markup.button.callback("5", `setprio_${giftId}_5`),
        ],
        [
          Markup.button.callback("Убрать приоритет", `setprio_${giftId}_0`),
          Markup.button.callback("◀️ Назад", "owner_list"),
        ],
      ])
    );
  });

  bot.action(/^setprio_(\d+)_(\d+)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    const priority = parseInt(ctx.match[2], 10);
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId) return;
    const ok = await db.updateGift(giftId, wishlistId, { priority });
    if (!ok)
      return ctx.replyWithHTML("Не удалось обновить.", getOwnerKeyboard(ctx));
    const msg =
      priority === 0
        ? "✅ Приоритет убран."
        : `✅ Приоритет: ${priorityStars(priority)} ${
            PRIORITY_LABELS[priority] || ""
          }`;
    return ctx.replyWithHTML(msg, getOwnerKeyboard(ctx));
  });

  // Удаление подарка
  bot.action(/^del_(\d+)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId)
      return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
    const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
    if (!gift)
      return ctx.replyWithHTML("Подарок не найден.", getOwnerKeyboard(ctx));
    return ctx.replyWithHTML(
      `🗑 Удалить подарок «<b>${escapeHtml(gift.title)}</b>»?`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Да, удалить", `confirm_del_${giftId}`),
          Markup.button.callback("« Нет", "owner_list"),
        ],
      ])
    );
  });

  bot.action(/^confirm_del_(\d+)$/, async (ctx) => {
    const giftId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    const state = userState.get(ctx.from.id);
    const wishlistId =
      state?.currentWishlistId ?? (await db.getUserWishlistId(ctx.from.id));
    if (!wishlistId) return;
    const ok = await db.deleteGift(giftId, wishlistId);
    if (!ok)
      return ctx.replyWithHTML("Не удалось удалить.", getOwnerKeyboard(ctx));
    return ctx.replyWithHTML("✅ Подарок удалён.", getOwnerKeyboard(ctx));
  });
}

module.exports = {
  saveAddingGift,
  registerGiftHandlers,
};
