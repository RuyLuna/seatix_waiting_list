const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const { client } = require('../cache/redis');
const { ticketQueue } = require('../queue/ticketQueue');
const { acceptOffer, getOffer } = require('../utils/offers');
const { validateApiKey, requireRole } = require('../middleware/apiKeyAuth');
const crypto = require('crypto');

const api_working = async (req, res) => {
  try {
    res.json({
        success: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const create_waitlist_entry = async (req, res) => {
  try {
    console.log("Received waitlist request:", req.params.eventId, req.body);
    const { eventId } = req.params;
    const { user_id, zones_preferred, quantity_wanted } = req.body;
    
    if (!user_id || !zones_preferred || !quantity_wanted) {
      return res.status(400).json({ error: 'user_id, zones_preferred, and quantity_wanted are required' });
    }

    const database = db.getDb();
    
    // Check if user already has an active entry for these zones (waiting or notified)
    const activeEntry = await new Promise((resolve, reject) => {
      database.get(
        `SELECT entry_id, status FROM waitlist 
         WHERE event_id = ? AND user_id = ? AND zones_preferred = ? 
         AND status IN ('waiting', 'notified')`,
        [eventId, user_id, JSON.stringify(zones_preferred)],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (activeEntry) {
      // User is already in the waitlist or has a pending offer
      return res.status(409).json({ 
        error: 'Ya estás registrado en la lista de espera para estas zonas en este evento',
        detail: 'User already registered for these zones in this event'
      });
    }
    
    // Create new entry (even if user previously had 'accepted' status - keep old record for audit)
    const entry_id = crypto.randomUUID();
    await new Promise((resolve, reject) => {
      database.run(
        `INSERT INTO waitlist (entry_id, event_id, user_id, zones_preferred, quantity_wanted, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'waiting', datetime('now'))`,
        [entry_id, eventId, user_id, JSON.stringify(zones_preferred), quantity_wanted],
        function(err) {
          if (err) reject(err);
          else resolve(this);
        }
      );
    });
    
    // Only add to Redis if SQLite insert was successful
    // Store as "userId:quantity" to enable quantity-based filtering during ticket release
    const positions = {};
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
    res.status(500).json({ error: err.message });
  }
};

const get_waitlist_me = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header is required' });
    }

    const database = db.getDb();
    
    // Get user's waitlist entry from SQLite
    const userEntry = await new Promise((resolve, reject) => {
      database.all(
        'SELECT entry_id, zones_preferred, quantity_wanted, status, created_at FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    
    if (!userEntry || userEntry.length === 0) {
      return res.status(404).json({ error: 'User not found in waitlist for this event' });
    }

    const entriesWithPositions = [];

    for (const entry of userEntry) {
      const zonesPreferred = JSON.parse(entry.zones_preferred);
      const positions = {};

      // Get user's position in each zone queue from Redis
      for (const zone of zonesPreferred) {
        const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
        // Get all users in queue and find this user's position
        const queue = await client.lRange(queueKey, 0, -1);
        // Parse userId from "userId:quantity" format
        const position = queue.findIndex(entry => entry.split(':')[0] === userId);
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
    res.status(500).json({ error: err.message });
  }
};

const delete_waitlist_me = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header is required' });
    }

    const database = db.getDb();
    
    // Get user's zones_preferred before deleting
    const userEntry = await new Promise((resolve, reject) => {
      database.get(
        'SELECT zones_preferred FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });

    if (!userEntry) {
      return res.status(404).json({ error: 'User not found in waitlist for this event' });
    }

    const zonesPreferred = JSON.parse(userEntry.zones_preferred);
    
    // Remove user from ALL zone queues in Redis
    // Need to remove entries matching userId (format: "userId:quantity")
    for (const zone of zonesPreferred) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      const queue = await client.lRange(queueKey, 0, -1);
      // Find and remove all entries for this user
      for (const entry of queue) {
        if (entry.split(':')[0] === userId) {
          await client.lRem(queueKey, 0, entry);
        }
      }
    }
    
    // Delete user's waitlist entry from SQLite
    await new Promise((resolve, reject) => {
      database.run(
        'DELETE FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        function(err) {
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
    res.status(500).json({ error: err.message });
  }
};

const release_tickets = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { zones, reason = 'cancellation' } = req.body;

    if (!zones || typeof zones !== 'object') {
      return res.status(400).json({ error: 'zones object is required (e.g., { "VIP": 5, "General": 10 })' });
    }

    if (!['cancellation', 'refund', 'courtesy_expired'].includes(reason)) {
      return res.status(400).json({ 
        error: 'reason must be one of: cancellation, refund, courtesy_expired' 
      });
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
    res.status(500).json({ error: err.message });
  }
};

// Offer acceptance endpoint
const accept_offer = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    // Try to accept the offer
    const result = await acceptOffer(token);

    if (!result) {
      // Offer expired or not found
      return res.status(410).json({
        success: false,
        error: 'offer_expired',
        message: 'Tu oportunidad expiró. Has sido regresado a la lista.'
      });
    }

    // Update SQLite status to 'accepted' (offer was successfully used)
    const database = db.getDb();
    await new Promise((resolve, reject) => {
      database.run(
        'UPDATE waitlist SET status = ? WHERE event_id = ? AND user_id = ?',
        ['accepted', result.event_id, result.user_id],
        function(err) {
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
    res.status(500).json({ error: err.message });
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

module.exports = router;
