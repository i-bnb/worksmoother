import { setAccessToken, clearAccessToken, getAccessToken } from './tokenStore';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roles: string[];
  mfaEnabled?: boolean;
}

export interface FirstPartySessionMeta {
  sessionId: string;
  familyId: string;
  mfaVerified?: boolean;
}

export interface TokenExchangeResponse {
  status: string;
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  session: FirstPartySessionMeta;
}

export interface TokenRotateResponse {
  status: string;
  accessToken: string;
  expiresIn: number;
  familyId?: string;
}

// Single-flight promise mutex to prevent concurrent refresh calls
let activeRefreshPromise: Promise<TokenRotateResponse | null> | null = null;

// Determine API base: uses Next.js proxy route by default, or direct API endpoint if configured
const AUTH_API_PREFIX = '/api/auth';

/**
 * Exchange an Appwrite 15-minute JWT for a first-party session.
 * Stores the returned short-lived access token strictly in memory,
 * while the server sets the HttpOnly, SameSite=Strict refresh cookie.
 */
export async function exchangeToken(appwriteJwt: string): Promise<TokenExchangeResponse> {
  const response = await fetch(`${AUTH_API_PREFIX}/token-exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${appwriteJwt}`,
    },
    body: JSON.stringify({ jwt: appwriteJwt }),
    credentials: 'include', // Ensures browser receives and stores HttpOnly SameSite=Strict cookie
  });

  if (!response.ok) {
    const errorBody: any = await response.json().catch(() => ({}));
    throw new Error(errorBody.message || errorBody.error || `Token exchange failed with HTTP ${response.status}`);
  }

  const data: TokenExchangeResponse = await response.json();

  // Commit short-lived access token strictly to in-memory store
  setAccessToken(data.accessToken, data.expiresIn || 900);

  return data;
}

/**
 * Execute silent token refresh using the HttpOnly SameSite=Strict cookie.
 * Uses a single-flight mutex so concurrent API calls trigger exactly one rotation.
 */
export async function refreshSession(): Promise<TokenRotateResponse | null> {
  // If a refresh is already in-flight, reuse the pending promise
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  activeRefreshPromise = (async () => {
    try {
      const response = await fetch(`${AUTH_API_PREFIX}/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Transmits HttpOnly __Host-refresh_token cookie
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        // If the refresh token was reused or expired, purge in-memory token
        clearAccessToken();
        return null;
      }

      const data: TokenRotateResponse = await response.json();

      // Commit new rotated access token strictly to memory
      setAccessToken(data.accessToken, data.expiresIn || 900);

      return data;
    } catch (err) {
      console.error('[AuthClient] Silent token rotation failed:', err);
      clearAccessToken();
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}

/**
 * Perform secure logout.
 * Clears in-memory access token and calls backend to invalidate the session family
 * and delete the HttpOnly cookie.
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${AUTH_API_PREFIX}/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
  } finally {
    clearAccessToken();
  }
}
