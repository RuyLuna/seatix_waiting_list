import crypto from 'crypto';
import { client } from '../cache/redis.js';
import type { OfferData, CreateOfferResult, AcceptOfferResult } from '../types/index.js';

const OFFER_TTL_MINUTES: number = parseInt(process.env.OFFER_TTL_MINUTES || '10');
const OFFER_TTL_SECONDS: number = OFFER_TTL_MINUTES * 60;

/**
 * Generate a random alphanumeric token for ticket offers
 */
function generateOfferToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Create a ticket offer in Redis with TTL
 * Stores offer data with expiration time
 * Also stores metadata in non-expiring key for expiry tracking
 */
async function createOffer(
  eventId: string,
  userId: string,
  zone: string,
  ticketsAllocated: number
): Promise<CreateOfferResult> {
  const token: string = generateOfferToken();
  const offerKey: string = `offer:${token}`;
  const metaKey: string = `offer:${token}:meta`;
  
  const offerData: string = JSON.stringify({
    event_id: eventId,
    user_id: userId,
    zone: zone,
    tickets_reserved: ticketsAllocated,
    created_at: new Date().toISOString()
  });

  // Store offer with TTL (for acceptance)
  await client.setEx(offerKey, OFFER_TTL_SECONDS, offerData);
  
  // Store metadata without TTL (for expiry tracking)
  // This will be cleaned up when offer expires or is accepted
  await client.set(metaKey, offerData);
  
  console.log(`[Offer] Created offer ${token} for user ${userId} (expires in ${OFFER_TTL_MINUTES} min)`);
  
  return {
    token,
    expires_in_minutes: OFFER_TTL_MINUTES
  };
}

/**
 * Retrieve offer from Redis
 * Returns null if offer has expired or doesn't exist
 */
async function getOffer(token: string): Promise<OfferData | null> {
  const offerKey: string = `offer:${token}`;
  const offerData: string | null = await client.get(offerKey);
  
  if (!offerData) {
    return null;
  }
  
  try {
    return JSON.parse(offerData);
  } catch (err) {
    console.error(`[Offer] Error parsing offer ${token}:`, err);
    return null;
  }
}

/**
 * Accept an offer (remove from Redis and return checkout URL)
 * Returns null if offer doesn't exist/expired
 * Also cleans up metadata key
 */
async function acceptOffer(token: string): Promise<AcceptOfferResult | null> {
  const offerKey: string = `offer:${token}`;
  const metaKey: string = `offer:${token}:meta`;
  const offerData: string | null = await client.get(offerKey);
  
  if (!offerData) {
    return null; // Offer expired or not found
  }

  // Delete both the offer and metadata from Redis (single-use token)
  await client.del(offerKey);
  await client.del(metaKey);
  
  try {
    const offer: OfferData = JSON.parse(offerData);
    
    // Generate a checkout URL (in real implementation, would integrate with checkout service)
    const checkoutUrl: string = `https://seatix.com/checkout/${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    
    return {
      success: true,
      checkout_url: checkoutUrl,
      expires_in_minutes: 10, // Checkout link validity (different from offer TTL)
      tickets_reserved: offer.tickets_reserved,
      zone: offer.zone,
      event_id: offer.event_id,
      user_id: offer.user_id
    };
  } catch (err) {
    console.error(`[Offer] Error accepting offer ${token}:`, (err as Error).message);
    return null;
  }
}

export {
  generateOfferToken,
  createOffer,
  getOffer,
  acceptOffer,
  OFFER_TTL_MINUTES,
  OFFER_TTL_SECONDS
};
