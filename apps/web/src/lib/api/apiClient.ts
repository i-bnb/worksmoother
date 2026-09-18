import { getAccessToken } from '../auth/tokenStore';
import { refreshSession } from '../auth/authClient';

/**
 * Authenticated HTTP Client
 * 
 * Features:
 * - Pulls the active access token directly from in-memory tokenStore.
 * - Injects 'Authorization: Bearer <token>' header.
 * - Always sends 'credentials: include' for HttpOnly SameSite=Strict cookies.
 * - Intercepts HTTP 401 Unauthorized responses, triggers single-flight silent
 *   refresh, and replays the original request with the fresh token.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  // Attach in-memory access token if available
  const token = getAccessToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Ensure credentials: 'include' is enabled for HttpOnly cookie transport
  const modifiedInit: RequestInit = {
    ...init,
    headers,
    credentials: init?.credentials || 'include',
  };

  let response = await fetch(input, modifiedInit);

  // If unauthorized (401), attempt silent token rotation via HttpOnly refresh cookie
  if (response.status === 401) {
    const rotated = await refreshSession();
    if (rotated && rotated.accessToken) {
      // Re-attach fresh access token from memory and replay request
      headers.set('Authorization', `Bearer ${rotated.accessToken}`);
      response = await fetch(input, {
        ...modifiedInit,
        headers,
      });
    }
  }

  return response;
}
