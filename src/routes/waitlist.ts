import express, { Request, Response, NextFunction } from 'express';
const router = express.Router();
import * as db from '../db/sqlite.js';
import { client } from '../cache/redis.js';
import { ticketQueue } from '../queue/ticketQueue.js';
import { acceptOffer, getOffer } from '../utils/offers.js';
import { validateApiKey, requireRole } from '../middleware/apiKeyAuth.js';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import type { 
  WaitlistEntry, 
  CreateWaitlistBody, 
  ReleaseTicketsBody, 
  Positions 
} from '../types/index.js';

const api_working = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({
        success: true
    });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
};

const create_waitlist_entry = async (req: Request, res: Response): Promise<void> => {
  try {
    console.log("Received waitlist request:", req.params.eventId, req.body);
    const { eventId } = req.params;
    const { user_id, zones_preferred, quantity_wanted } = req.body as CreateWaitlistBody;
    
    if (!user_id || !zones_preferred || !quantity_wanted) {
      res.status(400).json({ error: 'user_id, zones_preferred, and quantity_wanted are required' });
      return;
    }

    const database = db.getDb();
    
    // Check if user already has an active entry for these zones (waiting or notified)
    const activeEntry = await new Promise<WaitlistEntry | undefined>((resolve, reject) => {
      database.get(
        `SELECT entry_id, status FROM waitlist 
         WHERE event_id = ? AND user_id = ? AND zones_preferred = ? 
         AND status IN ('waiting', 'notified')`,
        [eventId, user_id, JSON.stringify(zones_preferred)],
        (err: Error | null, row: WaitlistEntry | undefined) => err ? reject(err) : resolve(row)
      );
    });

    if (activeEntry) {
      // User is already in the waitlist or has a pending offer
      res.status(409).json({ 
        error: 'Ya estás registrado en la lista de espera para estas zonas en este evento',
        detail: 'User already registered for these zones in this event'
      });
      return;
    }
    
    // Create new entry (even if user previously had 'accepted' status - keep old record for audit)
    const entry_id = crypto.randomUUID();
    await new Promise<sqlite3.RunResult>((resolve, reject) => {
      database.run(
        `INSERT INTO waitlist (entry_id, event_id, user_id, zones_preferred, quantity_wanted, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'waiting', datetime('now'))`,
        [entry_id, eventId, user_id, JSON.stringify(zones_preferred), quantity_wanted],
        function(this: sqlite3.RunResult, err: Error | null) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });
    
    // Only add to Redis if SQLite insert was successful
    // Store as "userId:quantity" to enable quantity-based filtering during ticket release
    const positions: Positions = {};
    const redisValue = `${user_id}:${quantity_wanted}`;
    for (const zone of zones_preferred) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      await client.lPush(queueKey, redisValue);
      // Get position in this zone's queue (1-based)
      const position = await client.lLen(queueKey);
      positions[zone] = position;
    }
    
    res.status(201).json({
      entry_id,
      positions,
      zones_preferred,
      quantity_wanted,
      status: 'waiting',
      created_at: new Date().toISOString()
    });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
};

const get_waitlist_me = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      res.status(400).json({ error: 'x-user-id header is required' });
      return;
    }

    const database = db.getDb();
    
    // Get user's waitlist entry from SQLite
    const userEntry = await new Promise<WaitlistEntry[]>((resolve, reject) => {
      database.all(
        'SELECT entry_id, zones_preferred, quantity_wanted, status, created_at FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        (err: Error | null, rows: WaitlistEntry[]) => err ? reject(err) : resolve(rows)
      );
    });
    
    if (!userEntry || userEntry.length === 0) {
      res.status(404).json({ error: 'User not found in waitlist for this event' });
      return;
    }

    const entriesWithPositions: any[] = [];

    for (const entry of userEntry) {
      const zonesPreferred: string[] = JSON.parse(entry.zones_preferred);
      const positions: Positions = {};

      // Get user's position in each zone queue from Redis
      for (const zone of zonesPreferred) {
        const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
        // Get all users in queue and find this user's position
        const queue: string[] = await client.lRange(queueKey, 0, -1);
        // Parse userId from "userId:quantity" format
        const position: number = queue.findIndex((entry: string) => entry.split(':')[0] === userId);
        if (position !== -1) {
          // Position is from end (FIFO: first in = last in list), convert to 1-based from front
          positions[zone] = queue.length - position;
        } else {
          positions[zone] = null; // User not in this zone's queue (already notified?)
        }
      }

      entriesWithPositions.push({
        entry_id: entry.entry_id,
        positions,
        zones_preferred: zonesPreferred,
        quantity_wanted: entry.quantity_wanted,
        status: entry.status,
        created_at: entry.created_at
      });
    }

    res.json({
      entries: entriesWithPositions
    });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
};

