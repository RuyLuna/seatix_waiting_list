/**
 * Helper functions to make API requests during integration tests
 * These wrap common HTTP patterns for the waitlist API
 */

/**
 * Create a base request configuration
 * @param {string} apiKey - API key for authentication
 * @param {string} userId - User ID header (for user endpoints)
 * @returns {object} Headers object
 */
export function createHeaders(apiKey = null, userId = null) {
  const headers = {
    'Content-Type': 'application/json'
  };
  
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  
  if (userId) {
    headers['x-user-id'] = userId;
  }
  
  return headers;
}

