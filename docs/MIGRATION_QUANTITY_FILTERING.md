# Quantity-Based Ticket Release Migration

## What Changed

The ticket release system now filters users based on their requested quantity. Users are only notified when **enough tickets are available** to fulfill their request.

### Key Changes

1. **Redis Storage Format**
   - **Before**: Stored only `userId` (e.g., `"user123"`)
   - **After**: Stores `userId:quantity` (e.g., `"user123:3"`)

2. **Worker Behavior**
   - **Before**: Released tickets to users in order, regardless of quantity needed
   - **After**: Skips users who need more tickets than available, keeps them in queue for future releases

3. **Smart Queue Processing**
   - Workers now check: `available_tickets >= user.quantity_wanted`
   - If condition fails, user stays in queue for next release
   - Processes oldest users first (FIFO), but only notifies those who can be fulfilled

## Migration Steps

### For Development

1. **Clear existing Redis data** (important - old format incompatible):
   ```bash
   # In Docker
   docker compose down -v
   docker compose up --build
   
   # Or manually flush Redis
   docker exec -it seatix_waiting_list-redis-1 redis-cli FLUSHALL
   ```

2. **Restart application**:
   - Queue rebuild script will automatically sync SQLite → Redis with new format
   - Existing waitlist entries will be converted to `userId:quantity` format

3. **Test the new behavior**:
   ```bash
   # Create users with different quantity needs
   curl -X POST http://localhost:3000/waitlist/events/event-123/waitlist \
     -H "Content-Type: application/json" \
     -d '{"user_id": "user1", "zones_preferred": ["VIP"], "quantity_wanted": 2}'
   
   curl -X POST http://localhost:3000/waitlist/events/event-123/waitlist \
     -H "Content-Type: application/json" \
     -d '{"user_id": "user2", "zones_preferred": ["VIP"], "quantity_wanted": 5}'
   
   # Release only 3 tickets
   curl -X POST http://localhost:3000/waitlist/events/event-123/release-tickets \
     -H "Content-Type: application/json" \
     -d '{"zones": {"VIP": 3}, "reason": "cancellation"}'
   
   # Result: Only user1 gets notified (needs 2), user2 stays in queue (needs 5)
   ```

## Example Scenarios

### Scenario 1: Sufficient Tickets
```
Queue: user1:2, user2:3, user3:1
Release: 10 tickets
Result: All 3 users notified (total: 6 tickets allocated)
```

### Scenario 2: Insufficient for Some
```
Queue: user1:2, user2:5, user3:1
Release: 4 tickets
Result: user1 and user3 notified (3 tickets allocated), user2 stays in queue
```

### Scenario 3: Large Request Blocks Later Users
```
Queue: user1:10, user2:2, user3:2
Release: 5 tickets
Result: user2 and user3 notified (4 tickets allocated), user1 stays in queue
```

## Worker Log Examples

**Before** (old behavior):
```
[Worker] Notified user user1 for zone VIP
[Worker] Notified user user2 for zone VIP
[Worker] Notified user user3 for zone VIP
```

**After** (new behavior with quantity filtering):
```
[Worker] Processing zone VIP with 5 available tickets
[Worker] Notified user user1 for zone VIP (wanted: 2, remaining: 3)
[Worker] Skipping user user2 - needs 10 tickets, only 3 available
[Worker] Notified user user3 for zone VIP (wanted: 3, remaining: 0)
[Worker] Zone VIP complete: 5 tickets allocated, 0 remaining
```

## Backward Compatibility

⚠️ **Breaking Change**: Existing Redis data in old format (`userId` only) is **incompatible**.

**Solution**: Clear Redis or restart with `docker compose down -v` to trigger rebuild.

## Files Modified

- [src/routes/waitlist.js](src/routes/waitlist.js) - Updated create/get/delete endpoints
- [src/workers/ticketWorker.js](src/workers/ticketWorker.js) - Quantity-aware processing
- [src/scripts/rebuild_redis_queues.js](src/scripts/rebuild_redis_queues.js) - Syncs with new format
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - Updated documentation
