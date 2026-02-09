import redis, { RedisClientType } from 'redis';
import { prisma } from '../db/prisma.js';
import type { OfferData, UserEntry } from '../types/index.js';

const REDIS_URL: string = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let subscriber: RedisClientType | undefined;

/**
 * Start listening for Redis keyspace notifications on expired keys
 * When an offer expires, update database status and optionally re-add user to queue
 */
async function startExpirationListener(): Promise<void> {
  try {
    // Create a separate Redis client for pub/sub
    subscriber = redis.createClient({ url: REDIS_URL });
    
    subscriber.on('error', (err: Error) => {
      console.error('[Expiration Listener] Redis Error:', err.message);
    });

    await subscriber.connect();
    console.log('[Expiration Listener] Connected to Redis');

    // Subscribe to keyspace notifications for expired events
    // Pattern: __keyevent@0__:expired matches all expired keys in database 0
    await subscriber.pSubscribe('__keyevent@0__:expired', async (message: string, channel: string) => {
      // message contains the expired key name
      await handleExpiredKey(message);
    });

    console.log('[Expiration Listener] Subscribed to Redis expiration events');
  } catch (err) {
    console.error('[Expiration Listener] Failed to start:', (err as Error).message);
    throw err;
  }
}

/**
 * Handle an expired Redis key
 * If it's an offer key, update database and re-add user to queue
 */
async function handleExpiredKey(expiredKey: string): Promise<void> {
  try {
    // Check if this is an offer key (not metadata)
    if (!expiredKey.startsWith('offer:') || expiredKey.endsWith(':meta')) {
      return; // Not an offer, or it's metadata (which doesn't expire)
    }

    const token: string = expiredKey.replace('offer:', '');
    const metaKey: string = `${expiredKey}:meta`;

    console.log(`[Expiration Listener] Offer expired: ${token}`);

    // Get metadata to find user info
    const { client } = await import('../cache/redis.js');
    const metaData: string | null = await client.get(metaKey);

    if (!metaData) {
      console.warn(`[Expiration Listener] No metadata found for expired offer ${token}`);
      return;
    }

    const offer: OfferData = JSON.parse(metaData);
    const { event_id, user_id, zone, tickets_reserved } = offer;

    console.log(`[Expiration Listener] Processing expired offer for user ${user_id} (event: ${event_id}, zone: ${zone})`);

    // Update database status back to 'waiting' (user returns to queue)
    await prisma.waitlist.updateMany({
      where: {
        eventId: event_id,
        userId: user_id,
        status: 'notified'
      },
      data: {
        status: 'waiting'
      }
    });

    // Re-add user to Redis queue with their original quantity
    const queueKey: string = `waitlist:event:${event_id}:zone:${zone}`;
    
    // Get quantity_wanted from database
    const userEntry = await prisma.waitlist.findFirst({
      where: {
        eventId: event_id,
        userId: user_id
      },
      select: {
        quantityWanted: true
      }
    });

    if (userEntry) {
      const redisValue: string = `${user_id}:${userEntry.quantityWanted}`;
      await client.lPush(queueKey, redisValue);
      console.log(`[Expiration Listener] User ${user_id} returned to queue for zone ${zone}`);
    }

    // Clean up metadata key
    await client.del(metaKey);
    
    console.log(`[Expiration Listener] Successfully processed expired offer for user ${user_id}`);
  } catch (err) {
    console.error('[Expiration Listener] Error handling expired key:', expiredKey, (err as Error).message);
  }
}

/**
 * Stop the expiration listener gracefully
 */
async function stopExpirationListener(): Promise<void> {
  if (subscriber) {
    await subscriber.pUnsubscribe();
    await subscriber.quit();
    console.log('[Expiration Listener] Stopped');
  }
}

export {
  startExpirationListener,
  stopExpirationListener
};
