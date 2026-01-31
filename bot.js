require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { message } = require("telegraf/filters");
const db = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Ошибка: задайте BOT_TOKEN в .env (см. .env.example)");
  process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

const userState = new Map();

// Инлайн-меню владельца (под сообщениями, не под строкой ввода)
const ownerInlineButtons = Markup.inlineKeyboard([
  [
    Markup.button.callback("🎁 Мой список", "owner_list"),
    Markup.button.callback("➕ Добавить", "owner_add"),
  ],
  [
    Markup.button.callback("🔗 Ссылка", "owner_share"),
    Markup.button.callback("❓ Помощь", "owner_help"),
  ],
]);

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function displayName(user) {
  if (!user) return "кто-то";
  return user.reserved_by_username
    ? `@${user.reserved_by_username}`
    : user.reserved_by_name || "кто-то";
}

// Приоритет: 0 — не указан, 1 — мелочь … 5 — мечта
const PRIORITY_LABELS = {
  0: "",
  1: "мелочь",
  2: "было бы неплохо",
  3: "хочу",
  4: "очень хочу",
  5: "мечта",
};

function priorityStars(n) {
  if (!n || n < 1) return "";
  return "⭐".repeat(Math.min(5, Math.max(0, n)));
}

function formatGiftLine(g, index) {
  const num = index != null ? `${index + 1}. ` : "";
  const title = escapeHtml(g.title);
  const status = g.reserved_by_telegram_id
    ? ` — подарит ${displayName(g)}`
    : " — ○ свободно";
  let line = `${num}<b>${title}</b>${status}`;
  if (g.priority && g.priority > 0) {
    line += ` ${priorityStars(g.priority)}`;
    if (PRIORITY_LABELS[g.priority])
      line += ` (${PRIORITY_LABELS[g.priority]})`;
  }
  if (g.description) line += `\n   <i>${escapeHtml(g.description)}</i>`;
  if (g.link) line += `\n   🔗 <a href="${escapeHtml(g.link)}">Ссылка</a>`;
  return line;
}

// —— Старт: с рефом (пришли по ссылке друга) ——
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
  await sendVisitorWishlist(ctx, wishlistOwner.id, ownerName);
}