const delete_waitlist_me = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const userId = req.headers['x-user-id'] as string;
    
    if (!userId) {
      res.status(400).json({ error: 'x-user-id header is required' });
      return;
    }

    const database = db.getDb();
    
    // Get user's zones_preferred before deleting
    const userEntry = await new Promise<WaitlistEntry | undefined>((resolve, reject) => {
      database.get(
        'SELECT zones_preferred FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        (err: Error | null, row: WaitlistEntry | undefined) => err ? reject(err) : resolve(row)
      );
    });

    if (!userEntry) {
      res.status(404).json({ error: 'User not found in waitlist for this event' });
      return;
    }

    const zonesPreferred: string[] = JSON.parse(userEntry.zones_preferred);
    
    // Remove user from ALL zone queues in Redis
    // Need to remove entries matching userId (format: "userId:quantity")
    for (const zone of zonesPreferred) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      const queue: string[] = await client.lRange(queueKey, 0, -1);
      // Find and remove all entries for this user
      for (const entry of queue) {
        if (entry.split(':')[0] === userId) {
          await client.lRem(queueKey, 0, entry);
        }
      }
    }
    
    // Delete user's waitlist entry from SQLite
    await new Promise<number>((resolve, reject) => {
      database.run(
        'DELETE FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        function(this: sqlite3.RunResult, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
    
    res.json({
      success: true,
      message: 'Has sido removido de la lista de espera'
    });
  } catch (err) {
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
};

const release_tickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const { zones, reason = 'cancellation' } = req.body as ReleaseTicketsBody;

    if (!zones || typeof zones !== 'object') {
      res.status(400).json({ error: 'zones object is required (e.g., { "VIP": 5, "General": 10 })' });
      return;
    }

    if (!['cancellation', 'refund', 'courtesy_expired'].includes(reason)) {
      res.status(400).json({ 
        error: 'reason must be one of: cancellation, refund, courtesy_expired' 
      });
      return;
    }

    // Add job to the queue instead of processing directly
    const job = await ticketQueue.add('release-tickets', {
      event_id: eventId,
      zones: zones,
      reason: reason,
      timestamp: new Date().toISOString()
    });

    console.log(`[API] Created ticket release job ${job.id} for event ${eventId}`);

    // Return webhook/event-like response
    res.json({
      event: 'tickets_released',
      job_id: job.id,
      event_id: eventId,
      zones: Object.entries(zones).map(([zone, quantity]) => ({
        zone_id: zone,
        quantity: quantity
      })),
      reason: reason,
      status: 'queued',
      message: 'Ticket release job has been queued for processing'
    });
  } catch (err) {
    console.error('Error in release-tickets:', err);
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
};

// Offer acceptance endpoint
const accept_offer = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.params.token as string;

    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    // Try to accept the offer
    const result = await acceptOffer(token);

    if (!result) {
      // Offer expired or not found
      res.status(410).json({
        success: false,
        error: 'offer_expired',
        message: 'Tu oportunidad expiró. Has sido regresado a la lista.'
      });
      return;
    }

    // Update SQLite status to 'accepted' (offer was successfully used)
    const database = db.getDb();
    await new Promise<number>((resolve, reject) => {
      database.run(
        'UPDATE waitlist SET status = ? WHERE event_id = ? AND user_id = ?',
        ['accepted', result.event_id, result.user_id],
        function(this: sqlite3.RunResult, err: Error | null) {
          if (err) {
            console.error('Error updating status to accepted:', err);
            reject(err);
          } else {
            console.log(`[Offer] Updated user ${result.user_id} status to 'accepted'`);
            resolve(this.changes);
          }
        }
      );
    });

    // Offer accepted successfully
    res.json(result);
  } catch (err) {
    console.error('Error accepting offer:', err);
    const error = err as Error;
    res.status(500).json({ error: error.message });
  }
};

// Routes
router.get('/', api_working);

// User endpoints - require 'user', 'promoter', or 'admin' role
router.get('/events/:eventId/waitlist/me', validateApiKey, requireRole('user', 'admin'), get_waitlist_me);
router.post('/events/:eventId/waitlist', validateApiKey, requireRole('user', 'admin'), create_waitlist_entry);
router.delete('/events/:eventId/waitlist/me', validateApiKey, requireRole('user', 'admin'), delete_waitlist_me);

// Offer acceptance - require 'user', 'promoter', or 'admin' role
router.post('/offers/:token/accept', validateApiKey, requireRole('user', 'promoter', 'admin'), accept_offer);

// Admin/Promoter only - ticket release
router.post('/events/:eventId/release-tickets', validateApiKey, requireRole('promoter', 'admin'), release_tickets);

export default router;
