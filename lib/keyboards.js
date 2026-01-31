const { Markup } = require("telegraf");
const { userState } = require("./state");
const { CHOICE_CREATE, CHOICE_VIEW } = require("./constants");

function ownerInlineButtons(currentWishlistId) {
  const rows = [
    [
      Markup.button.callback("🎁 Мой список", "owner_list"),
      Markup.button.callback("➕ Добавить", "owner_add"),
    ],
    [
      Markup.button.callback("🔗 Ссылка", "owner_share"),
      Markup.button.callback("❓ Помощь", "owner_help"),
    ],
  ];
  if (currentWishlistId) {
    rows.unshift([Markup.button.callback("📋 События", "owner_events")]);
  }
  return Markup.inlineKeyboard(rows);
}

const ownerInlineButtonsDefault = ownerInlineButtons(null);

function getOwnerKeyboard(ctx) {
  const state = ctx?.from?.id ? userState.get(ctx.from.id) : null;
  return ownerInlineButtons(state?.currentWishlistId);
}

const choiceInlineButtons = Markup.inlineKeyboard([
  [Markup.button.callback(CHOICE_CREATE, "choice_create")],
  [Markup.button.callback(CHOICE_VIEW, "choice_view")],
]);

function ownerListKeyboard(gifts, wishlistId) {
  const rows = gifts.map((g) => [
    Markup.button.callback(
      `✏️ ${g.title.slice(0, 25)}${g.title.length > 25 ? "…" : ""}`,
      `edit_${g.id}`
    ),
    Markup.button.callback("🗑", `del_${g.id}`),
  ]);
  const kb = [
    ...rows,
    [Markup.button.callback("➕ Добавить подарок", "owner_add")],
    [
      Markup.button.callback("🔗 Ссылка", "owner_share"),
      Markup.button.callback("📅 Дедлайн", `event_deadline_${wishlistId}`),
    ],
    [
      Markup.button.callback("📋 К событиям", "owner_events"),
      Markup.button.callback("❓ Помощь", "owner_help"),
    ],
  ];
  return Markup.inlineKeyboard(kb);
}

module.exports = {
  ownerInlineButtons,
  ownerInlineButtonsDefault,
  getOwnerKeyboard,
  choiceInlineButtons,
  ownerListKeyboard,
};
