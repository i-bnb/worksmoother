/**
 * In-Memory Access Token Store
 * 
 * Strict Security Architecture:
 * - The short-lived (15-minute) access token is stored SOLELY in this private JavaScript memory closure.
 * - NEVER written to window.localStorage, window.sessionStorage, or client-accessible cookies.
 * - Immune to persistent XSS credential exfiltration attacks.
 * - Ephemeral by design: on browser tab reload or close, memory is cleared;
 *   session is silently restored via the HttpOnly SameSite=Strict refresh cookie.
 */

type TokenListener = (token: string | null) => void;

// Private module-scoped in-memory state
let inMemoryAccessToken: string | null = null;
let tokenExpiresAtTimestamp: number | null = null;
const listeners = new Set<TokenListener>();

/**
 * Retrieve current in-memory access token.
 * Returns null if no active token or if token has expired.
 */
export function getAccessToken(): string | null {
  if (isTokenExpired()) {
    return null;
  }
  return inMemoryAccessToken;
}

/**
 * Store a new short-lived access token strictly in memory.
 * @param token The JWT access token string
 * @param expiresInSeconds Lifetime in seconds (defaults to 900 / 15 minutes)
 */
export function setAccessToken(token: string | null, expiresInSeconds: number = 900): void {
  // Defensive check: explicitly ensure no web storage leaks
  if (typeof window !== 'undefined') {
    try {
      if (window.localStorage.getItem('access_token') || window.localStorage.getItem('token')) {
        window.localStorage.removeItem('access_token');
        window.localStorage.removeItem('token');
      }
      if (window.sessionStorage.getItem('access_token') || window.sessionStorage.getItem('token')) {
        window.sessionStorage.removeItem('access_token');
        window.sessionStorage.removeItem('token');
      }
    } catch {
      // Ignore security policy errors in restricted frames
    }
  }

  inMemoryAccessToken = token;
  if (token) {
    tokenExpiresAtTimestamp = Date.now() + expiresInSeconds * 1000;
  } else {
    tokenExpiresAtTimestamp = null;
  }

  // Notify active subscribers
  listeners.forEach((listener) => {
    try {
      listener(token);
    } catch (err) {
      console.error('[TokenStore] Subscriber notification error:', err);
    }
  });
}

/**
 * Completely purge the access token from memory.
 */
export function clearAccessToken(): void {
  setAccessToken(null, 0);
}

/**
 * Check if the current in-memory token is expired or within 10s of expiry.
 */
export function isTokenExpired(): boolean {
  if (!inMemoryAccessToken || !tokenExpiresAtTimestamp) {
    return true;
  }
  // Buffer of 10 seconds to guard against edge clock skew
  return Date.now() >= tokenExpiresAtTimestamp - 10_000;
}

/**
 * Get the expiration timestamp in epoch milliseconds.
 */
export function getExpiresAt(): number | null {
  return tokenExpiresAtTimestamp;
}

/**
 * Get remaining seconds until token expires.
 */
export function getSecondsUntilExpiry(): number {
  if (!tokenExpiresAtTimestamp) return 0;
  const diff = Math.floor((tokenExpiresAtTimestamp - Date.now()) / 1000);
  return Math.max(0, diff);
}

/**
 * Subscribe to token state changes.
 * Returns an unsubscribe callback.
 */
export function subscribeToToken(listener: TokenListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Security audit helper: verifies that browser storage contains ZERO token data.
 */
export function verifyStorageIsolation(): {
  isLocalStorageClean: boolean;
  isSessionStorageClean: boolean;
  inMemoryActive: boolean;
} {
  if (typeof window === 'undefined') {
    return { isLocalStorageClean: true, isSessionStorageClean: true, inMemoryActive: !!inMemoryAccessToken };
  }

  const localKeys = Object.keys(window.localStorage);
  const sessionKeys = Object.keys(window.sessionStorage);

  const sensitivePattern = /(token|jwt|auth|secret|refresh|access)/i;
  const hasLocalLeak = localKeys.some((k) => sensitivePattern.test(k));
  const hasSessionLeak = sessionKeys.some((k) => sensitivePattern.test(k));

  return {
    isLocalStorageClean: !hasLocalLeak,
    isSessionStorageClean: !hasSessionLeak,
    inMemoryActive: !!inMemoryAccessToken,
  };
}
