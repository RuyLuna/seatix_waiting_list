const redis = require('redis');
const db = require('../db/sqlite');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

let subscriber;

/**
 * Start listening for Redis keyspace notifications on expired keys
 * When an offer expires, update SQLite status and optionally re-add user to queue
 */
async function startExpirationListener() {
  try {
    // Create a separate Redis client for pub/sub
    subscriber = redis.createClient({ url: REDIS_URL });
    
    subscriber.on('error', (err) => {
      console.error('[Expiration Listener] Redis Error:', err.message);
    });

    await subscriber.connect();
    console.log('[Expiration Listener] Connected to Redis');

    // Subscribe to keyspace notifications for expired events
    // Pattern: __keyevent@0__:expired matches all expired keys in database 0
    await subscriber.pSubscribe('__keyevent@0__:expired', async (message, channel) => {
      // message contains the expired key name
      await handleExpiredKey(message);
    });

    console.log('[Expiration Listener] Subscribed to Redis expiration events');
  } catch (err) {
    console.error('[Expiration Listener] Failed to start:', err);
    throw err;
  }
}

/**
 * Handle an expired Redis key
 * If it's an offer key, update SQLite and re-add user to queue
 */
async function handleExpiredKey(expiredKey) {
  try {
    // Check if this is an offer key (not metadata)
    if (!expiredKey.startsWith('offer:') || expiredKey.endsWith(':meta')) {
      return; // Not an offer, or it's metadata (which doesn't expire)
    }

    const token = expiredKey.replace('offer:', '');
    const metaKey = `${expiredKey}:meta`;

    console.log(`[Expiration Listener] Offer expired: ${token}`);

    // Get metadata to find user info
    const { client } = require('../cache/redis');
    const metaData = await client.get(metaKey);

    if (!metaData) {
      console.warn(`[Expiration Listener] No metadata found for expired offer ${token}`);
      return;
    }

    const offer = JSON.parse(metaData);
    const { event_id, user_id, zone, tickets_reserved } = offer;

    console.log(`[Expiration Listener] Processing expired offer for user ${user_id} (event: ${event_id}, zone: ${zone})`);

    // Update SQLite status back to 'waiting' (user returns to queue)
    const database = db.getDb();
    await new Promise((resolve, reject) => {
      database.run(
        'UPDATE waitlist SET status = ? WHERE event_id = ? AND user_id = ? AND status = ?',
        ['waiting', event_id, user_id, 'notified'],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    // Re-add user to Redis queue with their original quantity
    const queueKey = `waitlist:event:${event_id}:zone:${zone}`;
    
    // Get quantity_wanted from SQLite
    const userEntry = await new Promise((resolve, reject) => {
      database.get(
        'SELECT quantity_wanted FROM waitlist WHERE event_id = ? AND user_id = ?',
        [event_id, user_id],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (userEntry) {
      const redisValue = `${user_id}:${userEntry.quantity_wanted}`;
      await client.lPush(queueKey, redisValue);
      console.log(`[Expiration Listener] User ${user_id} returned to queue for zone ${zone}`);
    }

    // Clean up metadata key
    await client.del(metaKey);
    
    console.log(`[Expiration Listener] Successfully processed expired offer for user ${user_id}`);
  } catch (err) {
    console.error('[Expiration Listener] Error handling expired key:', expiredKey, err);
  }
}

/**
 * Stop the expiration listener gracefully
 */
async function stopExpirationListener() {
  if (subscriber) {
    await subscriber.pUnsubscribe();
    await subscriber.quit();
    console.log('[Expiration Listener] Stopped');
  }
}

module.exports = {
  startExpirationListener,
  stopExpirationListener
};
