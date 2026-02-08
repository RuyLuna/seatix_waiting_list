/**
 * Shared TypeScript interfaces and types for the Seatix Waitlist API
 */

// ============================================================================
// Database Models
// ============================================================================

export interface WaitlistEntry {
  entry_id: string;
  event_id?: string;
  user_id?: string;
  zones_preferred: string; // JSON string
  quantity_wanted: number;
  status: 'waiting' | 'notified' | 'accepted';
  created_at: string;
}

export interface ApiKeyInfo {
  id: number;
  name: string;
  role: 'user' | 'promoter' | 'admin';
  eventId?: string;
}

// ============================================================================
// Offer Types
// ============================================================================

export interface OfferData {
  event_id: string;
  user_id: string;
  zone: string;
  tickets_reserved: number;
  created_at: string;
}

export interface CreateOfferResult {
  token: string;
  expires_in_minutes: number;
}

export interface AcceptOfferResult {
  success: boolean;
  checkout_url: string;
  expires_in_minutes: number;
  tickets_reserved: number;
  zone: string;
  event_id: string;
  user_id: string;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface Positions {
  [zone: string]: number | null;
}

export interface CreateWaitlistBody {
  user_id: string;
  zones_preferred: string[];
  quantity_wanted: number;
}

export interface ReleaseTicketsBody {
  zones: { [zone: string]: number };
  reason?: 'cancellation' | 'refund' | 'courtesy_expired';
}

// ============================================================================
// Worker Types
// ============================================================================

export interface TicketReleaseJobData {
  event_id: string;
  zones: { [zone: string]: number };
  reason: 'cancellation' | 'refund' | 'courtesy_expired';
  timestamp: string;
}

export interface Winner {
  user_id: string;
  zone: string;
  quantity_wanted: number;
  tickets_allocated: number;
  offer_token: string;
  offer_expires_in_minutes: number;
}

export interface ZoneBreakdown {
  zone: string;
  tickets_available: number;
  tickets_allocated: number;
  tickets_remaining: number;
  users_notified: number;
}

export interface TicketReleaseResult {
  success: boolean;
  event_id: string;
  reason: string;
  total_winners: number;
  total_tickets_allocated: number;
  zone_breakdown: ZoneBreakdown[];
  winners: Winner[];
}

// ============================================================================
// Helper Types
// ============================================================================

export interface RedisConnection {
  host: string;
  port: number;
}

export interface UserEntry {
  quantity_wanted: number;
}
