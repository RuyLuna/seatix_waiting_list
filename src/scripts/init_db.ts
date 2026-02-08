import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as sqlite from '../db/sqlite.js';
import sqlite3 from 'sqlite3';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);

const ensure = async (): Promise<void> => {
  const dbPath: string = sqlite.DB_PATH;
  const dir: string = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await sqlite.initDb();
  const db: sqlite3.Database = sqlite.getDb();
  
  // Wrap db.exec in a Promise since it's callback-based
  await new Promise<void>((resolve, reject) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS waitlist (
        entry_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        zones_preferred TEXT NOT NULL,
        quantity_wanted INTEGER NOT NULL,
        status TEXT DEFAULT 'waiting',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_waitlist_event_id
        ON waitlist (event_id);

      CREATE INDEX IF NOT EXISTS idx_waitlist_user_status
        ON waitlist (event_id, user_id, status);

      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_value TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        event_id TEXT,
        active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  ensure()
    .then(() => console.log('DB initialized'))
    .catch((err: Error) => {
      console.error(err);
      process.exit(1);
    });
}

export default ensure;
