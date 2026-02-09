# Integration Tests

This directory contains integration tests for the Seatix Waitlist API using Vitest.

## Structure

```
tests/
├── setup.mjs              # Global test setup/teardown
├── helpers/
│   ├── testUtils.mjs      # Database and test data utilities
│   └── apiClient.mjs      # API request helpers and endpoints
└── integration/
│   ├── waitlist.test.mjs  # Tests for waitlist endpoints
│   └── providers.test.mjs # Tests for provider endpoints
└── unit/
    ├── utils/
    │   └── offers.test.mjs          # Tests for offer utilities
    ├── middleware/
    │   └── apiKeyAuth.test.mjs      # Tests for auth middleware
    ├── workers/
    │   └── ticketWorker.test.mjs    # Tests for ticket release logic
    └── scripts/
        └── rebuild_redis_queues.test.mjs # Tests for queue rebuild
```

## Running Tests

```bash
# Run all tests (integration + unit)
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test tests/integration/waitlist.test.mjs

# Run only unit tests
npm test tests/unit/

# Run only integration tests
npm test tests/integration/
```

## Test Environment

- **Database**: Uses MySQL with Prisma ORM configured via `DATABASE_URL` in `.env`
- **Redis**: Connects to the Redis instance configured in `.env` or `REDIS_URL`
- **Sequential Execution**: Tests run sequentially with `singleFork: true` to avoid database conflicts
- **Isolation**: Use `cleanWaitlistData()` helper to reset state between tests

## Writing Tests

### Basic Structure

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { cleanWaitlistData, createTestApiKey } from '../helpers/testUtils.mjs';
import { endpoints, samplePayloads } from '../helpers/apiClient.mjs';

// Import Express app (will need to export app from index.ts)
const appModule = await import('../../src/index.ts');
const app = appModule.default;

describe('Waitlist API', () => {
  let apiKey;
  
  beforeEach(async () => {
    await cleanWaitlistData();
    apiKey = await createTestApiKey('test-user', 'user');
  });
  
  it('should create a waitlist entry', async () => {
    const response = await request(app)
      .post(endpoints.createWaitlistEntry('event-123'))
      .set('X-API-Key', apiKey)
      .send(samplePayloads.waitlistEntry('user-1'));
    
    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('entry_id');
  });
});
```

## Helpers Reference

### testUtils.js

- `cleanWaitlistData(eventId)` - Clean test data from MySQL/Prisma and Redis
- `getWaitlistCount(eventId, status)` - Count waitlist entries
- `getQueueLength(eventId, zone)` - Get Redis queue length
- `generateUserId()` - Generate random user ID
- `generateEventId()` - Generate random event ID

### apiClient.js

- `createHeaders(apiKey, userId)` - Generate request headers
- `endpoints` - API endpoint path builders
- `samplePayloads` - Common request payload templates

## Notes

- Tests clean up after themselves using `cleanWaitlistData()`
- Use `generateUserId()` and `generateEventId()` to avoid collisions
- MySQL/Prisma and Redis connections are managed in `setup.mjs`
- Ensure MySQL is running before executing tests (via Docker or local installation)
- Test database should be separate from development database to avoid data loss
