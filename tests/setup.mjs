import { beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { client } from '../dist/cache/redis.js';
import { prisma } from '../dist/db/prisma.js';

/**
 * Global test setup
 * This file runs before all tests and provides shared setup/teardown logic
 */

// Setup before all tests
beforeAll(async () => {
  console.log('[Test Setup] Initializing test environment...');
  
  // Connect to Prisma (MySQL)
  await prisma.$connect();
  console.log('[Test Setup] Database connected');
  
  // Wait for Redis connection
  if (!client.isOpen) {
    await client.connect();
  }
  console.log('[Test Setup] Redis connected');
  
  console.log('[Test Setup] Test environment ready');
});

// Cleanup after all tests
afterAll(async () => {
  console.log('[Test Teardown] Cleaning up test environment...');
  
  // Close Redis connection
  if (client.isOpen) {
    await client.quit();
  }
  
  // Disconnect Prisma
  await prisma.$disconnect();
  
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
