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
    ├── waitlist.test.mjs  # Tests for waitlist endpoints (to be created)
    └── providers.test.mjs # Tests for provider endpoints (to be created)
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm test tests/integration/waitlist.test.mjs
```

## Test Environment

- **Database**: Uses the same SQLite database configured in `.env` or `SQLITE_PATH`
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

- `cleanWaitlistData(eventId)` - Clean test data from SQLite and Redis
- `createTestApiKey(name, role, allowedEvents)` - Create API key for testing
- `cleanTestApiKeys(prefix)` - Remove test API keys
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
- API keys created with `test-` prefix can be bulk-deleted with `cleanTestApiKeys()`
- Use `generateUserId()` and `generateEventId()` to avoid collisions
- SQLite and Redis connections are managed in `setup.js`
