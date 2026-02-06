import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

// Import Express app (CommonJS module)
const require = createRequire(import.meta.url);
const app = require('../../src/index.js');
const { cleanWaitlistData, generateUserId } = require('../helpers/testUtils.mjs');
const { createOffer } = require('../../src/utils/offers.js');

// Test API key (seeded by seedApiKeys script)
const TEST_USER_API_KEY = 'sk_test_user_12345';
const TEST_PROMOTER_API_KEY = 'sk_test_promoter_abc123';
const TEST_EVENT_ID = 'concert-123';

describe('Waitlist API - Basic Endpoints', () => {
  describe('GET /waitlist/', () => {
    it('should return success when API is working', async () => {
      const response = await request(app)
        .get('/waitlist/');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /waitlist/events/:eventId/waitlist', () => {
    beforeEach(async () => {
      // Clean waitlist data before each test
      await cleanWaitlistData(TEST_EVENT_ID);
    });

    it('should create a waitlist entry successfully', async () => {
      const userId = generateUserId();
      const requestBody = {
        user_id: userId,
        zones_preferred: ['General'],
        quantity_wanted: 2
      };

      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('entry_id');
      expect(response.body).toHaveProperty('positions');
      expect(response.body).toHaveProperty('zones_preferred');
      expect(response.body).toHaveProperty('quantity_wanted');
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('created_at');
      
      expect(response.body.zones_preferred).toEqual(['General']);
      expect(response.body.quantity_wanted).toBe(2);
      expect(response.body.status).toBe('waiting');
      expect(response.body.positions).toHaveProperty('General');
      expect(response.body.positions.General).toBeGreaterThan(0);
    });

    it('should return 400 when required fields are missing', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          user_id: 'test-user'
          // Missing zones_preferred and quantity_wanted
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 409 when user already registered for same zones', async () => {
      const userId = generateUserId();
      const requestBody = {
        user_id: userId,
        zones_preferred: ['General'],
        quantity_wanted: 2
      };

      // First request - should succeed
      const firstResponse = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(firstResponse.status).toBe(201);

      // Second request with same user and zones - should fail
      const secondResponse = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send(requestBody);

      expect(secondResponse.status).toBe(409);
      expect(secondResponse.body).toHaveProperty('error');
    });

    it('should allow same user to register for different zones', async () => {
      const userId = generateUserId();
      
      // Register for General zone
      const firstResponse = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 2
        });

      expect(firstResponse.status).toBe(201);

      // Register for VIP zone - should succeed
      const secondResponse = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          user_id: userId,
          zones_preferred: ['VIP'],
          quantity_wanted: 1
        });

      expect(secondResponse.status).toBe(201);
      expect(secondResponse.body.zones_preferred).toEqual(['VIP']);
    });
  });

  describe('GET /waitlist/events/:eventId/waitlist/me', () => {
    beforeEach(async () => {
      // Clean waitlist data before each test
      await cleanWaitlistData(TEST_EVENT_ID);
    });

    it('should retrieve user waitlist position successfully', async () => {
      const userId = generateUserId();
      
      // First, create a waitlist entry
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 2
        });

      // Then retrieve the position
      const response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('entries');
      expect(Array.isArray(response.body.entries)).toBe(true);
      expect(response.body.entries.length).toBeGreaterThan(0);
      
      const entry = response.body.entries[0];
      expect(entry).toHaveProperty('entry_id');
      expect(entry).toHaveProperty('positions');
      expect(entry).toHaveProperty('zones_preferred');
      expect(entry).toHaveProperty('quantity_wanted');
      expect(entry).toHaveProperty('status');
      expect(entry).toHaveProperty('created_at');
      
      expect(entry.zones_preferred).toEqual(['General']);
      expect(entry.quantity_wanted).toBe(2);
      expect(entry.status).toBe('waiting');
      expect(entry.positions).toHaveProperty('General');
      expect(entry.positions.General).toBeGreaterThan(0);
    });

    it('should return multiple entries when user registered for different zones', async () => {
      const userId = generateUserId();
      
      // Register for General zone
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 2
        });

      // Register for VIP zone
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          user_id: userId,
          zones_preferred: ['VIP'],
          quantity_wanted: 1
        });

      // Retrieve all entries
      const response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(2);
      
      // Verify both zones are present
      const zones = response.body.entries.map(e => e.zones_preferred[0]);
      expect(zones).toContain('General');
      expect(zones).toContain('VIP');
    });

    it('should show correct position order when multiple users register', async () => {
      const userId1 = generateUserId();
      const userId2 = generateUserId();
      const userId3 = generateUserId();
      
      // Register three users in sequence
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId1,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId2,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId3,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Check position of second user
      const response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId2);

      expect(response.status).toBe(200);
      const position = response.body.entries[0].positions.General;
      // User2 should be in position 2 (user1 is 1st, user2 is 2nd, user3 is 3rd)
      expect(position).toBe(2);
    });

    it('should return 404 when user not found in waitlist', async () => {
      const userId = generateUserId();

      const response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when x-user-id header is missing', async () => {
      const response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY);
      // Missing x-user-id header

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('DELETE /waitlist/events/:eventId/waitlist/me', () => {
    beforeEach(async () => {
      // Clean waitlist data before each test
      await cleanWaitlistData(TEST_EVENT_ID);
    });

    it('should successfully remove user from waitlist', async () => {
      const userId = generateUserId();
      
      // First, create a waitlist entry
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 2
        });

      // Verify user is in waitlist
      const getResponse = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.entries.length).toBe(1);

      // Delete the user from waitlist
      const deleteResponse = await request(app)
        .delete(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.body).toHaveProperty('success');
      expect(deleteResponse.body.success).toBe(true);
      expect(deleteResponse.body).toHaveProperty('message');

      // Verify user is no longer in waitlist
      const verifyResponse = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(verifyResponse.status).toBe(404);
    });

    it('should remove user from multiple zones', async () => {
      const userId = generateUserId();
      
      // Register for multiple zones
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['General', 'VIP'],
          quantity_wanted: 2
        });

      // Delete the user
      const deleteResponse = await request(app)
        .delete(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(deleteResponse.status).toBe(200);

      // Verify user removed from all zones
      const verifyResponse = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(verifyResponse.status).toBe(404);
    });

    it('should update queue positions after user removal', async () => {
      const userId1 = generateUserId();
      const userId2 = generateUserId();
      const userId3 = generateUserId();
      
      // Register three users
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId1,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId2,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId3,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Remove second user
      await request(app)
        .delete(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId2);

      // Check third user's new position (should move from 3 to 2)
      const response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId3);

      expect(response.status).toBe(200);
      expect(response.body.entries[0].positions.General).toBe(2);
    });

    it('should return 404 when trying to delete non-existent user', async () => {
      const userId = generateUserId();

      const response = await request(app)
        .delete(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 when x-user-id header is missing', async () => {
      const response = await request(app)
        .delete(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY);
      // Missing x-user-id header

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should only remove entries for specified user', async () => {
      const userId1 = generateUserId();
      const userId2 = generateUserId();
      
      // Register two users
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId1,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId2,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Delete first user
      await request(app)
        .delete(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId1);

      // Verify first user is gone
      const user1Response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId1);

      expect(user1Response.status).toBe(404);

      // Verify second user still exists
      const user2Response = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId2);

      expect(user2Response.status).toBe(200);
      expect(user2Response.body.entries.length).toBe(1);
    });
  });

  describe('POST /waitlist/events/:eventId/release-tickets', () => {
    beforeEach(async () => {
      // Clean waitlist data before each test
      await cleanWaitlistData(TEST_EVENT_ID);
    });

    it('should queue ticket release job successfully', async () => {
      const userId = generateUserId();
      
      // Create a user in waitlist
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['VIP', 'General'],
          quantity_wanted: 2
        });

      // Release tickets
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY)
        .set('Content-Type', 'application/json')
        .send({
          zones: {
            VIP: 3,
            General: 5
          },
          reason: 'cancellation'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('event');
      expect(response.body.event).toBe('tickets_released');
      expect(response.body).toHaveProperty('job_id');
      expect(response.body).toHaveProperty('event_id');
      expect(response.body).toHaveProperty('zones');
      expect(response.body).toHaveProperty('reason');
      expect(response.body).toHaveProperty('status');
      
      expect(response.body.event_id).toBe(TEST_EVENT_ID);
      expect(response.body.reason).toBe('cancellation');
      expect(response.body.status).toBe('queued');
      expect(Array.isArray(response.body.zones)).toBe(true);
      expect(response.body.zones.length).toBe(2);
    });

    it('should accept different release reasons', async () => {
      const reasons = ['cancellation', 'refund', 'courtesy_expired'];
      
      for (const reason of reasons) {
        const response = await request(app)
          .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
          .set('X-API-Key', TEST_PROMOTER_API_KEY)
          .send({
            zones: { General: 1 },
            reason: reason
          });

        expect(response.status).toBe(200);
        expect(response.body.reason).toBe(reason);
      }
    });

    it('should return 400 when zones object is missing', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY)
        .send({
          reason: 'cancellation'
          // Missing zones
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should return 400 for invalid reason', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY)
        .send({
          zones: { General: 5 },
          reason: 'invalid_reason'
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should format zones correctly in response', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY)
        .send({
          zones: {
            VIP: 3,
            General: 5,
            Premium: 2
          },
          reason: 'refund'
        });

      expect(response.status).toBe(200);
      expect(response.body.zones).toEqual([
        { zone_id: 'VIP', quantity: 3 },
        { zone_id: 'General', quantity: 5 },
        { zone_id: 'Premium', quantity: 2 }
      ]);
    });

    it('should use default reason when not provided', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY)
        .send({
          zones: { General: 1 }
          // No reason provided
        });

      expect(response.status).toBe(200);
      expect(response.body.reason).toBe('cancellation');
    });

    it('should return 401 when API key is missing', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .send({
          zones: { General: 1 },
          reason: 'cancellation'
        });
      // No X-API-Key header

      expect(response.status).toBe(401);
    });

    it('should return 403 when user role tries to release tickets', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          zones: { General: 1 },
          reason: 'cancellation'
        });

      expect(response.status).toBe(403);
    });

    it('should allow multiple zones with different quantities', async () => {
      const response = await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/release-tickets`)
        .set('X-API-Key', TEST_PROMOTER_API_KEY)
        .send({
          zones: {
            VIP: 10,
            General: 50,
            Premium: 25
          },
          reason: 'refund'
        });

      expect(response.status).toBe(200);
      expect(response.body.zones.length).toBe(3);
      
      const vipZone = response.body.zones.find(z => z.zone_id === 'VIP');
      const generalZone = response.body.zones.find(z => z.zone_id === 'General');
      const premiumZone = response.body.zones.find(z => z.zone_id === 'Premium');
      
      expect(vipZone.quantity).toBe(10);
      expect(generalZone.quantity).toBe(50);
      expect(premiumZone.quantity).toBe(25);
    });
  });

  describe('POST /waitlist/offers/:token/accept', () => {
    beforeEach(async () => {
      // Clean waitlist data before each test
      await cleanWaitlistData(TEST_EVENT_ID);
    });

    it('should successfully accept a valid offer', async () => {
      const userId = generateUserId();
      
      // Create a waitlist entry
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['VIP'],
          quantity_wanted: 2
        });

      // Simulate what the worker does: create an offer directly
      const offer = await createOffer(TEST_EVENT_ID, userId, 'VIP', 2);

      // Accept the offer
      const response = await request(app)
        .post(`/waitlist/offers/${offer.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('checkout_url');
      expect(response.body).toHaveProperty('tickets_reserved');
      expect(response.body).toHaveProperty('zone');
      expect(response.body).toHaveProperty('event_id');
      expect(response.body).toHaveProperty('user_id');
      expect(response.body).toHaveProperty('expires_in_minutes');
      
      expect(response.body.tickets_reserved).toBe(2);
      expect(response.body.zone).toBe('VIP');
      expect(response.body.event_id).toBe(TEST_EVENT_ID);
      expect(response.body.user_id).toBe(userId);
      expect(response.body.checkout_url).toContain('https://seatix.com/checkout/');
    });

    it('should return 410 for expired or non-existent offer', async () => {
      const fakeToken = 'nonexistent1234567890abcdef123456';

      const response = await request(app)
        .post(`/waitlist/offers/${fakeToken}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(410);
      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('offer_expired');
    });

    it('should return 400 when token is missing', async () => {
      const response = await request(app)
        .post('/waitlist/offers//accept')
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(404); // Route not found when token is empty
    });

    it('should update waitlist status to accepted after acceptance', async () => {
      const userId = generateUserId();
      
      // Create waitlist entry
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Create offer
      const offer = await createOffer(TEST_EVENT_ID, userId, 'General', 1);

      // Accept offer
      await request(app)
        .post(`/waitlist/offers/${offer.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY);

      // Verify status changed in waitlist
      const statusResponse = await request(app)
        .get(`/waitlist/events/${TEST_EVENT_ID}/waitlist/me`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .set('x-user-id', userId);

      expect(statusResponse.status).toBe(200);
      const entry = statusResponse.body.entries.find(e => 
        e.zones_preferred.includes('General')
      );
      expect(entry.status).toBe('accepted');
    });

    it('should prevent accepting the same offer twice', async () => {
      const userId = generateUserId();
      
      // Create waitlist entry and offer
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['VIP'],
          quantity_wanted: 1
        });

      const offer = await createOffer(TEST_EVENT_ID, userId, 'VIP', 1);

      // Accept offer first time
      const firstResponse = await request(app)
        .post(`/waitlist/offers/${offer.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY);

      expect(firstResponse.status).toBe(200);

      // Try to accept same offer again
      const secondResponse = await request(app)
        .post(`/waitlist/offers/${offer.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY);

      expect(secondResponse.status).toBe(410);
      expect(secondResponse.body.error).toBe('offer_expired');
    });

    it('should create different offers for different users', async () => {
      const userId1 = generateUserId();
      const userId2 = generateUserId();
      
      // Create two waitlist entries
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId1,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId2,
          zones_preferred: ['General'],
          quantity_wanted: 1
        });

      // Create separate offers for each user
      const offer1 = await createOffer(TEST_EVENT_ID, userId1, 'General', 1);
      const offer2 = await createOffer(TEST_EVENT_ID, userId2, 'General', 1);

      expect(offer1.token).not.toBe(offer2.token);

      // Both should be able to accept their offers
      const response1 = await request(app)
        .post(`/waitlist/offers/${offer1.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY);

      const response2 = await request(app)
        .post(`/waitlist/offers/${offer2.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY);

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);
      expect(response1.body.user_id).toBe(userId1);
      expect(response2.body.user_id).toBe(userId2);
    });

    it('should include offer expiration info in response', async () => {
      const userId = generateUserId();
      
      await request(app)
        .post(`/waitlist/events/${TEST_EVENT_ID}/waitlist`)
        .set('X-API-Key', TEST_USER_API_KEY)
        .send({
          user_id: userId,
          zones_preferred: ['VIP'],
          quantity_wanted: 3
        });

      const offer = await createOffer(TEST_EVENT_ID, userId, 'VIP', 3);

      const response = await request(app)
        .post(`/waitlist/offers/${offer.token}/accept`)
        .set('X-API-Key', TEST_USER_API_KEY);

      expect(response.status).toBe(200);
      expect(response.body.expires_in_minutes).toBe(10);
    });
  });
});
