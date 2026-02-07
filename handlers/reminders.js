const db = require("../db");
const { escapeHtml, formatEventDate } = require("../lib/utils");
const { trackMessage } = require("../lib/chatCleaner");

async function runReminders(bot) {
  try {
    const list = await db.getWishlistsToRemindToday();
    for (const w of list) {
      const until = formatEventDate(w.event_date);
      const sent = await bot.telegram.sendMessage(
        w.owner_telegram_id,
        `📅 <b>Напоминание</b>\n\nЧерез ${
          w.remind_days_before
        } дн. событие «${escapeHtml(
          w.title
        )}» (${until}). Обновите список подарков, если нужно.`,
        { parse_mode: "HTML" }
      );
      if (sent?.message_id) trackMessage(w.owner_telegram_id, sent.message_id);
      await db.markReminderSent(w.id);
    }
  } catch (e) {
    console.error("Reminders error:", e);
  }
}

module.exports = { runReminders };
