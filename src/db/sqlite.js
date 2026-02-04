const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'waitlist.db');

let db;

// Initialize database connection
function initDb() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err.message);
        reject(err);
      } else {
        console.log('Connected to SQLite database at:', DB_PATH);
        // Enable foreign keys
        db.run('PRAGMA foreign_keys = ON');
        resolve(db);
      }
    });
  });
}

// Get database instance
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

// Get all waitlist entries
function getAll() {
  return new Promise((resolve, reject) => {
    const query = 'SELECT id, name, email, created_at FROM waitlist ORDER BY created_at ASC';
    db.all(query, [], (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

// Add new waitlist entry
function add({ name, email }) {
  return new Promise((resolve, reject) => {
    const query = 'INSERT INTO waitlist (name, email) VALUES (?, ?)';
    db.run(query, [name, email], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
  });
}

// Remove waitlist entry
function remove(id) {
  return new Promise((resolve, reject) => {
    const query = 'DELETE FROM waitlist WHERE id = ?';
    db.run(query, [id], function(err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.changes);
      }
    });
  });
}

// Close database connection gracefully
function closeDb() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Database connection closed.');
          db = null;
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

module.exports = { 
  initDb, 
  getDb, 
  getAll, 
  add, 
  remove, 
  closeDb,
  DB_PATH 
};