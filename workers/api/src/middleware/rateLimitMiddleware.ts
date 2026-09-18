/**
 * Rate Limiting Middleware
 * Orchestrates Layer 2 (Workers RateLimit Bindings) and Layer 3 (Exact Durable Object Counters).
 */

import { ApiEnv, DoRateLimitResult } from '@doctorcare/shared';

/**
 * Layer 2: Cloudflare Workers RateLimit Binding Enforcement
 * Fast, low-latency edge rate-limiting per IP prior to executing heavy compute.
 */
export async function enforceWorkersRateLimit(
  request: Request,
  env: ApiEnv
): Promise<Response | null> {
  const url = new URL(request.url);
  const clientIp =
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    '127.0.0.1';

  const isAuthPath =
    url.pathname.startsWith('/api/v1/auth') ||
    url.pathname.startsWith('/api/v1/exchange-token');

  // Check auth-specific limiter
  if (isAuthPath && env.AUTH_RATE_LIMITER) {
    try {
      const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `auth:${clientIp}` });
      if (!success) {
        return new Response(
          JSON.stringify({
            error: 'RATE_LIMIT_EXCEEDED',
            layer: 'WORKERS_RATELIMIT_BINDING',
            limiter: 'AUTH_RATE_LIMITER',
            message: 'Too many authentication attempts from this IP. Please wait before retrying.',
            retryAfter: 60,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '60',
              'X-RateLimit-Layer': 'WORKERS_RATELIMIT_BINDING',
            },
          }
        );
      }
    } catch (err) {
      console.warn('[AUTH_RATE_LIMITER Warning] Error checking rate limit:', err);
    }
  }

  // Check general API rate limiter
  if (env.API_RATE_LIMITER) {
    try {
      const { success } = await env.API_RATE_LIMITER.limit({ key: `api:${clientIp}` });
      if (!success) {
        return new Response(
          JSON.stringify({
            error: 'RATE_LIMIT_EXCEEDED',
            layer: 'WORKERS_RATELIMIT_BINDING',
            limiter: 'API_RATE_LIMITER',
            message: 'Global API request rate limit exceeded from this IP. Please try again later.',
            retryAfter: 60,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': '60',
              'X-RateLimit-Layer': 'WORKERS_RATELIMIT_BINDING',
            },
          }
        );
      }
    } catch (err) {
      console.warn('[API_RATE_LIMITER Warning] Error checking rate limit:', err);
    }
  }

  return null;
}

/**
 * Layer 3: Exact Durable Object Counter Enforcement
 * Strongly consistent sliding-window rate limiter preventing distributed race conditions.
 */
export async function enforceExactDoRateLimit(
  env: ApiEnv,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<Response | null> {
  if (!env.RATE_LIMITER_DO) {
    return null; // Passthrough if binding not configured in environment
  }

  try {
    const doId = env.RATE_LIMITER_DO.idFromName(key);
    const doStub = env.RATE_LIMITER_DO.get(doId);

    const res = await doStub.fetch('https://rate-limiter-do/rate-limit/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, limit, windowSeconds }),
    });

    if (res.status === 429) {
      const data = (await res.json()) as DoRateLimitResult;
      return new Response(
        JSON.stringify({
          error: 'EXACT_RATE_LIMIT_EXCEEDED',
          layer: 'DURABLE_OBJECT',
          key,
          limit,
          current: data.current,
          resetInSeconds: data.resetInSeconds,
          message: `Exact rate limit exceeded: ${data.current}/${limit} in rolling ${windowSeconds}s window.`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(data.resetInSeconds),
            'X-RateLimit-Layer': 'DURABLE_OBJECT',
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }
  } catch (err) {
    console.error('[RATE_LIMITER_DO Error] Failed to query Durable Object counter:', err);
  }

  return null;
}
