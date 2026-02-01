const { PRIORITY_LABELS } = require("./constants");

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

function priorityStars(n) {
  if (!n || n < 1) return "";
  return "⭐".repeat(Math.min(5, Math.max(0, n)));
}

function formatGiftLine(g, index, options = {}) {
  const { forOwner = false } = options;
  const num = index != null ? `${index + 1}. ` : "";
  const title = escapeHtml(g.title);
  const status = g.reserved_by_telegram_id
    ? forOwner
      ? " — будет подарен"
      : ` — подарит ${displayName(g)}`
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

function formatEventDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

module.exports = {
  escapeHtml,
  displayName,
  priorityStars,
  formatGiftLine,
  formatEventDate,
};
