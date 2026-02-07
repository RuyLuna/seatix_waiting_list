import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'waitlist.db');

// Validate API key from headers
async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  try {
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(DB_PATH);

    db.get(
      'SELECT id, name, role, event_id FROM api_keys WHERE key_value = ? AND active = 1',
      [apiKey],
      (err, row) => {
        db.close();

        if (err) {
          console.error('Error validating API key:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        if (!row) {
          return res.status(403).json({ error: 'Invalid API key' });
        }

        // Attach API key info to request
        req.apiKeyInfo = row;
        next();
      }
    );
  } catch (err) {
    console.error('Error in API key validation:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Check if user has permission for specific endpoint
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.apiKeyInfo) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { role } = req.apiKeyInfo;

    // Admin has access to everything
    if (role === 'admin') {
      return next();
    }

    // Check if user's role is in allowed roles
    if (allowedRoles.includes(role)) {
      return next();
    }

    return res.status(403).json({ 
      error: 'Insufficient permissions',
      detail: `This endpoint requires one of these roles: ${allowedRoles.join(', ')}`
    });
  };
}

// Check if promoter owns the event
function requireEventOwnership(req, res, next) {
  if (!req.apiKeyInfo) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { role, event_id } = req.apiKeyInfo;

  // Admin can access any event
  if (role === 'admin') {
    return next();
  }

  // Promoter must own this event
  if (role === 'promoter') {
    const requestedEventId = req.params.eventId;
    
    if (event_id === requestedEventId) {
      return next();
    }

    return res.status(403).json({ 
      error: 'You do not have permission to access this event',
      detail: 'Promoters can only access their own events'
    });
  }

  return res.status(403).json({ error: 'Insufficient permissions' });
}

// Utility function to create/add an API key
async function addApiKey(name) {
  return new Promise((resolve, reject) => {
    const sqlite = sqlite3.verbose();
    const db = new sqlite.Database(DB_PATH);

    db.run(
      'INSERT INTO api_keys (name, active) VALUES (?, 1)',
      [name],
      function(err) {
        db.close();
        if (err) reject(err);
        else resolve({ id: this.lastID, name: name });
      }
    );
  });
}

export { validateApiKey, requireRole, requireEventOwnership, addApiKey };
