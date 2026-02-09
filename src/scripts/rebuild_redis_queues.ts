import { client } from '../cache/redis.js';
import { prisma } from '../db/prisma.js';

// Interface for waiting user rows from database
interface WaitingUser {
  eventId: string;
  userId: string;
  zonesPreferred: string;
  quantityWanted: number;
  createdAt: Date;
}

// Interface for queue data structure
interface QueueData {
  [queueKey: string]: string[];
}

/**
 * Rebuild Redis queues from database on app startup
 * This ensures Redis queues are in sync if Redis was restarted or cleared
 */
async function rebuildRedisQueues(): Promise<void> {
  try {
    console.log('Checking if Redis queues need rebuilding...');
    
    // Get all waiting users from database, ordered by created_at (oldest first)
    const waitingUsers = await prisma.waitlist.findMany({
      where: {
        status: 'waiting'
      },
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        eventId: true,
        userId: true,
        zonesPreferred: true,
        quantityWanted: true,
        createdAt: true
      }
    });

    if (waitingUsers.length === 0) {
      console.log('No waiting users found in database. Redis queues are empty.');
      return;
    }

    console.log(`Found ${waitingUsers.length} waiting users in database.`);

    // Group by event and zone
    const queueData: QueueData = {};
    
    for (const user of waitingUsers) {
      const zones: string[] = JSON.parse(user.zonesPreferred);
      
      for (const zone of zones) {
        const queueKey = `waitlist:event:${user.eventId}:zone:${zone}`;
        
        if (!queueData[queueKey]) {
          queueData[queueKey] = [];
        }
        
        // Store as "userId:quantity" format
        queueData[queueKey].push(`${user.userId}:${user.quantityWanted}`);
      }
    }

    // Check each queue and rebuild if empty
    let rebuiltCount: number = 0;
    
    for (const [queueKey, userEntries] of Object.entries(queueData)) {
      const currentLength: number = await client.lLen(queueKey);
      
      if (currentLength === 0) {
        // Queue is empty, rebuild it
        // Push users in reverse order so oldest is at the end (FIFO with RPOP)
        for (let i = userEntries.length - 1; i >= 0; i--) {
          await client.lPush(queueKey, userEntries[i]);
        }
        
        rebuiltCount++;
        console.log(`✓ Rebuilt queue ${queueKey} with ${userEntries.length} users`);
      } else {
        console.log(`✓ Queue ${queueKey} already has ${currentLength} users, skipping`);
      }
    }

    if (rebuiltCount > 0) {
      console.log(`Successfully rebuilt ${rebuiltCount} Redis queues from database`);
    } else {
      console.log('All Redis queues are already populated');
    }
    
  } catch (err) {
    console.error('Error rebuilding Redis queues:', (err as Error).message);
    throw err;
  }
}

export { rebuildRedisQueues };
