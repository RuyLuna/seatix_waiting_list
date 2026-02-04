# Seatix Waitlist API - AI Agent Instructions

## Architecture Overview

This is a **dual-storage event waitlist system** using Node.js/Express with SQLite for persistence and Redis for queue management.

**Core Pattern**: SQLite is the source of truth for waitlist entries; Redis maintains FIFO queues per event+zone for fast position tracking and ticket releases. On startup, `rebuild_redis_queues.js` syncs Redis from SQLite if queues are empty.

**Key Components**:
- [src/index.js](src/index.js) - Entry point; initializes DB, Redis, queue worker, expiration listener, and triggers queue rebuild
- [src/routes/waitlist.js](src/routes/waitlist.js) - User-facing waitlist operations (POST, GET, DELETE) and offer acceptance
- [src/routes/providers.js](src/routes/providers.js) - Provider-facing endpoint (API key protected)
- [src/queue/ticketQueue.js](src/queue/ticketQueue.js) - BullMQ queue configuration for ticket releases
- [src/workers/ticketWorker.js](src/workers/ticketWorker.js) - Background worker processing ticket release jobs and creating offers
- [src/workers/offerExpirationListener.js](src/workers/offerExpirationListener.js) - Redis keyspace notification listener for expired offers
- [src/utils/offers.js](src/utils/offers.js) - Offer token generation and Redis TTL management
- [src/db/sqlite.js](src/db/sqlite.js) - SQLite connection wrapper
- [src/cache/redis.js](src/cache/redis.js) - Redis client singleton

## Data Flow & Critical Patterns

### Waitlist Entry Creation (POST /events/:eventId/waitlist)
1. Generate `entry_id` via `crypto.randomUUID()`
2. Insert into SQLite with unique constraint on `(event_id, user_id, zones_preferred)`
3. **Only if SQLite succeeds**: Push `userId:quantity_wanted` to Redis lists for each zone using `lPush`
4. Return positions calculated via `lLen` (1-based)

**Why**: SQLite unique constraint prevents duplicate registrations; Redis push only happens after successful DB write to maintain consistency. Storing quantity in Redis enables fast filtering during ticket releases.

### Position Queries (GET /events/:eventId/waitlist/me)
- Retrieve entry from SQLite by `(event_id, user_id)`
- For each zone: `lRange(queueKey, 0, -1)` to get full queue, then `findIndex` by parsing userId from `userId:quantity` format
- Position = `queue.length - index` (converts Redis rear position to front position)

**Why**: Redis lists are LIFO by default with `lPush`, but we pop from the rear using `rPop` for FIFO behavior. Position calculation accounts for this inversion. Entries stored as `userId:quantity` for efficient quantity-based filtering.

### Ticket Release (POST /events/:eventId/release-tickets)
- **API endpoint emits event**: Adds job to BullMQ queue instead of processing directly
- Accepts `zones` object (e.g., `{ "VIP": 5, "General": 10 }`) and optional `reason` ('cancellation'|'refund'|'courtesy_expired')
- Returns webhook-style response with `job_id` and status `'queued'`
- **Worker processes asynchronously**: 
  - Gets all users from queue via `lRange` (format: `userId:quantity`)
  - Iterates from end (oldest first) checking if `available_tickets >= quantity_wanted`
  - If yes: creates offer token, removes via `lRem`, updates SQLite to `'notified'`
  - If no: **skips user but keeps them in queue** for future releases
- **Critical**: Processes FIFO order; worker runs with concurrency=5

**Why**: Event-driven architecture prevents system overload and race conditions. Quantity-based filtering ensures users only receive notifications when enough tickets are available. BullMQ handles retries (3 attempts with exponential backoff) and provides job persistence.

### Offer Acceptance (POST /waitlist/offers/{token}/accept)
- **Token-based offer system**: Workers create single-use tokens with Redis TTL (default: 10 minutes)
- Redis structure: `offer:{token}` stored with user info and ticket count, `offer:{token}:meta` stores metadata for expiration tracking
- **Success response**: Returns checkout URL if token valid, updates SQLite to `'accepted'`
- **Expired response**: Returns `offer_expired` error if token expired/not found (410 status)
- **Single-use**: Token deleted from Redis after acceptance (prevents replay)
- Environment variable: `OFFER_TTL_MINUTES` (default 10)

