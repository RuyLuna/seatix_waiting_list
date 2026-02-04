const express = require('express');
const router = express.Router();
const db = require('../db/sqlite');
const { client } = require('../cache/redis');
const crypto = require('crypto');

// GET /waitlist
router.get('/', async (req, res) => {
  try {
    res.json({
        success: true
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /events/:eventId/waitlist
router.post('/events/:eventId/waitlist', async (req, res) => {
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
    
    // Insert new entry
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
    
    // Calculate position (count entries with earlier created_at)
    const positionResult = await new Promise((resolve, reject) => {
      database.get(
        'SELECT COUNT(*) as count FROM waitlist WHERE event_id = ? AND created_at <= datetime("now")',
        [eventId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    const position = positionResult.count;
    
    // Clear cache
    await client.del(`waitlist:event:${eventId}`);
    
    res.status(201).json({
      entry_id,
      position,
      zones_preferred,
      quantity_wanted,
      status: 'waiting',
      created_at: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /events/:eventId/waitlist/me
router.get('/events/:eventId/waitlist/me', async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header is required' });
    }

    const database = db.getDb();
    
    // Get user's waitlist entry
    const userEntry = await new Promise((resolve, reject) => {
      database.get(
        'SELECT entry_id, status, created_at FROM waitlist WHERE event_id = ? AND user_id = ?',
        [eventId, userId],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    
    if (!userEntry) {
      return res.status(404).json({ error: 'User not found in waitlist for this event' });
    }
    
    // Calculate estimated_ahead (count of entries with earlier created_at)
    const aheadResult = await new Promise((resolve, reject) => {
      database.get(
        'SELECT COUNT(*) as count FROM waitlist WHERE event_id = ? AND created_at < ?',
        [eventId, userEntry.created_at],
        (err, row) => err ? reject(err) : resolve(row)
      );
    });
    
    res.json({
      entry_id: userEntry.entry_id,
      position: userEntry.position,
      status: userEntry.status,
      estimated_ahead: aheadResult.count,
      created_at: userEntry.created_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /events/:eventId/waitlist/me
router.delete('/events/:eventId/waitlist/me', async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.headers['x-user-id'];
    
    if (!userId) {
      return res.status(400).json({ error: 'x-user-id header is required' });
    }

    const database = db.getDb();
    
    // Delete user's waitlist entry
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
    
    // Clear cache
    await client.del(`waitlist:event:${eventId}`);
    
    res.json({
      success: true,
      message: 'Has sido removido de la lista de espera'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /waitlist
router.post('/', async (req, res) => {
  try {
    const { name, email } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'name and email required' });

    const id = await db.add({ name, email });
    await client.del('waitlist:all');
    res.status(201).json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /waitlist/:id
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.remove(id);
    await client.del('waitlist:all');
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
