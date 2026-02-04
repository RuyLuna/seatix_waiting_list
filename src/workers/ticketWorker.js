const { Worker } = require('bullmq');
const db = require('../db/sqlite');
const { client } = require('../cache/redis');
const { createOffer } = require('../utils/offers');

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Parse Redis URL to extract connection options
const parseRedisUrl = (url) => {
  const urlObj = new URL(url);
  return {
    host: urlObj.hostname,
    port: parseInt(urlObj.port) || 6379,
  };
};

const connection = parseRedisUrl(REDIS_URL);

/**
 * Process ticket release job
 * This function performs the actual ticket release logic:
 * 1. Get all users from Redis zone queues (format: "userId:quantity")
 * 2. Check each user's quantity_wanted against available tickets
 * 3. Only notify users if available tickets >= quantity_wanted
 * 4. Skip users who need more tickets (keep them in queue)
 * 5. Update SQLite status to 'notified' for selected users
 */
async function processTicketRelease(job) {
  const { event_id, zones, reason } = job.data;
  
  console.log(`[Worker] Processing ticket release for event ${event_id}:`, zones, `(reason: ${reason})`);
  
  const winners = [];

  // Process each zone
  for (const [zone, availableTickets] of Object.entries(zones)) {
    const queueKey = `waitlist:event:${event_id}:zone:${zone}`;
    let ticketsRemaining = availableTickets;
    
    console.log(`[Worker] Processing zone ${zone} with ${availableTickets} available tickets`);
    
    // Get all entries from the queue (format: "userId:quantity")
    const queue = await client.lRange(queueKey, 0, -1);
    
    if (queue.length === 0) {
      console.log(`[Worker] No users in queue for zone ${zone}`);
      continue;
    }
    
    // Process from the end (oldest users first - FIFO)
    for (let i = queue.length - 1; i >= 0 && ticketsRemaining > 0; i--) {
      const entry = queue[i];
      const [userId, quantityStr] = entry.split(':');
      const quantityWanted = parseInt(quantityStr, 10);
      
      if (isNaN(quantityWanted)) {
        console.error(`[Worker] Invalid quantity format in entry: ${entry}`);
        continue;
      }
      
      // Check if we have enough tickets for this user
      if (ticketsRemaining >= quantityWanted) {
        // User can be notified - remove from queue
        const removed = await client.lRem(queueKey, 1, entry);
        
        if (removed > 0) {
          // Create an offer token for this user with TTL
          const offer = await createOffer(event_id, userId, zone, quantityWanted);
          
          winners.push({
            user_id: userId,
            zone: zone,
            quantity_wanted: quantityWanted,
            tickets_allocated: quantityWanted,
            offer_token: offer.token,
            offer_expires_in_minutes: offer.expires_in_minutes
          });
          
          ticketsRemaining -= quantityWanted;

          // Update SQLite to mark user as notified
          const database = db.getDb();
          await new Promise((resolve, reject) => {
            database.run(
              'UPDATE waitlist SET status = ? WHERE event_id = ? AND user_id = ?',
              ['notified', event_id, userId],
              function(err) {
                if (err) reject(err);
                else resolve(this.changes);
              }
            );
          });

          console.log(`[Worker] Notified user ${userId} for zone ${zone} (offer token: ${offer.token})`);
          // In real system, would send email here with generateOfferEmailBody()
        }
      } else {
        // Not enough tickets - skip this user but keep them in queue
        console.log(`[Worker] Skipping user ${userId} - needs ${quantityWanted} tickets, only ${ticketsRemaining} available`);
      }
    }
    
    console.log(`[Worker] Zone ${zone} complete: ${availableTickets - ticketsRemaining} tickets allocated, ${ticketsRemaining} remaining`);
  }

  const result = {
    success: true,
    event_id: event_id,
    reason: reason,
    total_winners: winners.length,
    total_tickets_allocated: winners.reduce((sum, w) => sum + w.tickets_allocated, 0),
    zone_breakdown: Object.entries(zones).map(([zone, qty]) => {
      const zoneWinners = winners.filter(w => w.zone === zone);
      const ticketsAllocated = zoneWinners.reduce((sum, w) => sum + w.tickets_allocated, 0);
      return {
        zone: zone,
        tickets_available: qty,
        tickets_allocated: ticketsAllocated,
        tickets_remaining: qty - ticketsAllocated,
        users_notified: zoneWinners.length
      };
    }),
    winners: winners
  };

  console.log(`[Worker] Completed ticket release for event ${event_id}: ${winners.length} users notified, ${result.total_tickets_allocated} tickets allocated`);
  
  return result;
}

// Create and start the worker
let worker;

function startWorker() {
  worker = new Worker('ticket-releases', processTicketRelease, {
    connection,
    concurrency: 5, // Process up to 5 jobs concurrently
  });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err);
  });

  console.log('[Worker] Ticket release worker started');
  
  return worker;
}

function stopWorker() {
  if (worker) {
    return worker.close();
  }
}

module.exports = { startWorker, stopWorker };
