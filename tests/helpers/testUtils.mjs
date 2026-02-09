import { client } from '../../dist/cache/redis.js';
import { prisma } from '../../dist/db/prisma.js';

/**
 * Test utility functions for integration tests
 */

/**
 * Clean all waitlist data from Redis and MySQL/Prisma
 * @param {string} eventId - Optional event ID to clean specific event
 */
export async function cleanWaitlistData(eventId = null) {
  // Clean MySQL using Prisma
  if (eventId) {
    await prisma.waitlist.deleteMany({
      where: {
        eventId: eventId
      }
    });
  } else {
    await prisma.waitlist.deleteMany();
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
  const where = status 
    ? { eventId: eventId, status: status }
    : { eventId: eventId };
  
  return await prisma.waitlist.count({ where });
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
