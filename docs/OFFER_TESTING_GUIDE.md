# Ticket Offer System - Testing Guide

## Overview

The system now creates time-limited offers when users are notified of ticket availability. Each offer has a unique token stored in Redis with a TTL (default: 10 minutes).

## Flow Diagram

```
1. Release Tickets (API)
   ↓
2. Worker Processes Queue
   ├─ Finds eligible users (quantity check)
   ├─ Creates offer token
   ├─ Stores in Redis with TTL
   └─ Updates SQLite to 'notified'
   ↓
3. User Receives Email (with offer token)
   ↓
4. User Clicks Link
   ↓
5. Accept Offer Endpoint (POST /waitlist/offers/{token}/accept)
   ├─ If token exists (< 10 min): Return checkout URL
   └─ If token expired/missing: Return offer_expired error
```

## Testing Scenario

### 1. Start Fresh
```bash
docker compose down -v
docker compose up --build
```

### 2. Create Test Users
```bash
# User 1 - wants 2 tickets
curl -X POST http://localhost:3000/waitlist/events/concert-123/waitlist \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "alice",
    "zones_preferred": ["VIP"],
    "quantity_wanted": 2
  }'

# User 2 - wants 5 tickets
curl -X POST http://localhost:3000/waitlist/events/concert-123/waitlist \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "bob",
    "zones_preferred": ["VIP"],
    "quantity_wanted": 5
  }'

# User 3 - wants 3 tickets
curl -X POST http://localhost:3000/waitlist/events/concert-123/waitlist \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "charlie",
    "zones_preferred": ["VIP"],
    "quantity_wanted": 3
  }'
```

### 3. Release Tickets
```bash
curl -X POST http://localhost:3000/waitlist/events/concert-123/release-tickets \
  -H "Content-Type: application/json" \
  -d '{
    "zones": {"VIP": 5},
    "reason": "cancellation"
  }'
```

**Expected Response:**
```json
{
  "event": "tickets_released",
  "job_id": "abc123",
  "event_id": "concert-123",
  "zones": [{"zone_id": "VIP", "quantity": 5}],
  "reason": "cancellation",
  "status": "queued"
}
```

### 4. Check Worker Logs
```bash
docker logs -f seatix_waiting_list-app-1
```

**Expected Logs:**
```
[Worker] Processing zone VIP with 5 available tickets
[Offer] Created offer a1b2c3d4e5... for user alice (expires in 10 min)
[Worker] Notified user alice for zone VIP (offer token: a1b2c3d4e5...)
[Offer] Created offer f6g7h8i9j0... for user charlie (expires in 10 min)
[Worker] Notified user charlie for zone VIP (offer token: f6g7h8i9j0...)
```

**Result**: Alice (2 tickets) and Charlie (3 tickets) get offers. Bob (5 tickets needed but only 0 remaining) stays in queue.

### 5. Accept Valid Offer
```bash
# Use the token from logs, e.g., a1b2c3d4e5f6...
curl -X POST http://localhost:3000/waitlist/offers/a1b2c3d4e5f6/accept
```

**Success Response:**
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

### 6. Accept Same Offer Again (Should Fail)
```bash
curl -X POST http://localhost:3000/waitlist/offers/a1b2c3d4e5f6/accept
```

**Response (Token Already Used):**
```json
{
  "success": false,
  "error": "offer_expired",
  "message": "Tu oportunidad expiró. Has sido regresado a la lista."
}
```

Status: 410

### 7. Test Offer Expiration
```bash
# Wait 10+ minutes (or modify OFFER_TTL_MINUTES=1 for testing)

# Then try to accept the expired token
curl -X POST http://localhost:3000/waitlist/offers/f6g7h8i9j0/accept
```

**Response (Expired):**
```json
{
  "success": false,
  "error": "offer_expired",
  "message": "Tu oportunidad expiró. Has sido regresado a la lista."
}
```

Status: 410

## Configuration

### Adjust Offer Validity Duration
```bash
# Set offer to expire in 5 minutes instead of 10
docker compose -e OFFER_TTL_MINUTES=5 up
```

### For Fast Testing (1 minute offers)
In `.env` or `docker-compose.yml`:
```yaml
environment:
  - OFFER_TTL_MINUTES=1
```

## Advanced Scenarios

### Scenario A: Multiple Releases
```
Initial Queue: alice (2), bob (5), charlie (3)

Release 1: 5 tickets
├─ alice gets 2 tickets (3 remaining)
├─ charlie gets 3 tickets (0 remaining)
└─ bob stays (needs 5, 0 available)

Release 2: 8 tickets
└─ bob gets 5 tickets (3 remaining)
```

### Scenario B: Partial Fulfillment
```
Queue: user1 (10), user2 (3), user3 (2)
Release: 4 tickets

Result:
├─ user1 skipped (needs 10, only 4 available)
├─ user2 notified (3 tickets)
├─ user3 notified (1 ticket remaining... wait, user3 needs 2)
```

Actually, worker processes FIFO (oldest first from rear):
```
Result:
├─ user1 skipped (needs 10, only 4 available)
├─ user2 notified (needs 3, gets 3, 1 remaining)
└─ user3 skipped (needs 2, only 1 available)
```

## Database Inspection

### Check Redis Offers
```bash
docker exec -it seatix_waiting_list-redis-1 redis-cli

# See all offer keys
> KEYS offer:*

# Check specific offer (see TTL)
> PTTL offer:a1b2c3d4e5f6
> GET offer:a1b2c3d4e5f6
```

### Check SQLite Status
```bash
docker exec -it seatix_waiting_list-app-1 sqlite3 data/waitlist.db

# See all waitlist entries
sqlite> SELECT user_id, quantity_wanted, status FROM waitlist;

# See notified users
sqlite> SELECT user_id, status FROM waitlist WHERE status = 'notified';
```

## Real Implementation Notes

Currently, the system:
- ✅ Creates offer tokens with TTL
- ✅ Validates token existence
- ✅ Returns checkout URLs
- ✅ Implements single-use tokens
- ⏳ Does NOT actually send emails (out of scope)

To add email notifications in future:
1. Import email service in `ticketWorker.js`
2. Call `generateOfferEmailBody()` from `offers.js`
3. Send email with offer link after creating token

Example:
```javascript
const { generateOfferEmailBody } = require('../utils/offers');

// In worker after createOffer():
const emailBody = generateOfferEmailBody(
  'user@example.com',
  offer.token,
  quantityWanted,
  'Concert 2026'
);
// await emailService.send(userEmail, 'Tu oportunidad ha llegado', emailBody);
```

## Response Status Codes

| Endpoint | Status | Scenario |
|----------|--------|----------|
| POST /events/:id/release-tickets | 200 | Job queued successfully |
| POST /events/:id/release-tickets | 400 | Invalid zones format |
| POST /waitlist/offers/:token/accept | 200 | Valid offer accepted |
| POST /waitlist/offers/:token/accept | 410 | Token expired or invalid |
| POST /waitlist/offers/:token/accept | 400 | Missing token |
| POST /waitlist/offers/:token/accept | 500 | Server error |
