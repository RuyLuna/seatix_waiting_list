import { prisma } from '../db/prisma.js';
import { addApiKey } from '../middleware/apiKeyAuth.js';

/**
 * Script to create and manage API keys
 * Usage: node create_api_key.js <name>
 * Example: node create_api_key.js "Production API"
 */

const main = async (): Promise<void> => {
  const args: string[] = process.argv.slice(2);
  const name: string = args[0] || 'Default API Key';

  try {
    const result: { id: number; name: string } = await addApiKey(name);
    console.log('\n✓ API Key created successfully!\n');
    console.log(`Name: ${result.name}`);
    console.log(`ID: ${result.id}`);
    console.log(`Key: ${result.name}`);
    console.log('\nStore this key securely. Use it in requests with the X-API-Key header.\n');
    process.exit(0);
  } catch (err) {
    console.error('Error creating API key:', (err as Error).message);
    process.exit(1);
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
