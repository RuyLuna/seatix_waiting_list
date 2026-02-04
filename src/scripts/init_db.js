const fs = require('fs');
const path = require('path');
const sqlite = require('../db/sqlite');

const ensure = async () => {
  const dbPath = sqlite.DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await sqlite.initDb();
  const db = sqlite.getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS waitlist (
      entry_id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      zones_preferred TEXT NOT NULL,
      quantity_wanted INTEGER NOT NULL,
      status TEXT DEFAULT 'waiting',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

if (require.main === module) {
  ensure()
    .then(() => console.log('DB initialized'))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = ensure;
