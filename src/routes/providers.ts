import express, { Request, Response, NextFunction } from 'express';
const router = express.Router();
import { validateApiKey, requireEventOwnership } from '../middleware/apiKeyAuth.js';
import { client } from '../cache/redis.js';
import { prisma } from '../db/prisma.js';
import type { WaitlistEntry, Positions } from '../types/index.js';

// Interface for zone queues
interface ZoneQueues {
  [zone: string]: string[];
}

// Interface for summary
interface Summary {
  total_waiting: number;
  by_zone: {
    [zone: string]: number;
  };
}

// GET /providers/:eventId/waitlist - Requires API key and event ownership
router.get('/:eventId/waitlist', validateApiKey, requireEventOwnership, async (req: Request, res: Response) => {
  try {
    console.log("Received provider waitlist request for event:", req.params.eventId);
    const eventId = req.params.eventId as string;

    // Get all waiting users from Prisma for this event
    const rows = await prisma.waitlist.findMany({
      where: {
        eventId: eventId,
        status: 'waiting'
      },
      orderBy: {
        createdAt: 'asc'
      },
      select: {
        entryId: true,
        userId: true,
        zonesPreferred: true,
        quantityWanted: true,
        status: true,
        createdAt: true
      }
    });

    // Get Redis queue data for each zone
    const zoneQueues: ZoneQueues = {};
    const allZones = new Set<string>();
    
    // Collect all zones from user preferences
    rows.forEach((row) => {
      const zones: string[] = JSON.parse(row.zonesPreferred);
      zones.forEach((zone: string) => allZones.add(zone));
    });

    // Fetch Redis queue for each zone
    for (const zone of allZones) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      const queue = await client.lRange(queueKey, 0, -1);
      zoneQueues[zone] = queue;
    }

    // Build entries with Redis positions
    const entries = rows.map((row) => {
      const zones: string[] = JSON.parse(row.zonesPreferred);
      const positions: Positions = {};
      
      // Get position in each zone queue from Redis
      zones.forEach((zone: string) => {
        const queue: string[] = zoneQueues[zone] || [];
        const index: number = queue.indexOf(row.userId || '');
        if (index !== -1) {
          // Convert to 1-based position from front (FIFO)
          positions[zone] = queue.length - index;
        } else {
          positions[zone] = null;
        }
      });

      return {
        entry_id: row.entryId,
        user: {
          id: row.userId,
          name: `User ${row.userId}`, // Placeholder
          email: `user${row.userId}@example.com` // Placeholder
        },
        zones_preferred: zones,
        quantity_wanted: row.quantityWanted,
        status: row.status,
        positions: positions,
        created_at: row.createdAt
      };
    });

    // Calculate summary from Redis queues
    const summary: Summary = {
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
