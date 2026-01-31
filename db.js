const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://localhost:5432/wishlist_bot",
});

function randomSlug() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 10; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS wishlists (
      id SERIAL PRIMARY KEY,
      owner_telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Мой вишлист',
      slug TEXT UNIQUE,
      event_date DATE,
      remind_days_before SMALLINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      wishlist_id INT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      link TEXT,
      priority SMALLINT DEFAULT 0,
      reserved_by_telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_gifts_wishlist ON gifts(wishlist_id);
    CREATE INDEX IF NOT EXISTS idx_wishlists_owner ON wishlists(owner_telegram_id);
  `);
  // Миграция: убрать UNIQUE с owner_telegram_id (если был)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wishlists_owner_telegram_id_key') THEN
        ALTER TABLE wishlists DROP CONSTRAINT wishlists_owner_telegram_id_key;
      END IF;
    END $$;
  `);
  await pool.query(`
    ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS title TEXT DEFAULT 'Мой вишлист';
    ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS event_date DATE;
    ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS remind_days_before SMALLINT;
    ALTER TABLE wishlists ADD COLUMN IF NOT EXISTS reminder_sent_date DATE;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wishlists_slug ON wishlists(slug) WHERE slug IS NOT NULL;
  `);
  await pool.query(`
    ALTER TABLE gifts ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE gifts ADD COLUMN IF NOT EXISTS link TEXT;
    ALTER TABLE gifts ADD COLUMN IF NOT EXISTS priority SMALLINT DEFAULT 0;
  `);
  // Бэкфилл slug и title для старых записей
  const needBackfill = await pool.query(
    "SELECT w.id, w.owner_telegram_id, u.username FROM wishlists w JOIN users u ON u.telegram_id = w.owner_telegram_id WHERE w.slug IS NULL"
  );
  for (const row of needBackfill.rows) {
    const slug = row.username
      ? row.username.toLowerCase()
      : `id${row.owner_telegram_id}`;
    let finalSlug = slug;
    let n = 0;
    while (true) {
      const exists = await pool.query(
        "SELECT 1 FROM wishlists WHERE slug = $1",
        [finalSlug]
      );
      if (exists.rowCount === 0) break;
      finalSlug = `${slug}${++n}`;
    }
    await pool.query(
      "UPDATE wishlists SET slug = $1, title = COALESCE(NULLIF(TRIM(title), ''), 'Мой вишлист') WHERE id = $2",
      [finalSlug, row.id]
    );
  }
}

