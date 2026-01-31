require("dotenv").config();
const { Telegraf } = require("telegraf");
const db = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("Ошибка: задайте BOT_TOKEN в .env (см. .env.example)");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Подключение обработчиков
const { registerStartHandlers } = require("./handlers/start");
const { registerVisitorHandlers } = require("./handlers/visitor");
const { registerOwnerHandlers } = require("./handlers/owner");
const { registerGiftHandlers } = require("./handlers/gifts");
const { registerDeadlineHandlers } = require("./handlers/deadline");
const { registerShareHandlers } = require("./handlers/share");
const { registerHelpHandlers } = require("./handlers/help");
const { registerTextHandler } = require("./handlers/text");
const { registerCommandHandlers } = require("./handlers/commands");
const { runReminders } = require("./handlers/reminders");

// Порядок регистрации важен: start → actions → text → commands
registerStartHandlers(bot);
registerVisitorHandlers(bot);
registerOwnerHandlers(bot);
registerGiftHandlers(bot);
registerDeadlineHandlers(bot);
registerShareHandlers(bot);
registerHelpHandlers(bot);
registerTextHandler(bot);
registerCommandHandlers(bot);

async function main() {
  await db.initDb();
  console.log("DB ready");
  bot.launch();
  runReminders(bot);
  setInterval(() => runReminders(bot), 24 * 60 * 60 * 1000);
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
