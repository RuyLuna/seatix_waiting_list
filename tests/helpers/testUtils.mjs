import { client } from '../../dist/cache/redis.js';
import * as db from '../../dist/db/sqlite.js';

/**
 * Test utility functions for integration tests
 */

/**
 * Clean all waitlist data from Redis and SQLite
 * @param {string} eventId - Optional event ID to clean specific event
 */
export async function cleanWaitlistData(eventId = null) {
  const database = db.getDb();
  
  // Clean SQLite
  if (eventId) {
    await new Promise((resolve, reject) => {
      database.run('DELETE FROM waitlist WHERE event_id = ?', [eventId], 
        err => err ? reject(err) : resolve()
      );
    });
  } else {
    await new Promise((resolve, reject) => {
      database.run('DELETE FROM waitlist', [], 
        err => err ? reject(err) : resolve()
      );
    });
  }
  
  // Clean Redis queues
  const pattern = eventId 
    ? `waitlist:event:${eventId}:*` 
    : 'waitlist:event:*';
  
  const keys = await client.keys(pattern);
  if (keys.length > 0) {
    await client.del(keys);
  }
  
  // Clean offer keys
  const offerKeys = await client.keys('offer:*');
  if (offerKeys.length > 0) {
    await client.del(offerKeys);
  }
}

/**
 * Get waitlist entry count for an event
 * @param {string} eventId 
 * @param {string} status - Optional status filter
 * @returns {Promise<number>}
 */
export async function getWaitlistCount(eventId, status = null) {
  const database = db.getDb();
  
  const query = status
    ? 'SELECT COUNT(*) as count FROM waitlist WHERE event_id = ? AND status = ?'
    : 'SELECT COUNT(*) as count FROM waitlist WHERE event_id = ?';
  
  const params = status ? [eventId, status] : [eventId];
  
  return new Promise((resolve, reject) => {
    database.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
}

/**
 * Get Redis queue length for a specific zone
 * @param {string} eventId 
 * @param {string} zone 
 * @returns {Promise<number>}
 */
export async function getQueueLength(eventId, zone) {
  const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
  return await client.lLen(queueKey);
}

/**
 * Generate a random user ID for testing
 * @returns {string}
 */
export function generateUserId() {
  return `test-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a random event ID for testing
 * @returns {string}
 */
export function generateEventId() {
  return `test-event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
