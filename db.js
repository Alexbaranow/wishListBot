const { Pool } = require("pg");

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL || "postgresql://localhost:5432/wishlist_bot",
});

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
      owner_telegram_id BIGINT UNIQUE NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS gifts (
      id SERIAL PRIMARY KEY,
      wishlist_id INT NOT NULL REFERENCES wishlists(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reserved_by_telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_gifts_wishlist ON gifts(wishlist_id);
    CREATE INDEX IF NOT EXISTS idx_wishlists_owner ON wishlists(owner_telegram_id);
  `);
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
  const wl = await pool.query(
    `INSERT INTO wishlists (owner_telegram_id) VALUES ($1)
     ON CONFLICT (owner_telegram_id) DO UPDATE SET owner_telegram_id = wishlists.owner_telegram_id
     RETURNING id, owner_telegram_id`,
    [ownerTelegramId]
  );
  if (wl.rowCount === 0) {
    const existing = await pool.query(
      "SELECT id, owner_telegram_id FROM wishlists WHERE owner_telegram_id = $1",
      [ownerTelegramId]
    );
    return existing.rows[0];
  }
  return wl.rows[0];
}

async function getWishlistByOwnerRef(ref) {
  const refTrimmed = String(ref).trim();
  const idNum = parseInt(refTrimmed, 10);
  if (!Number.isNaN(idNum) && String(idNum) === refTrimmed) {
    const byId = await pool.query(
      "SELECT w.id, w.owner_telegram_id, u.username, u.first_name FROM wishlists w JOIN users u ON u.telegram_id = w.owner_telegram_id WHERE w.owner_telegram_id = $1",
      [idNum]
    );
    if (byId.rows[0]) return byId.rows[0];
  }
  const username = refTrimmed.startsWith("@")
    ? refTrimmed.slice(1)
    : refTrimmed;
  const byUsername = await pool.query(
    "SELECT w.id, w.owner_telegram_id, u.username, u.first_name FROM wishlists w JOIN users u ON u.telegram_id = w.owner_telegram_id WHERE LOWER(u.username) = LOWER($1)",
    [username]
  );
  return byUsername.rows[0] || null;
}

async function getGifts(wishlistId) {
  const res = await pool.query(
    `SELECT g.id, g.title, g.reserved_by_telegram_id, u.username AS reserved_by_username, u.first_name AS reserved_by_name
     FROM gifts g
     LEFT JOIN users u ON u.telegram_id = g.reserved_by_telegram_id
     WHERE g.wishlist_id = $1
     ORDER BY g.created_at`,
    [wishlistId]
  );
  return res.rows;
}

async function addGift(wishlistId, title) {
  const res = await pool.query(
    "INSERT INTO gifts (wishlist_id, title) VALUES ($1, $2) RETURNING id, title",
    [wishlistId, title]
  );
  return res.rows[0];
}

async function reserveGift(giftId, telegramId, username, firstName) {
  await ensureUser(telegramId, username, firstName);
  const res = await pool.query(
    "UPDATE gifts SET reserved_by_telegram_id = $2 WHERE id = $1 AND reserved_by_telegram_id IS NULL RETURNING id",
    [giftId, telegramId]
  );
  return res.rowCount > 0;
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
    "SELECT u.username, u.telegram_id FROM users u JOIN wishlists w ON w.owner_telegram_id = u.telegram_id WHERE u.telegram_id = $1",
    [telegramId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return row.username ? row.username : String(row.telegram_id);
}

module.exports = {
  pool,
  initDb,
  ensureUser,
  getOrCreateWishlist,
  getWishlistByOwnerRef,
  getGifts,
  addGift,
  reserveGift,
  getUserWishlistId,
  getShareLinkPayload,
};
