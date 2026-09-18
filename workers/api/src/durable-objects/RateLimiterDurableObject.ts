/**
 * RateLimiterDurableObject
 * Cloudflare Workers Durable Object providing strongly consistent, exact atomic rate limiting.
 * Eliminates edge eventual consistency windows and distributed race conditions.
 * Uses native SQLite storage (with in-memory fallback) and sliding-window timestamp tracking.
 */

import { DoRateLimitConsumeRequest, DoRateLimitResult } from '@doctorcare/shared';

export class RateLimiterDurableObject {
  private ctx: DurableObjectState;
  private env: unknown;
  private hasSql: boolean;
  // Fallback in-memory sliding window timestamps for test mock environments
  private memoryWindows: Map<string, number[]> = new Map();

  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    this.env = env;
    this.hasSql = Boolean(this.ctx?.storage && (this.ctx.storage as any).sql);

    if (this.hasSql) {
      const sql = (this.ctx.storage as any).sql;
      sql.exec(`
        CREATE TABLE IF NOT EXISTS rate_limits (
          key TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_rate_limits_key_ts ON rate_limits (key, timestamp);
      `);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // =========================================================================
    // 1. Consume / Record a hit in the exact sliding window
    // =========================================================================
    if (url.pathname === '/rate-limit/consume' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as DoRateLimitConsumeRequest;
      const key = body.key || 'default_key';
      const limit = Number(body.limit) || 10;
      const windowSeconds = Number(body.windowSeconds) || 60;
      const windowMs = windowSeconds * 1000;
      const now = Date.now();
      const cutoff = now - windowMs;

      let count = 0;
      let oldestTs = now;

      if (this.hasSql) {
        const sql = (this.ctx.storage as any).sql;
        // Purge expired records outside current sliding window
        sql.exec('DELETE FROM rate_limits WHERE key = ? AND timestamp <= ?', key, cutoff);

        // Count current hits in window
        const cursor = sql.exec('SELECT COUNT(*) as count, MIN(timestamp) as oldest_ts FROM rate_limits WHERE key = ?', key);
        const rows = [...cursor];
        if (rows.length > 0) {
          count = Number(rows[0].count) || 0;
          oldestTs = Number(rows[0].oldest_ts) || now;
        }

        if (count < limit) {
          // Record new hit
          sql.exec('INSERT INTO rate_limits (key, timestamp) VALUES (?, ?)', key, now);
          const newCount = count + 1;
          const result: DoRateLimitResult = {
            allowed: true,
            current: newCount,
            limit,
            remaining: Math.max(0, limit - newCount),
            resetInSeconds: windowSeconds,
          };
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } else {
          // Exceeded exact limit
          const resetInSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
          const result: DoRateLimitResult = {
            allowed: false,
            current: count,
            limit,
            remaining: 0,
            resetInSeconds,
          };
          return new Response(JSON.stringify(result), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } else {
        // In-memory sliding window implementation
        let timestamps = this.memoryWindows.get(key) || [];
        timestamps = timestamps.filter((ts) => ts > cutoff);

        count = timestamps.length;
        oldestTs = count > 0 ? timestamps[0] : now;

        if (count < limit) {
          timestamps.push(now);
          this.memoryWindows.set(key, timestamps);
          const newCount = count + 1;
          const result: DoRateLimitResult = {
            allowed: true,
            current: newCount,
            limit,
            remaining: Math.max(0, limit - newCount),
            resetInSeconds: windowSeconds,
          };
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        } else {
          const resetInSeconds = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
          const result: DoRateLimitResult = {
            allowed: false,
            current: count,
            limit,
            remaining: 0,
            resetInSeconds,
          };
          return new Response(JSON.stringify(result), {
            status: 429,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // =========================================================================
    // 2. Check status without recording a hit (Non-mutating inspection)
    // =========================================================================
    if (url.pathname === '/rate-limit/check' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as DoRateLimitConsumeRequest;
      const key = body.key || 'default_key';
      const limit = Number(body.limit) || 10;
      const windowSeconds = Number(body.windowSeconds) || 60;
      const windowMs = windowSeconds * 1000;
      const now = Date.now();
      const cutoff = now - windowMs;

      let count = 0;
      let oldestTs = now;

      if (this.hasSql) {
        const sql = (this.ctx.storage as any).sql;
        const cursor = sql.exec('SELECT COUNT(*) as count, MIN(timestamp) as oldest_ts FROM rate_limits WHERE key = ? AND timestamp > ?', key, cutoff);
        const rows = [...cursor];
        if (rows.length > 0) {
          count = Number(rows[0].count) || 0;
          oldestTs = Number(rows[0].oldest_ts) || now;
        }
      } else {
        const timestamps = (this.memoryWindows.get(key) || []).filter((ts) => ts > cutoff);
        count = timestamps.length;
        oldestTs = count > 0 ? timestamps[0] : now;
      }

      const allowed = count < limit;
      const resetInSeconds = allowed
        ? windowSeconds
        : Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));

      const result: DoRateLimitResult = {
        allowed,
        current: count,
        limit,
        remaining: Math.max(0, limit - count),
        resetInSeconds,
      };

      return new Response(JSON.stringify(result), {
        status: allowed ? 200 : 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // =========================================================================
    // 3. Reset rate limit counter for a key (Testing or administrative reset)
    // =========================================================================
    if (url.pathname === '/rate-limit/reset' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { key?: string };
      const key = body.key;

      if (this.hasSql) {
        const sql = (this.ctx.storage as any).sql;
        if (key) {
          sql.exec('DELETE FROM rate_limits WHERE key = ?', key);
        } else {
          sql.exec('DELETE FROM rate_limits');
        }
      } else {
        if (key) {
          this.memoryWindows.delete(key);
        } else {
          this.memoryWindows.clear();
        }
      }

      return new Response(JSON.stringify({ success: true, key: key || 'ALL' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Route not found in RateLimiterDurableObject' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
