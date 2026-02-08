import { Worker, Job } from 'bullmq';
import { client } from '../cache/redis.js';
import { createOffer } from '../utils/offers.js';
import { prisma } from '../db/prisma.js';
import type { 
  RedisConnection, 
  TicketReleaseJobData, 
  Winner, 
  ZoneBreakdown, 
  TicketReleaseResult 
} from '../types/index.js';

const REDIS_URL: string = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Parse Redis URL to extract connection options
const parseRedisUrl = (url: string): RedisConnection => {
  const urlObj = new URL(url);
  return {
    host: urlObj.hostname,
    port: parseInt(urlObj.port) || 6379,
  };
};

const connection: RedisConnection = parseRedisUrl(REDIS_URL);

/**
 * Process ticket release job
 * This function performs the actual ticket release logic:
 * 1. Get all users from Redis zone queues (format: "userId:quantity")
 * 2. Check each user's quantity_wanted against available tickets
 * 3. Only notify users if available tickets >= quantity_wanted
 * 4. Skip users who need more tickets (keep them in queue)
 * 5. Update database status to 'notified' for selected users
 */
async function processTicketRelease(job: Job<TicketReleaseJobData>): Promise<TicketReleaseResult> {
  const { event_id, zones, reason } = job.data;
  
  console.log(`[Worker] Processing ticket release for event ${event_id}:`, zones, `(reason: ${reason})`);
  
  const winners: Winner[] = [];

  // Process each zone
  for (const [zone, availableTickets] of Object.entries(zones)) {
    const queueKey: string = `waitlist:event:${event_id}:zone:${zone}`;
    let ticketsRemaining: number = availableTickets;
    
    console.log(`[Worker] Processing zone ${zone} with ${availableTickets} available tickets`);
    
    // Get all entries from the queue (format: "userId:quantity")
    const queue: string[] = await client.lRange(queueKey, 0, -1);
    
    if (queue.length === 0) {
      console.log(`[Worker] No users in queue for zone ${zone}`);
      continue;
    }
    
    // Process from the end (oldest users first - FIFO)
    for (let i = queue.length - 1; i >= 0 && ticketsRemaining > 0; i--) {
      const entry: string = queue[i];
      const [userId, quantityStr] = entry.split(':');
      const quantityWanted: number = parseInt(quantityStr, 10);
      
      if (isNaN(quantityWanted)) {
        console.error(`[Worker] Invalid quantity format in entry: ${entry}`);
        continue;
      }
      
      // Check if we have enough tickets for this user
      if (ticketsRemaining >= quantityWanted) {
        // User can be notified - remove from queue
        const removed: number = await client.lRem(queueKey, 1, entry);
        
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

          // Update database to mark user as notified
          await prisma.waitlist.updateMany({
            where: {
              eventId: event_id,
              userId: userId
            },
            data: {
              status: 'notified'
            }
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

  const result: TicketReleaseResult = {
    success: true,
    event_id: event_id,
    reason: reason,
    total_winners: winners.length,
    total_tickets_allocated: winners.reduce((sum, w) => sum + w.tickets_allocated, 0),
    zone_breakdown: Object.entries(zones).map(([zone, qty]): ZoneBreakdown => {
      const zoneWinners: Winner[] = winners.filter(w => w.zone === zone);
      const ticketsAllocated: number = zoneWinners.reduce((sum, w) => sum + w.tickets_allocated, 0);
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
let worker: Worker<TicketReleaseJobData, TicketReleaseResult> | undefined;

function startWorker(): Worker<TicketReleaseJobData, TicketReleaseResult> {
  worker = new Worker('ticket-releases', processTicketRelease, {
    connection,
    concurrency: 5, // Process up to 5 jobs concurrently
  });

  worker.on('completed', (job: Job<TicketReleaseJobData>) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job: Job<TicketReleaseJobData> | undefined, err: Error) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err: Error) => {
    console.error('[Worker] Worker error:', err);
  });

  console.log('[Worker] Ticket release worker started');
  
  return worker;
}

function stopWorker(): Promise<void> | undefined {
  if (worker) {
    return worker.close();
  }
  return undefined;
}

export { startWorker, stopWorker };
