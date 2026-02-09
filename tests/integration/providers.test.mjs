import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../dist/index.js';
import { cleanWaitlistData, generateUserId } from '../helpers/testUtils.mjs';

// Test API keys (seeded by seedApiKeys script)
const TEST_USER_API_KEY = 'sk_test_user_12345';
const TEST_PROMOTER_API_KEY = 'sk_test_promoter_abc123'; // Promoter for concert-123
const TEST_PROMOTER_OTHER_API_KEY = 'sk_test_promoter_xyz789'; // Promoter for concert-456
const TEST_EVENT_ID = 'concert-123';
const OTHER_EVENT_ID = 'concert-456';

describe('Providers API', () => {
  describe('GET /providers/:eventId/waitlist', () => {
    beforeEach(async () => {
      // Clean waitlist data before each test
      await cleanWaitlistData(TEST_EVENT_ID);
    });

    it('should retrieve complete waitlist for an event', async () => {
      const userId1 = generateUserId();
      const userId2 = generateUserId();
      
      // Create two waitlist entries
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId1,
          zones_preferred: ['General'],
          quantity_wanted: 2
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId2,
          zones_preferred: ['VIP', 'General'],
          quantity_wanted: 1
        });

      // Retrieve complete waitlist
      const response = await request(app)
        .get(`/providers/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('entries');
      expect(response.body).toHaveProperty('summary');
      
      // Check entries
      expect(Array.isArray(response.body.entries)).toBe(true);
      expect(response.body.entries.length).toBe(2);
      
      const entry = response.body.entries[0];
      expect(entry).toHaveProperty('entry_id');
      expect(entry).toHaveProperty('user');
      expect(entry).toHaveProperty('zones_preferred');
      expect(entry).toHaveProperty('quantity_wanted');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('positions');
      expect(entry).toHaveProperty('created_at');
      
      expect(entry.user).toHaveProperty('id');
      expect(entry.user).toHaveProperty('name');
      expect(entry.user).toHaveProperty('email');
      
      // Check summary
      expect(response.body.summary).toHaveProperty('total_waiting');
      expect(response.body.summary).toHaveProperty('by_zone');
      expect(response.body.summary.total_waiting).toBe(2);
    });

    it('should show correct zone breakdown in summary', async () => {
      const userId1 = generateUserId();
      const userId2 = generateUserId();
      const userId3 = generateUserId();
      
      // User 1: General only
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId1,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // User 2: VIP only
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId2,
          zones_preferred: ['VIP'],
          quantity_wanted: 1
        });

      // User 3: Both General and VIP
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId3,
          zones_preferred: ['General', 'VIP'],
          quantity_wanted: 1
        });

      const response = await request(app)
        .get(`/providers/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.summary.by_zone).toHaveProperty('General');
      expect(response.body.summary.by_zone).toHaveProperty('VIP');
      
      // General should have 2 users (user1 and user3)
      expect(response.body.summary.by_zone.General).toBe(2);
      // VIP should have 2 users (user2 and user3)
      expect(response.body.summary.by_zone.VIP).toBe(2);
    });

    it('should return empty entries when no users in waitlist', async () => {
      const response = await request(app)
        .get(`/providers/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.entries).toEqual([]);
      expect(response.body.summary.total_waiting).toBe(0);
      expect(Object.keys(response.body.summary.by_zone).length).toBe(0);
    });

    it('should return 401 when API key is missing', async () => {
      const response = await request(app)
        .get(`/providers/${TEST_EVENT_ID}/waitlist`);
      // No X-API-Key header

      expect(response.status).toBe(401);
    });

    it('should return 403 when promoter tries to access different event', async () => {
      const userId = generateUserId();
      
      // Create entry in concert-123
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Try to access concert-123 with promoter key for concert-456
      const response = await request(app)
        .get(`/providers/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_PROMOTER_OTHER_API_KEY);

      expect(response.status).toBe(403);
    });

    it('should allow admin to access any event', async () => {
      const userId = generateUserId();
      const TEST_ADMIN_API_KEY = 'sk_test_admin_000000';
      
      // Create entry
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Admin should be able to access
      const response = await request(app)
        .get(`/providers/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_ADMIN_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.entries.length).toBe(1);
    });
  });
});
