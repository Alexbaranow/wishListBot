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
  const lines = gifts.map(
    (g, i) =>
      `${i + 1}. ${g.title} — ${
        g.reserved_by_telegram_id ? `подарит ${displayName(g)}` : "○ свободно"
      }`
  );
  const text = `🎁 Вишлист <b>${escapeHtml(ownerName)}</b>\n\n${
    lines.join("\n") || "Пока пусто."
  }`;

  const freeGifts = gifts.filter((g) => !g.reserved_by_telegram_id);
  const rows = freeGifts.map((g) => [
    Markup.button.callback(`🎁 Выбрать: ${g.title}`, `reserve_${g.id}`),
  ]);
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
    userState.delete(ctx.from.id);
    let ref = ctx.message.text.trim();
    const match =
      ref.match(/t\.me\/\w+\?start=(.+)/) || ref.match(/start=(.+)/);
    if (match) ref = match[1].trim();
    if (ref.startsWith("@")) ref = ref.slice(1);
    if (!ref) {
      return ctx.replyWithHTML(
        "Введите @username или ссылку.",
        choiceInlineButtons
      );
    }
    const wishlistOwner = await db.getWishlistByOwnerRef(ref);
    if (!wishlistOwner) {
      return ctx.replyWithHTML(
        "❌ Вишлист не найден. Проверь @username или ссылку.",
        choiceInlineButtons
      );
    }
    const ownerName = wishlistOwner.username
      ? `@${wishlistOwner.username}`
      : wishlistOwner.first_name || "Владелец";
    userState.set(ctx.from.id, {
      viewingWishlistId: wishlistOwner.id,
      ownerName,
    });
    await sendVisitorWishlist(ctx, wishlistOwner.id, ownerName);
  }

  if (state?.waitingForGift) {
    const text = ctx.message.text.trim();
    if ([].includes(text)) {
      userState.delete(ctx.from.id);
      return next();
    }
    userState.delete(ctx.from.id);
    const wishlistId = await db.getUserWishlistId(ctx.from.id);
    if (!wishlistId) {
      return ctx.replyWithHTML(
        "Сначала создайте вишлист: нажмите «Создать свой вишлист».",
        choiceInlineButtons
      );
    }
    if (!text) {
      return ctx.replyWithHTML(
        "Напиши название подарка текстом.",
        ownerInlineButtons
      );
    }
    await db.addGift(wishlistId, text);
    return ctx.replyWithHTML(
      `✅ Подарок <b>${escapeHtml(text)}</b> добавлен!`,
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
async function sendOwnerList(ctx) {
  const wishlistId = await db.getUserWishlistId(ctx.from.id);
  if (!wishlistId) {
    return ctx.replyWithHTML(WELCOME_CHOICE, choiceInlineButtons);
  }
  const gifts = await db.getGifts(wishlistId);
  const lines = gifts.map(
    (g, i) =>
      `${i + 1}. ${g.title} — ${
        g.reserved_by_telegram_id ? `подарит ${displayName(g)}` : "○ свободно"
      }`
  );
  return ctx.replyWithHTML(
    `🎁 <b>Мой список</b>\n\n${
      lines.join("\n") || "Пока пусто. Нажми ➕ Добавить."
    }`,
    ownerInlineButtons
  );
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
  userState.set(ctx.from.id, { waitingForGift: true });
  return ctx.replyWithHTML(
    "➕ Напиши <b>название подарка</b> одной строкой:",
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
    "• <b>🎁 Мой список</b> — показать список подарков\n" +
    "• <b>➕ Добавить</b> — добавить желание\n" +
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
