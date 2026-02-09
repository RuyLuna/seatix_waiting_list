import { prisma } from '../db/prisma.js';

// Interface for test API key structure
interface TestApiKey {
  name: string;
  key_value: string;
  role: 'user' | 'promoter' | 'admin';
  event_id: string | null;
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
      const existing = await prisma.apiKey.findFirst({
        where: {
          keyValue: key.key_value
        },
        select: {
          id: true
        }
      });

      if (!existing) {
        await prisma.apiKey.create({
          data: {
            name: key.name,
            keyValue: key.key_value,
            role: key.role,
            eventId: key.event_id,
            active: 1
          }
        });
        console.log(`[Seed] Created API key: ${key.name} (${key.role})`);
      } else {
        console.log(`[Seed] API key already exists: ${key.name}`);
      }
    }
  } catch (err) {
    console.error('[Seed] Error seeding API keys:', (err as Error).message);
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedApiKeys()
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