async function sendVisitorWishlist(ctx, wishlistId, ownerName) {
  const gifts = await db.getGifts(wishlistId);
  const lines = gifts.map((g, i) => formatGiftLine(g, i));
  const text = `🎁 Вишлист <b>${escapeHtml(ownerName)}</b>\n\n${
    lines.join("\n\n") || "Пока пусто."
  }`;

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

// —— Старт: без рефа —— главный экран выбора (инлайн-кнопки) ——
const CHOICE_CREATE = "✨ Создать свой вишлист";
const CHOICE_VIEW = "👀 Пришёл посмотреть вишлист друга";

const choiceInlineButtons = Markup.inlineKeyboard([
  [Markup.button.callback(CHOICE_CREATE, "choice_create")],
  [Markup.button.callback(CHOICE_VIEW, "choice_view")],
]);

const WELCOME_CHOICE = `
🎄 <b>Wishlist Bot</b> — списки подарков ✨

Вы хотите <b>создать свой вишлист</b> или <b>пришли посмотреть вишлист друга</b>?

Если друг прислал вам ссылку — откройте её, и откроется его вишлист. Или нажмите кнопку ниже и введите его @username.
`;

bot.start(async (ctx) => {
  const payload = ctx.startPayload?.trim();
  if (payload) {
    return handleStartWithRef(ctx, payload);
  }
  return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
});

// Инлайн: создать свой вишлист
bot.action("choice_create", async (ctx) => {
  await ctx.answerCbQuery();
  userState.delete(ctx.from.id);
  await db.getOrCreateWishlist(
    ctx.from.id,
    ctx.from.username,
    ctx.from.first_name
  );
  const msg = `
✅ Ваш вишлист создан! Добавляйте подарки и делитесь ссылкой с друзьями.

Используйте меню ниже 👇
`;
  return ctx.replyWithHTML(msg, ownerInlineButtons);
});

// Инлайн: пришёл посмотреть вишлист друга
bot.action("choice_view", async (ctx) => {
  await ctx.answerCbQuery();
  userState.set(ctx.from.id, { waitingForOwnerRef: true });
  return ctx.replyWithHTML(
    "👀 Введите <b>@username</b> владельца вишлиста (например <code>@username</code>) или перейдите по ссылке, которую он вам прислал."
  );
});

// Ввод username владельца или названия подарка
bot.on(message("text"), async (ctx, next) => {
  const state = userState.get(ctx.from.id);
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
    userState.set(ctx.from.id, {
      viewingWishlistId: wishlistOwner.id,
      ownerName: wishlistOwner.username
        ? `@${wishlistOwner.username}`
        : wishlistOwner.first_name || "Владелец",
    });
    await sendVisitorWishlist(
      ctx,
      wishlistOwner.id,
      wishlistOwner.username
        ? `@${wishlistOwner.username}`
        : wishlistOwner.first_name || "Владелец"
    );
  }

  const add = state?.addingGift;
  if (add) {
    const text = ctx.message.text.trim();
    if (!text && add.step === "title") {
      return ctx.replyWithHTML("Напиши название подарка.", ownerInlineButtons);
    }
    if (add.step === "title") {
      add.title = text;
      add.step = "description";
      return ctx.replyWithHTML(
        "📝 Добавить <b>описание</b>? (магазин, размер, цвет — по желанию)",
        Markup.inlineKeyboard([
          [Markup.button.callback("⏭ Пропустить", "add_desc_skip")],
          [Markup.button.callback("❌ Отмена", "owner_add_cancel")],
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
          [Markup.button.callback("❌ Отмена", "owner_add_cancel")],
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
            Markup.button.callback("❌ Отмена", "owner_add_cancel"),
          ],
        ])
      );
    }
  }

  // Редактирование подарка (ожидание нового значения поля)
  const edit = state?.editingGift;
  if (edit) {
    const text = ctx.message.text.trim();
    userState.delete(ctx.from.id);
    const wishlistId = await db.getUserWishlistId(ctx.from.id);
    if (!wishlistId || wishlistId !== edit.wishlistId) {
      return ctx.replyWithHTML("Сессия устарела.", ownerInlineButtons);
    }
    const clear = (t) => t === "—" || t === "-" || !t.trim();
    const updates = {};
    if (edit.field === "title") updates.title = text || edit.currentTitle;
    if (edit.field === "description")
      updates.description = clear(text) ? null : text;
    if (edit.field === "link") updates.link = clear(text) ? null : text;
    const ok = await db.updateGift(edit.giftId, wishlistId, updates);
    if (!ok) {
      return ctx.replyWithHTML("Не удалось обновить.", ownerInlineButtons);
    }
    return ctx.replyWithHTML(
      `✅ Обновлено: <b>${escapeHtml(updates.title || edit.currentTitle)}</b>`,
      ownerInlineButtons
    );
  }

  return next();
});

// Резерв подарка (гость нажал «Выбрать»)
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
        `🎁 Кто-то зарезервировал подарок «<b>${escapeHtml(gift.title)}</b>».`,
        { parse_mode: "HTML" }
      )
      .catch(() => {});
  }

  const ownerName = state.ownerName || "Владелец";
  userState.set(ctx.from.id, { viewingWishlistId: wishlistId, ownerName });
  await sendVisitorWishlist(ctx, wishlistId, ownerName);
});

// Отмена резерва гостем
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
  await sendVisitorWishlist(ctx, wishlistId, ownerName);
});

bot.action("refresh_visitor", async (ctx) => {
  const state = userState.get(ctx.from.id);
  if (!state?.viewingWishlistId) {
    await ctx.answerCbQuery();
    return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
  }
  await ctx.answerCbQuery();
  userState.set(ctx.from.id, state);
  return sendVisitorWishlist(
    ctx,
    state.viewingWishlistId,
    state.ownerName || "Владелец"
  );
});

