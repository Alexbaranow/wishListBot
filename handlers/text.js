const { Markup } = require("telegraf");
const { message } = require("telegraf/filters");
const db = require("../db");
const { userState } = require("../lib/state");
const { escapeHtml, formatEventDate } = require("../lib/utils");
const { getOwnerKeyboard, choiceInlineButtons } = require("../lib/keyboards");
const { sendVisitorWishlist } = require("./visitor");
const { sendOwnerList } = require("./owner");

function registerTextHandler(bot) {
  bot.on(message("text"), async (ctx, next) => {
    const state = userState.get(ctx.from.id);

    // Ожидание названия события
    if (state?.waitingForEventTitle) {
      const title = ctx.message.text.trim() || "Новое событие";
      userState.delete(ctx.from.id);
      const event = await db.createEvent(
        ctx.from.id,
        title,
        ctx.from.username,
        ctx.from.first_name
      );
      userState.set(ctx.from.id, { currentWishlistId: event.id });
      await ctx.replyWithHTML(
        `✅ Событие «<b>${escapeHtml(
          title
        )}</b>» создано! У него своя ссылка — нажмите 🔗 Ссылка.`
      );
      return sendOwnerList(ctx, event.id);
    }

    // Ввод username владельца
    if (state?.waitingForOwnerRef) {
      let ref = ctx.message.text.trim();
      const match =
        ref.match(/t\.me\/\w+\?start=(.+)/) || ref.match(/start=(.+)/);
      if (match) ref = match[1].trim();
      if (ref.startsWith("@")) ref = ref.slice(1);
      if (!ref) {
        return ctx.replyWithHTML(
          "Введите @username или ссылку.",
          Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Главное меню", "visitor_back")],
          ])
        );
      }
      const wishlistOwner = await db.getWishlistByOwnerRef(ref);
      if (!wishlistOwner) {
        userState.set(ctx.from.id, { waitingForOwnerRef: true });
        return ctx.replyWithHTML(
          "❌ Вишлист не найден. Введи @username или ссылку ещё раз — или вернись в главное меню.",
          Markup.inlineKeyboard([
            [Markup.button.callback("◀️ Главное меню", "visitor_back")],
          ])
        );
      }
      const ownerName = wishlistOwner.username
        ? `@${wishlistOwner.username}`
        : wishlistOwner.first_name || "Владелец";
      userState.set(ctx.from.id, {
        viewingWishlistId: wishlistOwner.id,
        ownerName,
      });
      await sendVisitorWishlist(
        ctx,
        wishlistOwner.id,
        ownerName,
        wishlistOwner
      );
      return;
    }

    // Добавление подарка
    const add = state?.addingGift;
    if (add) {
      const text = ctx.message.text.trim();
      if (!text && add.step === "title") {
        return ctx.replyWithHTML(
          "Напиши название подарка.",
          getOwnerKeyboard(ctx)
        );
      }
      if (add.step === "title") {
        add.title = text;
        add.step = "description";
        return ctx.replyWithHTML(
          "📝 Добавить <b>описание</b>? (магазин, размер, цвет — по желанию)",
          Markup.inlineKeyboard([
            [Markup.button.callback("⏭ Пропустить", "add_desc_skip")],
            [Markup.button.callback("« Отмена", "owner_add_cancel")],
          ])
        );
      }
      if (add.step === "description") {
        add.description = text;
        add.step = "link";
        return ctx.replyWithHTML(
          "🔗 Добавить <b>ссылку</b> на товар?",
          Markup.inlineKeyboard([
            [Markup.button.callback("⏭ Пропустить", "add_link_skip")],
            [Markup.button.callback("« Отмена", "owner_add_cancel")],
          ])
        );
      }
      if (add.step === "link") {
        const urlMatch = text.match(/https?:\/\/[^\s]+/);
        add.link = urlMatch ? urlMatch[0] : text;
        add.step = "priority";
        return ctx.replyWithHTML(
          "⭐ <b>Приоритет</b>: насколько это важно? (гости увидят звёздочки)",
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
      }
    }

    // Редактирование даты события
    const editingDate = state?.editingEventDate;
    if (editingDate?.step === "date") {
      const text = ctx.message.text.trim();
      const { wishlistId } = editingDate;
      userState.set(ctx.from.id, { ...state, editingEventDate: undefined });
      const match = text.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/);
      if (!match) {
        userState.set(ctx.from.id, { ...state, editingEventDate: editingDate });
        return ctx.replyWithHTML(
          "Неверный формат. Введите ДД.ММ.ГГГГ или ДД.ММ",
          getOwnerKeyboard(ctx)
        );
      }
      const d = parseInt(match[1], 10);
      const m = parseInt(match[2], 10) - 1;
      const y = match[3]
        ? parseInt(match[3], 10) < 100
          ? 2000 + parseInt(match[3], 10)
          : parseInt(match[3], 10)
        : new Date().getFullYear();
      const date = new Date(y, m, d);
      if (Number.isNaN(date.getTime()) || date.getMonth() !== m) {
        userState.set(ctx.from.id, { ...state, editingEventDate: editingDate });
        return ctx.replyWithHTML("Некорректная дата.", getOwnerKeyboard(ctx));
      }
      const iso = date.toISOString().slice(0, 10);
      await db.updateWishlist(wishlistId, ctx.from.id, { event_date: iso });
      userState.set(ctx.from.id, { ...state, currentWishlistId: wishlistId });
      return ctx.replyWithHTML(
        `✅ Дата события: ${formatEventDate(
          iso
        )}. Можно настроить напоминание (кнопка «Дедлайн»).`,
        getOwnerKeyboard(ctx)
      );
    }

    // Редактирование подарка
    const edit = state?.editingGift;
    if (edit) {
      const text = ctx.message.text.trim();
      userState.delete(ctx.from.id);
      const wishlistId = await db.getUserWishlistId(ctx.from.id);
      if (!wishlistId || wishlistId !== edit.wishlistId) {
        return ctx.replyWithHTML("Сессия устарела.", getOwnerKeyboard(ctx));
      }
      const clear = (t) => t === "—" || t === "-" || !t.trim();
      const updates = {};
      if (edit.field === "title") updates.title = text || edit.currentTitle;
      if (edit.field === "description")
        updates.description = clear(text) ? null : text;
      if (edit.field === "link") updates.link = clear(text) ? null : text;
      const ok = await db.updateGift(edit.giftId, wishlistId, updates);
      if (!ok) {
        return ctx.replyWithHTML("Не удалось обновить.", getOwnerKeyboard(ctx));
      }
      return ctx.replyWithHTML(
        `✅ Обновлено: <b>${escapeHtml(
          updates.title || edit.currentTitle
        )}</b>`,
        getOwnerKeyboard(ctx)
      );
    }

    return next();
  });
}

module.exports = { registerTextHandler };
