'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAccessToken,
  getExpiresAt,
  getSecondsUntilExpiry,
  subscribeToToken,
  verifyStorageIsolation,
} from '../lib/auth/tokenStore';
import {
  exchangeToken,
  refreshSession,
  logout as authLogout,
  AuthUser,
  FirstPartySessionMeta,
} from '../lib/auth/authClient';

interface AuthContextValue {
  user: AuthUser | null;
  session: FirstPartySessionMeta | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  tokenExpiresAt: number | null;
  secondsRemaining: number;
  loginWithJwt: (jwt: string) => Promise<void>;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  storageAudit: {
    isLocalStorageClean: boolean;
    isSessionStorageClean: boolean;
    inMemoryActive: boolean;
  };
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<FirstPartySessionMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [storageAudit, setStorageAudit] = useState(verifyStorageIsolation());

  // Subscribe to token changes
  useEffect(() => {
    const unsub = subscribeToToken((token) => {
      setHasToken(!!token);
      setTokenExpiresAt(getExpiresAt());
      setSecondsRemaining(getSecondsUntilExpiry());
      setStorageAudit(verifyStorageIsolation());
      if (!token) {
        setUser(null);
        setSession(null);
      }
    });
    return unsub;
  }, []);

  // Countdown timer and proactive silent refresh (60s before expiry)
  useEffect(() => {
    if (!hasToken || !tokenExpiresAt) return;

    const interval = setInterval(() => {
      const remaining = getSecondsUntilExpiry();
      setSecondsRemaining(remaining);
      setStorageAudit(verifyStorageIsolation());

      // Proactively renew token 60s before expiration while active
      if (remaining > 0 && remaining <= 60) {
        refreshSession().catch(() => {});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [hasToken, tokenExpiresAt]);

  // Initial boot: attempt silent refresh from HttpOnly cookie
  useEffect(() => {
    let isMounted = true;

    async function initSession() {
      try {
        const rotated = await refreshSession();
        if (isMounted && rotated) {
          setHasToken(true);
          setTokenExpiresAt(getExpiresAt());
          setSecondsRemaining(getSecondsUntilExpiry());
        }
      } catch (err) {
        // No active session cookie or refresh expired; remains unauthenticated
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setStorageAudit(verifyStorageIsolation());
        }
      }
    }

    initSession();

    return () => {
      isMounted = false;
    };
  }, []);

  const loginWithJwt = useCallback(async (jwt: string) => {
    setIsLoading(true);
    try {
      const res = await exchangeToken(jwt);
      setUser(res.user);
      setSession(res.session);
      setHasToken(true);
      setTokenExpiresAt(getExpiresAt());
      setSecondsRemaining(getSecondsUntilExpiry());
      setStorageAudit(verifyStorageIsolation());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const res = await refreshSession();
    if (res) {
      setHasToken(true);
      setTokenExpiresAt(getExpiresAt());
      setSecondsRemaining(getSecondsUntilExpiry());
      setStorageAudit(verifyStorageIsolation());
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authLogout();
      setUser(null);
      setSession(null);
      setHasToken(false);
      setTokenExpiresAt(null);
      setSecondsRemaining(0);
      setStorageAudit(verifyStorageIsolation());
    } finally {
      setIsLoading(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      isAuthenticated: hasToken,
      isLoading,
      tokenExpiresAt,
      secondsRemaining,
      loginWithJwt,
      refresh,
      logout,
      storageAudit,
    }),
    [user, session, hasToken, isLoading, tokenExpiresAt, secondsRemaining, loginWithJwt, refresh, logout, storageAudit]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
