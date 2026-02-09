import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { 
  generateOfferToken, 
  createOffer, 
  getOffer, 
  acceptOffer,
  OFFER_TTL_MINUTES,
  OFFER_TTL_SECONDS 
} from '../../../dist/utils/offers.js';
import { client } from '../../../dist/cache/redis.js';

describe('Offers Utility - Unit Tests', () => {
  // Store tokens created during tests for cleanup
  const testTokens = [];

  afterEach(async () => {
    // Cleanup any test offers from Redis
    for (const token of testTokens) {
      await client.del(`offer:${token}`);
      await client.del(`offer:${token}:meta`);
    }
    testTokens.length = 0;
  });

  describe('generateOfferToken()', () => {
    it('should generate a random token in string form', () => {
      const token = generateOfferToken();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('should generate unique tokens on multiple calls', () => {
      const token1 = generateOfferToken();
      const token2 = generateOfferToken();
      const token3 = generateOfferToken();
      
      expect(token1).not.toBe(token2);
      expect(token2).not.toBe(token3);
      expect(token1).not.toBe(token3);
    });

    it('should generate a 32-character hexadecimal string', () => {
      const token = generateOfferToken();
      
      // 16 bytes = 32 hex characters
      expect(token).toMatch(/^[a-f0-9]{32}$/);
      expect(token.length).toBe(32);
    });

    it('should only contain valid hexadecimal characters', () => {
      const token = generateOfferToken();
      const hexRegex = /^[0-9a-f]+$/i;
      
      expect(hexRegex.test(token)).toBe(true);
    });
  });

  describe('createOffer()', () => {
    it('should create an offer and return token with expiration time', async () => {
      const eventId = 'event-test-123';
      const userId = 'user-test-456';
      const zone = 'VIP';
      const ticketsAllocated = 2;

      const result = await createOffer(eventId, userId, zone, ticketsAllocated);
      testTokens.push(result.token);

      expect(result).toHaveProperty('token');
      expect(result).toHaveProperty('expires_in_minutes');
      expect(typeof result.token).toBe('string');
      expect(result.token.length).toBe(32);
      expect(result.expires_in_minutes).toBe(OFFER_TTL_MINUTES);
    });

    it('should store offer data in Redis with correct structure', async () => {
      const eventId = 'event-test-789';
      const userId = 'user-test-012';
      const zone = 'General';
      const ticketsAllocated = 3;

      const result = await createOffer(eventId, userId, zone, ticketsAllocated);
      testTokens.push(result.token);

      // Verify the offer exists in Redis
      const offerData = await client.get(`offer:${result.token}`);
      expect(offerData).toBeTruthy();

      const parsedData = JSON.parse(offerData);
      expect(parsedData.event_id).toBe(eventId);
      expect(parsedData.user_id).toBe(userId);
      expect(parsedData.zone).toBe(zone);
      expect(parsedData.tickets_reserved).toBe(ticketsAllocated);
      expect(parsedData.created_at).toBeDefined();
    });

    it('should store metadata in separate Redis key', async () => {
      const result = await createOffer('event-1', 'user-1', 'VIP', 1);
      testTokens.push(result.token);

      const metaData = await client.get(`offer:${result.token}:meta`);
      expect(metaData).toBeTruthy();
      
      const parsedMeta = JSON.parse(metaData);
      expect(parsedMeta.event_id).toBe('event-1');
      expect(parsedMeta.user_id).toBe('user-1');
    });

    it('should set TTL on the offer key', async () => {
      const result = await createOffer('event-1', 'user-1', 'General', 2);
      testTokens.push(result.token);

      const ttl = await client.ttl(`offer:${result.token}`);
      
      // TTL should be close to expected (within a few seconds)
      expect(ttl).toBeGreaterThan(OFFER_TTL_SECONDS - 5);
      expect(ttl).toBeLessThanOrEqual(OFFER_TTL_SECONDS);
    });
  });

  describe('getOffer()', () => {
    it('should retrieve an existing offer from Redis', async () => {
      const eventId = 'event-get-123';
      const userId = 'user-get-456';
      const zone = 'VIP';
      const tickets = 2;

      const { token } = await createOffer(eventId, userId, zone, tickets);
      testTokens.push(token);

      const offer = await getOffer(token);

      expect(offer).not.toBeNull();
      expect(offer.event_id).toBe(eventId);
      expect(offer.user_id).toBe(userId);
      expect(offer.zone).toBe(zone);
      expect(offer.tickets_reserved).toBe(tickets);
      expect(offer.created_at).toBeDefined();
    });

    it('should return null for non-existent token', async () => {
      const offer = await getOffer('nonexistent-token-12345');
      
      expect(offer).toBeNull();
    });

    it('should return null for expired token', async () => {
      // Create an offer with 1 second TTL
      const token = generateOfferToken();
      testTokens.push(token);
      
      await client.setEx(`offer:${token}`, 1, JSON.stringify({
        event_id: 'event-1',
        user_id: 'user-1',
        zone: 'General',
        tickets_reserved: 1
      }));

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const offer = await getOffer(token);
      expect(offer).toBeNull();
    });
  });

  describe('acceptOffer()', () => {
    it('should accept a valid offer and return checkout details', async () => {
      const eventId = 'event-accept-123';
      const userId = 'user-accept-456';
      const zone = 'VIP';
      const tickets = 2;

      const { token } = await createOffer(eventId, userId, zone, tickets);
      testTokens.push(token);

      const result = await acceptOffer(token);

      expect(result).not.toBeNull();
      expect(result.success).toBe(true);
      expect(result.checkout_url).toBeDefined();
      expect(result.checkout_url).toMatch(/^https:\/\/seatix\.com\/checkout\//);
      expect(result.tickets_reserved).toBe(tickets);
      expect(result.zone).toBe(zone);
      expect(result.event_id).toBe(eventId);
      expect(result.user_id).toBe(userId);
      expect(result.expires_in_minutes).toBe(10);
    });

    it('should delete the offer from Redis after acceptance', async () => {
      const { token } = await createOffer('event-1', 'user-1', 'General', 1);
      testTokens.push(token);

      await acceptOffer(token);

      // Verify offer is deleted
      const offerData = await client.get(`offer:${token}`);
      expect(offerData).toBeNull();
    });

    it('should delete the metadata key after acceptance', async () => {
      const { token } = await createOffer('event-1', 'user-1', 'VIP', 2);
      testTokens.push(token);

      await acceptOffer(token);

      // Verify metadata is deleted
      const metaData = await client.get(`offer:${token}:meta`);
      expect(metaData).toBeNull();
    });

    it('should return null for non-existent offer', async () => {
      const result = await acceptOffer('nonexistent-token-xyz');
      
      expect(result).toBeNull();
    });

    it('should return null for expired offer', async () => {
      const token = generateOfferToken();
      testTokens.push(token);
      
      // Create offer with 1 second TTL
      await client.setEx(`offer:${token}`, 1, JSON.stringify({
        event_id: 'event-1',
        user_id: 'user-1',
        zone: 'General',
        tickets_reserved: 1
      }));

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      const result = await acceptOffer(token);
      expect(result).toBeNull();
    });

    it('should be single-use (cannot accept same token twice)', async () => {
      const { token } = await createOffer('event-1', 'user-1', 'General', 1);
      testTokens.push(token);

      // First acceptance should succeed
      const firstResult = await acceptOffer(token);
      expect(firstResult).not.toBeNull();

      // Second acceptance should fail
      const secondResult = await acceptOffer(token);
      expect(secondResult).toBeNull();
    });
  });

  describe('OFFER_TTL constants', () => {
    it('should export OFFER_TTL_MINUTES as a number', () => {
      expect(typeof OFFER_TTL_MINUTES).toBe('number');
      expect(OFFER_TTL_MINUTES).toBeGreaterThan(0);
    });

    it('should export OFFER_TTL_SECONDS as 60x OFFER_TTL_MINUTES', () => {
      expect(typeof OFFER_TTL_SECONDS).toBe('number');
      expect(OFFER_TTL_SECONDS).toBe(OFFER_TTL_MINUTES * 60);
    });

    it('should have default TTL of 10 minutes if not configured', () => {
      // Default in .env or code is 10 minutes
      expect(OFFER_TTL_MINUTES).toBe(10);
      expect(OFFER_TTL_SECONDS).toBe(600);
    });
  });
});
