# API Key Authentication Guide

## Overview

The `GET /events/{eventId}/waitlist` endpoint requires API key authentication via the `X-API-Key` header. API keys are stored securely in SQLite with hashed values.

## Architecture

### Components

1. **Middleware** (`src/middleware/apiKeyAuth.js`)
   - `validateApiKey(req, res, next)` - Express middleware that validates incoming API keys
   - `addApiKey(name)` - Utility to create and store new API keys
   - `hashApiKey(key)` - Hashes keys using SHA-256 before storage

2. **Database** (`src/scripts/init_db.js`)
   - `api_keys` table stores API key metadata
   - Keys are stored as SHA-256 hashes for security
   - Columns: `id`, `name`, `key_hash`, `active`, `created_at`

3. **Events Routes** (`src/routes/events.js`)
   - Protected endpoint: `GET /events/:eventId/waitlist`
   - Returns waitlist with user positions, zones, and summary

## Creating API Keys

### Option 1: Using the Script

```bash
# Create a new API key
node src/scripts/create_api_key.js "My API Client"

# Output example:
# ✓ API Key created successfully!
# 
# Name: My API Client
# ID: 1
# Key: a1b2c3d4e5f6... (64 character hex string)
```

The key will be stored hashed in the database. **Save the key immediately** - you cannot retrieve it later.

### Option 2: Direct Database Query (Docker)

```bash
# Access the SQLite database directly
docker exec -it seatix_waiting_list-app-1 sqlite3 data/waitlist.db

# Query to see all keys:
sqlite> SELECT id, name, active, created_at FROM api_keys;
```

## Using the API

### Making Authenticated Requests

Include the `X-API-Key` header with your requests:

```bash
curl -X GET "http://localhost:3000/events/event-123/waitlist" \
  -H "X-API-Key: your_api_key_here"
```

### Example Response

```json
{
  "entries": [
    {
      "position": 1,
      "user": {
        "id": "user-456",
        "name": "Ana García",
        "email": "ana@example.com"
      },
      "zones_preferred": ["VIP"],
      "quantity_wanted": 4,
      "status": "waiting"
    },
    {
      "position": 2,
      "user": {
        "id": "user-789",
        "name": "Carlos López",
        "email": "carlos@example.com"
      },
      "zones_preferred": ["General", "Platino"],
      "quantity_wanted": 2,
      "status": "waiting"
    }
  ],
  "summary": {
    "total_waiting": 156,
    "by_zone": {
      "VIP": 45,
      "Platino": 67,
      "General": 44
    }
  }
}
```

### Error Responses

**Missing API Key:**
```bash
curl -X GET "http://localhost:3000/events/event-123/waitlist"
# Response (401): { "error": "Missing X-API-Key header" }
```

**Invalid API Key:**
```bash
curl -X GET "http://localhost:3000/events/event-123/waitlist" \
  -H "X-API-Key: invalid_key"
# Response (403): { "error": "Invalid API key" }
```

## Security Best Practices

1. **Hash Storage**: API keys are hashed using SHA-256 before storage
2. **No Plaintext**: Keys are never stored or logged in plaintext
3. **HTTPS**: Always use HTTPS in production
4. **Key Rotation**: Implement regular key rotation (deactivate old keys)
5. **Environment Variables**: Never commit API keys to version control
6. **Scoped Keys**: In production, associate keys with specific event IDs or permissions

## Storage Location

API keys are stored in the SQLite `api_keys` table:

```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Future Enhancements

- Add key expiration dates
- Implement key rotation workflows
- Add per-key rate limiting
- Track key usage and audit logs
- Support multiple API key scopes/permissions
- Add key revocation UI

## Testing

### Test with Real Data

1. Create an API key:
```bash
node src/scripts/create_api_key.js "Test Key"
```

2. Add test data to the waitlist table

3. Query the endpoint:
```bash
curl -X GET "http://localhost:3000/events/test-event/waitlist" \
  -H "X-API-Key: your_key_here"
```
