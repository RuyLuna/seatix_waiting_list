import * as db from '../db/sqlite.js';
import sqlite3 from 'sqlite3';

// Interface for test API key structure
interface TestApiKey {
  name: string;
  key_value: string;
  role: 'user' | 'promoter' | 'admin';
  event_id: string | null;
}

// Interface for existing key row
interface ExistingKeyRow {
  id: number;
}

/**
 * Seed test API keys for development
 * Roles:
 * - user: Can use normal waitlist endpoints
 * - promoter: Can use provider endpoints for their events
 * - admin: Full access to all endpoints
 */
async function seedApiKeys(): Promise<void> {
  try {
    const database = db.getDb();

    const testKeys: TestApiKey[] = [
      {
        name: 'Test User',
        key_value: 'sk_test_user_12345',
        role: 'user',
        event_id: null
      },
      {
        name: 'Test Promoter (Event Owner)',
        key_value: 'sk_test_promoter_abc123',
        role: 'promoter',
        event_id: 'concert-123' // This promoter owns this event
      },
      {
        name: 'Test Promoter (Other)',
        key_value: 'sk_test_promoter_xyz789',
        role: 'promoter',
        event_id: 'concert-456' // This promoter owns a different event
      },
      {
        name: 'Test Admin',
        key_value: 'sk_test_admin_000000',
        role: 'admin',
        event_id: null
      }
    ];

    for (const key of testKeys) {
      // Check if key already exists
      const existing = await new Promise<ExistingKeyRow | undefined>((resolve, reject) => {
        database.get(
          'SELECT id FROM api_keys WHERE key_value = ?',
          [key.key_value],
          (err: Error | null, row: ExistingKeyRow | undefined) => err ? reject(err) : resolve(row)
        );
      });

      if (!existing) {
        await new Promise<sqlite3.RunResult>((resolve, reject) => {
          database.run(
            'INSERT INTO api_keys (name, key_value, role, event_id, active) VALUES (?, ?, ?, ?, 1)',
            [key.name, key.key_value, key.role, key.event_id],
            function(this: sqlite3.RunResult, err: Error | null) {
              if (err) reject(err);
              else {
                console.log(`[Seed] Created API key: ${key.name} (${key.role})`);
                resolve(this);
              }
            }
          );
        });
      } else {
        console.log(`[Seed] API key already exists: ${key.name}`);
      }
    }

    console.log('[Seed] API keys seeded successfully');
  } catch (err) {
    console.error('[Seed] Error seeding API keys:', (err as Error).message);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sqlite = await import('../db/sqlite.js');
  sqlite.initDb()
    .then(() => seedApiKeys())
    .then(() => {
      console.log('Seeding complete');
      process.exit(0);
    })
    .catch((err: Error) => {
      console.error(err);
      process.exit(1);
    });
}

export default seedApiKeys;