bot.action("visitor_back", async (ctx) => {
  userState.delete(ctx.from.id);
  await ctx.answerCbQuery();
  return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
});

// —— Владелец: инлайн-меню ——
function ownerListKeyboard(gifts) {
  const rows = gifts.map((g) => [
    Markup.button.callback(
      `✏️ ${g.title.slice(0, 25)}${g.title.length > 25 ? "…" : ""}`,
      `edit_${g.id}`
    ),
    Markup.button.callback("🗑", `del_${g.id}`),
  ]);
  return Markup.inlineKeyboard([
    ...rows,
    [Markup.button.callback("➕ Добавить подарок", "owner_add")],
    [
      Markup.button.callback("🔗 Ссылка", "owner_share"),
      Markup.button.callback("❓ Помощь", "owner_help"),
    ],
  ]);
}

async function sendOwnerList(ctx) {
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId) {
    return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
  }
  const gifts = await db.getGifts(wishlistId);
  const lines = gifts.map((g, i) => formatGiftLine(g, i));
  const text = `🎁 <b>Мой список</b>\n\n${
    lines.join("\n\n") || "Пока пусто. Нажми ➕ Добавить подарок."
  }`;
  const keyboard =
    gifts.length > 0 ? ownerListKeyboard(gifts) : ownerInlineButtons;
  return ctx.replyWithHTML(text, keyboard);
}

bot.action("owner_list", async (ctx) => {
  await ctx.answerCbQuery();
  return sendOwnerList(ctx);
});

bot.action("owner_add", async (ctx) => {
  await ctx.answerCbQuery();
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId) {
    return ctx.replyWithHTML("Сначала создайте вишлист.", choiceInlineButtons);
  }
  userState.set(ctx.from.id, { addingGift: { step: "title", wishlistId } });
  return ctx.replyWithHTML(
    "➕ Напиши <b>название подарка</b> (обязательно):",
    Markup.inlineKeyboard([
      [Markup.button.callback("❌ Отмена", "owner_add_cancel")],
    ])
  );
});

bot.action("owner_add_cancel", async (ctx) => {
  userState.delete(ctx.from.id);
  await ctx.answerCbQuery();
  return ctx.replyWithHTML("Добавление отменено.", ownerInlineButtons);
});

// Приоритет при добавлении
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
      [Markup.button.callback("❌ Отмена", "owner_add_cancel")],
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
        Markup.button.callback("❌ Отмена", "owner_add_cancel"),
      ],
    ])
  );
});

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
  return ctx.replyWithHTML(msg, ownerInlineButtons);
}

// —— Редактирование подарка ——
bot.action(/^edit_(\d+)$/, async (ctx) => {
  const giftId = parseInt(ctx.match[1], 10);
  await ctx.answerCbQuery();
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId) {
    return ctx.replyWithHTML("Сначала создайте вишлист.", choiceInlineButtons);
  }
  const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
  if (!gift) {
    return ctx.replyWithHTML("Подарок не найден.", ownerInlineButtons);
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
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId)
    return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
  const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
  if (!gift) return ctx.replyWithHTML("Подарок не найден.", ownerInlineButtons);
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
    Markup.inlineKeyboard([[Markup.button.callback("❌ Отмена", "owner_list")]])
  );
});

bot.action(/^editf_(\d+)_prio$/, async (ctx) => {
  const giftId = parseInt(ctx.match[1], 10);
  await ctx.answerCbQuery();
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId)
    return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
  const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
  if (!gift) return ctx.replyWithHTML("Подарок не найден.", ownerInlineButtons);
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
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId) return;
  const ok = await db.updateGift(giftId, wishlistId, { priority });
  if (!ok) return ctx.replyWithHTML("Не удалось обновить.", ownerInlineButtons);
  const msg =
    priority === 0
      ? "✅ Приоритет убран."
      : `✅ Приоритет: ${priorityStars(priority)} ${
          PRIORITY_LABELS[priority] || ""
        }`;
  return ctx.replyWithHTML(msg, ownerInlineButtons);
});