### Offer Expiration Handling ([src/workers/offerExpirationListener.js](src/workers/offerExpirationListener.js))
- Listens to Redis keyspace notifications (`__keyevent@0__:expired`)
- When `offer:{token}` expires, reads `offer:{token}:meta` for user info
- Updates SQLite status back to `'waiting'` and re-adds user to Redis queue
- Cleans up metadata key after processing
- **Requires**: Redis config `--notify-keyspace-events Ex` (enabled in docker-compose.yml)

### Queue Rebuild ([src/scripts/rebuild_redis_queues.js](src/scripts/rebuild_redis_queues.js))
- Runs automatically on app startup after Redis connection
- Queries SQLite for all `status='waiting'` entries ordered by `created_at ASC`
- For each empty Redis queue, pushes users **in reverse order** as `userId:quantity` (`for (let i = userIds.length - 1; i >= 0; i--)`) so oldest users end up at the rear for FIFO processing

**Why**: Maintains data consistency after Redis restarts. Reverse order push ensures FIFO behavior when worker processes from the end of the list.

## API Key Authentication

Only `GET /providers/:eventId/waitlist` requires API keys via `X-API-Key` header.

**Important**: Current implementation in [src/middleware/apiKeyAuth.js](src/middleware/apiKeyAuth.js#L20) checks `name` column instead of hashing. See [API_KEY_AUTH.md](API_KEY_AUTH.md) for intended SHA-256 hash design (not yet implemented).

**To create keys**: `node src/scripts/create_api_key.js "Client Name"`

## Database Schema

**waitlist table**:
- `entry_id` TEXT PRIMARY KEY (UUID)
- `event_id`, `user_id`, `zones_preferred` (JSON array), `quantity_wanted`, `status` ('waiting'|'notified'|'accepted')
- Unique index: `(event_id, user_id, zones_preferred)` - **prevents duplicate registrations for same zones**
- Status flow: `waiting` → `notified` (offer created) → `accepted` (offer used) OR back to `waiting` (offer expired)

**Redis keys**: `waitlist:event:{eventId}:zone:{zoneName}` - Lists of `userId:quantity` strings (e.g., "user123:3")

## Development Workflow

**Local setup**:
```bash
npm install
npm run init-db  # Creates data/waitlist.db with schema
npm run dev      # Nodemon auto-restart
```

**Docker (recommended)**:
```bash
docker compose up --build
```

**Environment variables**:
- `PORT` (default 3000)
- `REDIS_URL` (default redis://127.0.0.1:6379, use redis://redis:6379 in Docker)
- `SQLITE_PATH` (default data/waitlist.db)
- `OFFER_TTL_MINUTES` (default 10) - How long users have to accept offers

## Common Gotchas

1. **User authentication**: No real auth exists. User identity comes from `x-user-id` header in GET/DELETE requests. This is a demo system.

2. **zones_preferred as JSON**: Stored as stringified JSON in SQLite. Always `JSON.parse()` when reading, `JSON.stringify()` when writing.

3. **Position calculation**: Redis queue order is inverted (newest at index 0, oldest at end). Position from front = `queue.length - queue.findIndex(entry => entry.split(':')[0] === userId)`. Parse userId from `userId:quantity` format.

4. **Error handling**: Check for SQLite unique constraint violations via `dbError.message.includes('UNIQUE constraint failed')` to return 409 status (see [waitlist.js](src/routes/waitlist.js#L35-L41)).

5. **Worker concurrency**: BullMQ worker processes 5 jobs concurrently. Jobs have 3 retry attempts with exponential backoff (2s base delay). Failed jobs are kept for debugging.

6. **Job persistence**: Completed jobs are kept for 1 hour (last 100), failed jobs preserved (last 500). Check Redis keys `bull:ticket-releases:*` for job data.

## Response Patterns

User endpoints return Spanish error messages (`error: 'Ya estás registrado...'`) for user-facing errors.

Provider endpoints return structured data with zone breakdowns and user details.

## Testing

No automated tests exist. Use `docker exec -it seatix_waiting_list-app-1 sqlite3 data/waitlist.db` to inspect database directly.
