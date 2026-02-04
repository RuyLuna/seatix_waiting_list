const db = require('../db/sqlite');
const { client } = require('../cache/redis');

/**
 * Rebuild Redis queues from SQLite on app startup
 * This ensures Redis queues are in sync if Redis was restarted or cleared
 */
async function rebuildRedisQueues() {
  try {
    console.log('Checking if Redis queues need rebuilding...');
    
    const database = db.getDb();
    
    // Get all waiting users from SQLite, ordered by created_at (oldest first)
    const waitingUsers = await new Promise((resolve, reject) => {
      database.all(
        `SELECT event_id, user_id, zones_preferred, quantity_wanted, created_at 
         FROM waitlist 
         WHERE status = 'waiting' 
         ORDER BY created_at ASC`,
        [],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });

    if (waitingUsers.length === 0) {
      console.log('No waiting users found in database. Redis queues are empty.');
      return;
    }

    console.log(`Found ${waitingUsers.length} waiting users in database.`);

    // Group by event and zone
    const queueData = {};
    
    for (const user of waitingUsers) {
      const zones = JSON.parse(user.zones_preferred);
      
      for (const zone of zones) {
        const queueKey = `waitlist:event:${user.event_id}:zone:${zone}`;
        
        if (!queueData[queueKey]) {
          queueData[queueKey] = [];
        }
        
        // Store as "userId:quantity" format
        queueData[queueKey].push(`${user.user_id}:${user.quantity_wanted}`);
      }
    }

    // Check each queue and rebuild if empty
    let rebuiltCount = 0;
    
    for (const [queueKey, userEntries] of Object.entries(queueData)) {
      const currentLength = await client.lLen(queueKey);
      
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
      console.log(`Successfully rebuilt ${rebuiltCount} Redis queues from SQLite`);
    } else {
      console.log('All Redis queues are already populated');
    }
    
  } catch (err) {
    console.error('Error rebuilding Redis queues:', err);
    throw err;
  }
}

module.exports = { rebuildRedisQueues };