// —— Удаление подарка ——
bot.action(/^del_(\d+)$/, async (ctx) => {
  const giftId = parseInt(ctx.match[1], 10);
  await ctx.answerCbQuery();
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId)
    return ctx.replyWithHTML("Создайте вишлист.", choiceInlineButtons);
  const gift = await db.getGiftByIdAndWishlist(giftId, wishlistId);
  if (!gift) return ctx.replyWithHTML("Подарок не найден.", ownerInlineButtons);
  return ctx.replyWithHTML(
    `🗑 Удалить подарок «<b>${escapeHtml(gift.title)}</b>»?`,
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Да, удалить", `confirm_del_${giftId}`),
        Markup.button.callback("❌ Нет", "owner_list"),
      ],
    ])
  );
});

bot.action(/^confirm_del_(\d+)$/, async (ctx) => {
  const giftId = parseInt(ctx.match[1], 10);
  await ctx.answerCbQuery();
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId) return;
  const ok = await db.deleteGift(giftId, wishlistId);
  if (!ok) return ctx.replyWithHTML("Не удалось удалить.", ownerInlineButtons);
  return ctx.replyWithHTML("✅ Подарок удалён.", ownerInlineButtons);
});

bot.action("owner_share", async (ctx) => {
  await ctx.answerCbQuery();
  const payload = await db.getShareLinkPayload(ctx.from.id);
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
    `🔗 <b>Ссылка для друзей</b>\n\nДрузья переходят по ссылке и видят твой вишлист. Они смогут выбрать, какой подарок подарят.\n\n${linkText}`,
    ownerInlineButtons
  );
});

function getHelpMessage(owner = true) {
  let msg =
    "❓ <b>Помощь</b>\n\n" +
    "• <b>🎁 Мой список</b> — показать список подарков (можно редактировать и удалять)\n" +
    "• <b>➕ Добавить</b> — добавить желание (название, описание, ссылка, приоритет 1–5)\n" +
    "• <b>🔗 Ссылка</b> — отправить друзьям ссылку на твой вишлист\n";
  if (!owner) {
    msg +=
      "\nВы смотрите чужой вишлист — можно только выбрать подарок (кнопки под списком).";
  }
  return msg;
}

bot.action("owner_help", async (ctx) => {
  await ctx.answerCbQuery();
  const viewing = userState.get(ctx.from.id)?.viewingWishlistId;
  return ctx.replyWithHTML(getHelpMessage(!viewing), ownerInlineButtons);
});

// Команды (дублируют инлайн-меню)
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
      ownerInlineButtons
    );
  }
  await db.addGift(wishlistId, title);
  return ctx.replyWithHTML(
    `✅ Подарок <b>${escapeHtml(title)}</b> добавлен!`,
    ownerInlineButtons
  );
});

bot.help((ctx) => ctx.replyWithHTML(getHelpMessage(true), ownerInlineButtons));
bot.on(message("sticker"), (ctx) => ctx.reply("👍"));
bot.hears("hi", (ctx) => ctx.reply("Hey there"));

async function main() {
  await db.initDb();
  console.log("DB ready");
  bot.launch();
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

main().catch((err) => {
  if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
    console.error(
      "\n❌ Не удалось подключиться к PostgreSQL (localhost:5432).\n"
    );
    console.error("1. Установи PostgreSQL, если ещё нет:");
    console.error("   brew install postgresql@16\n");
    console.error("2. Запусти сервер:");
    console.error("   brew services start postgresql@16\n");
    console.error("3. Создай базу и пользователя (пароль 922001):");
    console.error(
      "   createuser -s postgres  # если пользователь postgres нет"
    );
    console.error("   createdb wishlist_bot\n");
    console.error("После этого снова: npm start\n");
  } else {
    console.error(err);
  }
  process.exit(1);
});