async function ensureUser(telegramId, username, firstName) {
  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       first_name = COALESCE(EXCLUDED.first_name, users.first_name)`,
    [telegramId, username || null, firstName || null]
  );
}

async function getOrCreateWishlist(ownerTelegramId, username, firstName) {
  await ensureUser(ownerTelegramId, username, firstName);
  const existing = await pool.query(
    "SELECT id, owner_telegram_id, title, slug FROM wishlists WHERE owner_telegram_id = $1 ORDER BY id LIMIT 1",
    [ownerTelegramId]
  );
  if (existing.rows[0]) return existing.rows[0];
  const slugBase = username
    ? username.toLowerCase().replace(/\W/g, "")
    : `id${ownerTelegramId}`;
  let slug = slugBase;
  let n = 0;
  while (true) {
    const clash = await pool.query("SELECT 1 FROM wishlists WHERE slug = $1", [
      slug,
    ]);
    if (clash.rowCount === 0) break;
    slug = `${slugBase}${++n}`;
  }
  const ins = await pool.query(
    `INSERT INTO wishlists (owner_telegram_id, title, slug) VALUES ($1, 'Мой вишлист', $2)
     RETURNING id, owner_telegram_id, title, slug`,
    [ownerTelegramId, slug]
  );
  return ins.rows[0];
}

async function getWishlistBySlug(slug) {
  const res = await pool.query(
    `SELECT w.id, w.owner_telegram_id, w.title, w.slug, w.event_date, w.remind_days_before,
      u.username, u.first_name FROM wishlists w
     JOIN users u ON u.telegram_id = w.owner_telegram_id WHERE w.slug = $1`,
    [String(slug).trim()]
  );
  return res.rows[0] || null;
}

/** По ref открываем: если ref = slug — этот вишлист; иначе username/id — первый вишлист пользователя */
async function getWishlistByOwnerRef(ref) {
  const refTrimmed = String(ref).trim();
  const bySlug = await getWishlistBySlug(refTrimmed);
  if (bySlug) return bySlug;
  const idNum = parseInt(refTrimmed, 10);
  if (!Number.isNaN(idNum) && String(idNum) === refTrimmed) {
    const byId = await pool.query(
      `SELECT w.id, w.owner_telegram_id, w.title, w.slug, w.event_date, w.remind_days_before, u.username, u.first_name
       FROM wishlists w JOIN users u ON u.telegram_id = w.owner_telegram_id WHERE w.owner_telegram_id = $1 ORDER BY w.id LIMIT 1`,
      [idNum]
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const username = refTrimmed.startsWith("@")
    ? refTrimmed.slice(1)
    : refTrimmed;
  const byUsername = await pool.query(
    `SELECT w.id, w.owner_telegram_id, w.title, w.slug, w.event_date, w.remind_days_before, u.username, u.first_name
     FROM wishlists w JOIN users u ON u.telegram_id = w.owner_telegram_id WHERE LOWER(u.username) = LOWER($1) ORDER BY w.id LIMIT 1`,
    [username]
  );
  return byUsername.rows[0] || null;
}

async function listUserWishlists(telegramId) {
  const res = await pool.query(
    `SELECT id, title, slug, event_date, remind_days_before, created_at
     FROM wishlists WHERE owner_telegram_id = $1 ORDER BY event_date NULLS LAST, id`,
    [telegramId]
  );
  return res.rows;
}

async function createEvent(ownerTelegramId, title, username, firstName) {
  await ensureUser(ownerTelegramId, username, firstName);
  let slug = randomSlug();
  const exists = await pool.query("SELECT 1 FROM wishlists WHERE slug = $1", [
    slug,
  ]);
  if (exists.rowCount > 0) slug = randomSlug() + Date.now().toString(36);
  const res = await pool.query(
    `INSERT INTO wishlists (owner_telegram_id, title, slug) VALUES ($1, $2, $3)
     RETURNING id, title, slug, event_date, remind_days_before`,
    [ownerTelegramId, title || "Новое событие", slug]
  );
  return res.rows[0];
}

async function updateWishlist(wishlistId, ownerTelegramId, data) {
  const updates = [];
  const values = [];
  let i = 1;
  if (data.title !== undefined) {
    updates.push(`title = $${i++}`);
    values.push(data.title);
  }
  if (data.event_date !== undefined) {
    updates.push(`event_date = $${i++}`);
    values.push(data.event_date);
  }
  if (data.remind_days_before !== undefined) {
    updates.push(`remind_days_before = $${i++}`);
    values.push(data.remind_days_before);
  }
  if (updates.length === 0) return false;
  values.push(wishlistId, ownerTelegramId);
  const res = await pool.query(
    `UPDATE wishlists SET ${updates.join(
      ", "
    )} WHERE id = $${i} AND owner_telegram_id = $${i + 1} RETURNING id`,
    values
  );
  return res.rowCount > 0;
}

async function getWishlistByIdAndOwner(wishlistId, ownerTelegramId) {
  const res = await pool.query(
    `SELECT id, title, slug, event_date, remind_days_before FROM wishlists
     WHERE id = $1 AND owner_telegram_id = $2`,
    [wishlistId, ownerTelegramId]
  );
  return res.rows[0] || null;
}

async function getWishlistById(wishlistId) {
  const res = await pool.query(
    `SELECT id, title, slug, event_date, remind_days_before, owner_telegram_id
     FROM wishlists WHERE id = $1`,
    [wishlistId]
  );
  return res.rows[0] || null;
}

async function getGifts(wishlistId) {
  const res = await pool.query(
    `SELECT g.id, g.title, g.description, g.link, g.priority, g.reserved_by_telegram_id,
            u.username AS reserved_by_username, u.first_name AS reserved_by_name
     FROM gifts g
     LEFT JOIN users u ON u.telegram_id = g.reserved_by_telegram_id
     WHERE g.wishlist_id = $1
     ORDER BY g.priority DESC NULLS LAST, g.created_at`,
    [wishlistId]
  );
  return res.rows;
}

async function addGift(
  wishlistId,
  title,
  description = null,
  link = null,
  priority = 0
) {
  const res = await pool.query(
    `INSERT INTO gifts (wishlist_id, title, description, link, priority)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, title, description, link, priority`,
    [wishlistId, title, description, link, priority]
  );
  return res.rows[0];
}

async function updateGift(giftId, wishlistId, data) {
  const updates = [];
  const values = [];
  let i = 1;
  if (data.title !== undefined) {
    updates.push(`title = $${i++}`);
    values.push(data.title);
  }
  if (data.description !== undefined) {
    updates.push(`description = $${i++}`);
    values.push(data.description);
  }
  if (data.link !== undefined) {
    updates.push(`link = $${i++}`);
    values.push(data.link);
  }
  if (data.priority !== undefined) {
    updates.push(`priority = $${i++}`);
    values.push(data.priority);
  }
  if (updates.length === 0) return false;
  values.push(giftId, wishlistId);
  const res = await pool.query(
    `UPDATE gifts SET ${updates.join(
      ", "
    )} WHERE id = $${i} AND wishlist_id = $${i + 1} RETURNING id`,
    values
  );
  return res.rowCount > 0;
}

async function deleteGift(giftId, wishlistId) {
  const res = await pool.query(
    "DELETE FROM gifts WHERE id = $1 AND wishlist_id = $2 RETURNING id",
    [giftId, wishlistId]
  );
  return res.rowCount > 0;
}

async function getGiftByIdAndWishlist(giftId, wishlistId) {
  const res = await pool.query(
    "SELECT id, title, description, link, priority FROM gifts WHERE id = $1 AND wishlist_id = $2",
    [giftId, wishlistId]
  );
  return res.rows[0] || null;
}

async function reserveGift(giftId, telegramId, username, firstName) {
  await ensureUser(telegramId, username, firstName);
  const res = await pool.query(
    "UPDATE gifts SET reserved_by_telegram_id = $2 WHERE id = $1 AND reserved_by_telegram_id IS NULL RETURNING id",
    [giftId, telegramId]
  );
  return res.rowCount > 0;
}

async function unreserveGift(giftId, telegramId) {
  const res = await pool.query(
    "UPDATE gifts SET reserved_by_telegram_id = NULL WHERE id = $1 AND reserved_by_telegram_id = $2 RETURNING id",
    [giftId, telegramId]
  );
  return res.rowCount > 0;
}

async function getWishlistOwnerTelegramId(wishlistId) {
  const res = await pool.query(
    "SELECT owner_telegram_id FROM wishlists WHERE id = $1",
    [wishlistId]
  );
  return res.rows[0]?.owner_telegram_id ?? null;
}

async function getUserWishlistId(telegramId) {
  const res = await pool.query(
    "SELECT id FROM wishlists WHERE owner_telegram_id = $1",
    [telegramId]
  );
  return res.rows[0]?.id ?? null;
}

async function getShareLinkPayload(telegramId) {
  const res = await pool.query(
    "SELECT slug FROM wishlists WHERE owner_telegram_id = $1 ORDER BY id LIMIT 1",
    [telegramId]
  );
  return res.rows[0]?.slug ?? null;
}

async function getShareSlug(wishlistId) {
  const res = await pool.query("SELECT slug FROM wishlists WHERE id = $1", [
    wishlistId,
  ]);
  return res.rows[0]?.slug ?? null;
}

/** Вишлисты, по которым сегодня нужно отправить напоминание (ещё не отправляли сегодня) */
async function getWishlistsToRemindToday() {
  const res = await pool.query(
    `SELECT w.id, w.title, w.event_date, w.remind_days_before, w.owner_telegram_id
     FROM wishlists w
     WHERE w.event_date IS NOT NULL AND w.remind_days_before IS NOT NULL
       AND (w.event_date::date - w.remind_days_before) = CURRENT_DATE
       AND (w.reminder_sent_date IS NULL OR w.reminder_sent_date < CURRENT_DATE)`
  );
  return res.rows;
}

async function markReminderSent(wishlistId) {
  await pool.query(
    "UPDATE wishlists SET reminder_sent_date = CURRENT_DATE WHERE id = $1",
    [wishlistId]
  );
}

module.exports = {
  pool,
  initDb,
  ensureUser,
  getOrCreateWishlist,
  getWishlistByOwnerRef,
  getWishlistBySlug,
  getWishlistByIdAndOwner,
  getWishlistById,
  listUserWishlists,
  createEvent,
  updateWishlist,
  getGifts,
  addGift,
  updateGift,
  deleteGift,
  getGiftByIdAndWishlist,
  reserveGift,
  unreserveGift,
  getWishlistOwnerTelegramId,
  getUserWishlistId,
  getShareLinkPayload,
  getShareSlug,
  getWishlistsToRemindToday,
  markReminderSent,
};
