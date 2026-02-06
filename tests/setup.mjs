import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

// Import CommonJS modules from src using createRequire
const require = createRequire(import.meta.url);
const { client } = require('../src/cache/redis.js');
const db = require('../src/db/sqlite.js');
const initDb = require('../src/scripts/init_db.js');

/**
 * Global test setup
 * This file runs before all tests and provides shared setup/teardown logic
 */

// Setup before all tests
beforeAll(async () => {
  console.log('[Test Setup] Initializing test environment...');
  
  // Initialize database first
  await initDb();
  console.log('[Test Setup] Database initialized');
  
  // Wait for Redis connection
  if (!client.isOpen) {
    await client.connect();
  }
  
  console.log('[Test Setup] Test environment ready');
});

// Cleanup after all tests
afterAll(async () => {
  console.log('[Test Teardown] Cleaning up test environment...');
  
  // Close Redis connection
  if (client.isOpen) {
    await client.quit();
  }
  
  // Close SQLite connection
  const database = db.getDb();
  if (database) {
    database.close();
  }
  
  console.log('[Test Teardown] Cleanup complete');
});

// Optional: Clean state between each test
beforeEach(async () => {
  // Add any per-test setup here if needed
  // For example: clear specific test data
});

afterEach(async () => {
  // Add any per-test cleanup here if needed
});
