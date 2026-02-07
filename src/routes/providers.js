import express from 'express';
const router = express.Router();
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateApiKey, requireEventOwnership } from '../middleware/apiKeyAuth.js';
import { client } from '../cache/redis.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'waitlist.db');

// GET /providers/:eventId/waitlist - Requires API key and event ownership
router.get('/:eventId/waitlist', validateApiKey, requireEventOwnership, async (req, res) => {
  try {
    console.log("Received provider waitlist request for event:", req.params.eventId);
    const { eventId } = req.params;

    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(DB_PATH);

    // Get all waiting users from SQLite for this event
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT 
          entry_id, 
          user_id, 
          zones_preferred, 
          quantity_wanted, 
          status, 
          created_at
         FROM waitlist 
         WHERE event_id = ? AND status = 'waiting'
         ORDER BY created_at ASC`,
        [eventId],
        (err, rows) => {
          db.close();
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });

    // Get Redis queue data for each zone
    const zoneQueues = {};
    const allZones = new Set();
    
    // Collect all zones from user preferences
    rows.forEach(row => {
      const zones = JSON.parse(row.zones_preferred);
      zones.forEach(zone => allZones.add(zone));
    });

    // Fetch Redis queue for each zone
    for (const zone of allZones) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      const queue = await client.lRange(queueKey, 0, -1);
      zoneQueues[zone] = queue;
    }

    // Build entries with Redis positions
    const entries = rows.map(row => {
      const zones = JSON.parse(row.zones_preferred);
      const positions = {};
      
      // Get position in each zone queue from Redis
      zones.forEach(zone => {
        const queue = zoneQueues[zone] || [];
        const index = queue.indexOf(row.user_id);
        if (index !== -1) {
          // Convert to 1-based position from front (FIFO)
          positions[zone] = queue.length - index;
        } else {
          positions[zone] = null;
        }
      });

      return {
        entry_id: row.entry_id,
        user: {
          id: row.user_id,
          name: `User ${row.user_id}`, // Placeholder
          email: `user${row.user_id}@example.com` // Placeholder
        },
        zones_preferred: zones,
        quantity_wanted: row.quantity_wanted,
        status: row.status,
        positions: positions,
        created_at: row.created_at
      };
    });

    // Calculate summary from Redis queues
    const summary = {
      total_waiting: entries.length,
      by_zone: {}
    };

    for (const [zone, queue] of Object.entries(zoneQueues)) {
      summary.by_zone[zone] = queue.length;
    }

    res.json({
      entries,
      summary
    });
  } catch (err) {
    console.error('Error in GET /events/:eventId/waitlist:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
