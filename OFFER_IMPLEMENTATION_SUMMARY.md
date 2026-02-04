# Ticket Offer System Implementation - Summary

## What Was Implemented

A complete token-based ticket offer system that:
- Creates time-limited offers when users are notified
- Stores offers in Redis with TTL (Time-To-Live)
- Provides a single-use acceptance endpoint
- Handles expiration gracefully

## Key Features

### 1. **Offer Token Generation** ([src/utils/offers.js](src/utils/offers.js))
- 32-character hexadecimal tokens (128-bit randomness)
- Unique per user per release
- Format: `offer:{token}` in Redis

### 2. **Automatic Offer Creation** ([src/workers/ticketWorker.js](src/workers/ticketWorker.js))
- Worker creates offer immediately after determining user is eligible
- Stores: event_id, user_id, zone, tickets_reserved, created_at
- Token embedded in worker response for logging/debugging

### 3. **Offer Acceptance Endpoint** ([src/routes/waitlist.js](src/routes/waitlist.js))
```
POST /waitlist/offers/{token}/accept
```

**Success (200):**
```json
{
  "success": true,
  "checkout_url": "https://seatix.com/checkout/ABC123",
  "expires_in_minutes": 10,
  "tickets_reserved": 2,
  "zone": "VIP",
  "event_id": "concert-123",
  "user_id": "alice"
}
```

**Expired (410):**
```json
{
  "success": false,
  "error": "offer_expired",
  "message": "Tu oportunidad expiró. Has sido regresado a la lista."
}
```

### 4. **Redis TTL Management**
- Default validity: 10 minutes (configurable via `OFFER_TTL_MINUTES`)
- Automatic expiration - no cleanup needed
- Single-use tokens deleted on acceptance

## Implementation Details

### Files Created
- **[src/utils/offers.js](src/utils/offers.js)** - Core offer logic
  - `generateOfferToken()` - Create random token
  - `createOffer()` - Store offer with TTL
  - `acceptOffer()` - Retrieve and delete token
  - `getOffer()` - Read offer data
  - `generateOfferEmailBody()` - Template for notifications

### Files Modified
- **[src/workers/ticketWorker.js](src/workers/ticketWorker.js)**
  - Import offers utility
  - Call `createOffer()` after determining user eligible
  - Include offer token in winner data
  
- **[src/routes/waitlist.js](src/routes/waitlist.js)**
  - Import offer functions
  - Add new route: `POST /waitlist/offers/:token/accept`
  - Handle offer acceptance/expiration

- **[.github/copilot-instructions.md](.github/copilot-instructions.md)**
  - Documented offer acceptance flow
  - Added environment variable docs
  - Updated component descriptions

### Documentation Created
- **[OFFER_TESTING_GUIDE.md](OFFER_TESTING_GUIDE.md)** - Complete testing walkthrough
- **[MIGRATION_QUANTITY_FILTERING.md](MIGRATION_QUANTITY_FILTERING.md)** - Earlier quantity feature docs

## Architecture Flow

```
Ticket Release Event
    ↓
BullMQ Queue
    ↓
Worker Process
    ├─ Check quantity eligibility
    ├─ Create offer token (Redis TTL)
    ├─ Update SQLite status='notified'
    └─ Return winner with token
    ↓
Notification System (future)
    └─ Send email with offer link
    ↓
User Accepts Offer
    ↓
POST /waitlist/offers/{token}/accept
    ├─ Validate token exists
    ├─ Delete token (single-use)
    └─ Return checkout URL
```

## Environment Variables

```bash
# Offer validity (minutes)
OFFER_TTL_MINUTES=10

# Standard vars (unchanged)
PORT=3000
REDIS_URL=redis://redis:6379
SQLITE_PATH=/data/waitlist.db
```

## Database

### Redis Keys
- Format: `offer:{token}`
- Value: JSON with offer details
- TTL: Configured via OFFER_TTL_MINUTES
- Auto-deletion: Redis handles expiration

### SQLite
- No schema changes
- Status already tracks 'notified' state
- Offers are ephemeral (not persisted)

## Security Considerations

### Current Implementation
- ✅ Token is 128-bit random (cryptographically secure)
- ✅ Single-use (deleted after acceptance)
- ✅ TTL prevents unlimited validity
- ✅ No replay attacks (token can't be reused)

### Future Improvements
- Could add rate limiting per user/IP
- Could add offer analytics (tracking accept rates)
- Could add manual offer revocation endpoint
- Could integrate with user authentication

## Testing Workflow

See [OFFER_TESTING_GUIDE.md](OFFER_TESTING_GUIDE.md) for detailed scenarios, but quick test:

```bash
# 1. Start system
docker compose up --build

# 2. Create waitlist entries
curl -X POST http://localhost:3000/waitlist/events/event-1/waitlist \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user1", "zones_preferred": ["VIP"], "quantity_wanted": 2}'

# 3. Release tickets (worker creates offer)
curl -X POST http://localhost:3000/waitlist/events/event-1/release-tickets \
  -H "Content-Type: application/json" \
  -d '{"zones": {"VIP": 2}}'

# 4. Check worker logs for token
docker logs seatix_waiting_list-app-1 | grep "offer token"

# 5. Accept offer using token from logs
curl -X POST http://localhost:3000/waitlist/offers/{TOKEN_HERE}/accept

# Expected: Checkout URL returned
```

## What's NOT Included

These are out of scope per requirements:
- Actual email sending (template provided)
- Checkout integration (dummy URL generated)
- User authentication (still using x-user-id header)
- Payment processing

## Notes for Future Development

1. **Email Integration**: Use `generateOfferEmailBody()` template
2. **Analytics**: Track offer accepts/expirations in database
3. **Offer Resend**: Could implement resend endpoint for expired offers
4. **Batch Notifications**: Could queue emails separately from offer creation
5. **Webhook Notifications**: Could send offer events to external system

## Validation

All files pass syntax checks:
```bash
node -c src/utils/offers.js       ✓
node -c src/workers/ticketWorker.js  ✓
node -c src/routes/waitlist.js    ✓
```

All dependencies installed:
```bash
npm install                       ✓
bullmq@^5.34.3                    ✓
redis@^4.7.1                      ✓
express@^4.22.1                   ✓
```

Ready to deploy with `docker compose up --build`
