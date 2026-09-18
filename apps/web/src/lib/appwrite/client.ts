/**
 * Appwrite Browser Client Factory — Project A (Operational)
 *
 * Used exclusively in Client Components and browser-side hooks.
 * The client is authenticated by setting the active Appwrite session JWT
 * (the 15-minute short-lived token from tokenStore) via setJWT().
 *
 * Never import this in edge route handlers or server components —
 * use server-operational.ts instead.
 */

import { Client, Account, Databases } from 'appwrite';
import { publicEnv } from './env';

let _client: Client | null = null;

/**
 * Returns (and lazily creates) the singleton Appwrite Client bound to Project A.
 * Call setActiveJwt() after this to authenticate as the current user.
 */
export function getClient(): Client {
  if (!_client) {
    _client = new Client()
      .setEndpoint(publicEnv.NEXT_PUBLIC_APPWRITE_ENDPOINT)
      .setProject(publicEnv.NEXT_PUBLIC_APPWRITE_PROJECT_A_ID);
  }
  return _client;
}

/**
 * Set the Appwrite JWT on the client so subsequent requests run
 * as the authenticated user instead of a guest.
 */
export function setActiveJwt(jwt: string): void {
  getClient().setJWT(jwt);
}

/** Returns an Account service bound to the authenticated client */
export function getAccount(): Account {
  return new Account(getClient());
}

/** Returns a Databases service bound to the authenticated client */
export function getDatabases(): Databases {
  return new Databases(getClient());
}

/**
 * Create a 15-minute Appwrite JWT for the currently signed-in user.
 * This JWT is what the token-exchange flow sends to the API worker.
 */
export async function createUserJwt(): Promise<string> {
  const account = getAccount();
  const jwt = await account.createJWT();
  return jwt.jwt;
}
