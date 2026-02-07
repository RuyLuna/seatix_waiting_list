import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as sqlite from '../db/sqlite.js';
import { addApiKey } from '../middleware/apiKeyAuth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Script to create and manage API keys
 * Usage: node create_api_key.js <name>
 * Example: node create_api_key.js "Production API"
 */

const ensure = async () => {
  const dbPath = sqlite.DB_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await sqlite.initDb();
};

const main = async () => {
  const args = process.argv.slice(2);
  const name = args[0] || 'Default API Key';

  try {
    await ensure();
    const result = await addApiKey(name);
    console.log('\n✓ API Key created successfully!\n');
    console.log(`Name: ${result.name}`);
    console.log(`ID: ${result.id}`);
    console.log(`Key: ${result.name}`);
    console.log('\nStore this key securely. Use it in requests with the X-API-Key header.\n');
    process.exit(0);
  } catch (err) {
    console.error('Error creating API key:', err);
    process.exit(1);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { ensure };
