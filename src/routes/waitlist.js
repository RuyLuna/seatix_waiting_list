const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const { client } = require('../cache/redis');
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

    // Generate entry_id
    const entry_id = crypto.randomUUID();
    
    const database = db.getDb();
    
    // Insert new entry - this will fail if unique constraint is violated
    try {
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
    } catch (dbError) {
      // Check if it's a unique constraint violation
      if (dbError.message && dbError.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ 
          error: 'Ya estás registrado en la lista de espera para estas zonas en este evento',
          detail: 'User already registered for these zones in this event'
        });
      }
      // Re-throw other database errors
      throw dbError;
    }
    
    // Only add to Redis if SQLite insert was successful
    const positions = {};
    for (const zone of zones_preferred) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      await client.lPush(queueKey, user_id);
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
        const position = queue.indexOf(userId);
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
    for (const zone of zonesPreferred) {
      const queueKey = `waitlist:event:${eventId}:zone:${zone}`;
      await client.lRem(queueKey, 0, userId); // Remove all occurrences
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

const create_legacy_waitlist = async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    const id = await db.add({ name, email });
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const delete_legacy_waitlist = async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.remove(id);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const release_tickets = async (req, res) => {
  try {
    const { eventId } = req.params;
    const { zones } = req.body;

    if (!zones || typeof zones !== 'object') {
      return res.status(400).json({ error: 'zones object is required (e.g., { "VIP": 5, "General": 10 })' });
    }

    const winners = [];

    // Process each zone
    for (const [zone, quantity] of Object.entries(zones)) {
      // Pop users from the Redis zone queue
      for (let i = 0; i < quantity; i++) {
        try {
          const userId = await client.rPop(`waitlist:event:${eventId}:zone:${zone}`);
          
          if (userId) {
            winners.push({
              user_id: userId,
              zone: zone,
              ticket_position: i + 1
            });

            // Update SQLite to mark user as notified
            const database = db.getDb();
            await new Promise((resolve, reject) => {
              database.run(
                'UPDATE waitlist SET status = ? WHERE event_id = ? AND user_id = ?',
                ['notified', eventId, userId],
                function(err) {
                  if (err) reject(err);
                  else resolve(this.changes);
                }
              );
            });
          }
        } catch (err) {
          console.error(`Error popping user from ${zone} queue:`, err);
        }
      }
    }

    res.json({
      success: true,
      event_id: eventId,
      total_winners: winners.length,
      zone_breakdown: Object.entries(zones).map(([zone, qty]) => ({
        zone: zone,
        requested: qty,
        actual_winners: winners.filter(w => w.zone === zone).length
      })),
      winners: winners
    });
  } catch (err) {
    console.error('Error in release-tickets:', err);
    res.status(500).json({ error: err.message });
  }
};

// Routes
router.get('/', api_working);

// Rutas de la lista de espera por evento
router.get('/events/:eventId/waitlist/me', get_waitlist_me); // Recibe el user id por los headers ya que no existe autenticacion
router.post('/events/:eventId/waitlist', create_waitlist_entry);
router.delete('/events/:eventId/waitlist/me', delete_waitlist_me);

router.post('/', create_legacy_waitlist);
router.delete('/:id', delete_legacy_waitlist);

// Ruta para simular la liberación de boletos
router.post('/events/:eventId/release-tickets', release_tickets);

module.exports = router;
