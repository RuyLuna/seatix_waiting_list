const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { validateApiKey } = require('../middleware/apiKeyAuth');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'waitlist.db');

// GET /providers/:eventId/waitlist - Requires API key
router.get('/:eventId/waitlist', validateApiKey, async (req, res) => {
  try {
    console.log("Received provider waitlist request for event:", req.params.eventId);
    const { eventId } = req.params;

    const db = new sqlite3.Database(DB_PATH);

    // Get all waitlist entries for this event ordered by position
    db.all(
      `SELECT 
        entry_id, 
        user_id, 
        zones_preferred, 
        quantity_wanted, 
        status, 
        created_at,
        ROW_NUMBER() OVER (ORDER BY created_at ASC) as position
       FROM waitlist 
       WHERE event_id = ? 
       ORDER BY created_at ASC`,
      [eventId],
      async (err, rows) => {
        if (err) {
          db.close();
          console.error('Error fetching waitlist:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        // For demo purposes: extract user data from user_id (in a real app, you'd join with a users table)
        // This is placeholder - adjust based on your actual user storage
        const entries = rows.map(row => ({
          position: row.position,
          user: {
            id: row.user_id,
            name: `User ${row.user_id}`, // Placeholder - fetch from users table
            email: `user${row.user_id}@example.com` // Placeholder
          },
          zones_preferred: row.zones_preferred.split(','),
          quantity_wanted: row.quantity_wanted,
          status: row.status
        }));

        // Calculate summary
        const summary = {
          total_waiting: entries.filter(e => e.status === 'waiting').length,
          by_zone: {}
        };

        entries.forEach(entry => {
          entry.zones_preferred.forEach(zone => {
            summary.by_zone[zone] = (summary.by_zone[zone] || 0) + 1;
          });
        });

        db.close();

        res.json({
          entries,
          summary
        });
      }
    );
  } catch (err) {
    console.error('Error in GET /events/:eventId/waitlist:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
