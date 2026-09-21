/**
 * =============================================================================
 * Test Suite 7: Retry Policy, Exponential Backoff & Dead-Letter Handling
 * Maintenance Management ERP — Phase 8 Communication & Event-Driven Messaging
 * =============================================================================
 */

import { describe, it, expect } from 'vitest';
import { RetryPolicyService } from '../../src/services/retry-policy.service.js';

describe('Phase 8: Retry Policy & Exponential Backoff Engine', () => {
  describe('Pure Error Classification', () => {
    it('classifies temporary network timeouts and 503 errors as transient', () => {
      expect(RetryPolicyService.classifyError('ETIMEDOUT: Connection timed out')).toBe('transient');
      expect(RetryPolicyService.classifyError('HTTP 503 Service Unavailable')).toBe('transient');
      expect(RetryPolicyService.classifyError('Too many requests, rate limit exceeded')).toBe('transient');
      expect(RetryPolicyService.classifyError('Socket closed unexpectedly')).toBe('transient');
    });

    it('classifies invalid recipient, bad request, and auth errors as permanent', () => {
      expect(RetryPolicyService.classifyError('Invalid email address format')).toBe('permanent');
      expect(RetryPolicyService.classifyError('Invalid phone number format')).toBe('permanent');
      expect(RetryPolicyService.classifyError('HTTP 401 Unauthorized - Invalid API Key')).toBe('permanent');
      expect(RetryPolicyService.classifyError('Template_not_found: tpl_missing')).toBe('permanent');
      expect(RetryPolicyService.classifyError('Syntax_error inside message format')).toBe('permanent');
    });
  });

  describe('Pure Exponential Backoff Delay Calculation', () => {
    it('calculates expected exponential delays based on attempt count', () => {
      const baseDelay = 30; // 30 seconds

      // Attempt 1: 30 * 2^0 = 30s
      expect(RetryPolicyService.calculateBackoffDelay(1, baseDelay)).toBe(30);

      // Attempt 2: 30 * 2^1 = 60s
      expect(RetryPolicyService.calculateBackoffDelay(2, baseDelay)).toBe(60);

      // Attempt 3: 30 * 2^2 = 120s
      expect(RetryPolicyService.calculateBackoffDelay(3, baseDelay)).toBe(120);

      // Attempt 4: 30 * 2^3 = 240s
      expect(RetryPolicyService.calculateBackoffDelay(4, baseDelay)).toBe(240);

      // Attempt 5: 30 * 2^4 = 480s
      expect(RetryPolicyService.calculateBackoffDelay(5, baseDelay)).toBe(480);
    });

    it('enforces maximum delay ceiling to prevent runaway wait times', () => {
      const baseDelay = 30;
      const maxDelay = 300; // 5 minutes max

      // 30 * 2^7 = 3840 > 300 => should be capped at 300
      expect(RetryPolicyService.calculateBackoffDelay(8, baseDelay, maxDelay)).toBe(300);
    });
  });

  describe('Retry Evaluation Lifecycle', () => {
    it('schedules retry for transient error when attempts remain', () => {
      const evalResult = RetryPolicyService.evaluateRetry({
        currentAttempt: 1,
        maxAttempts: 3,
        error: 'Network connection dropped by peer',
      });

      expect(evalResult.shouldRetry).toBe(true);
      expect(evalResult.failureCategory).toBe('transient');
      expect(evalResult.nextAttempt).toBe(2);
      expect(evalResult.nextDelaySeconds).toBe(60);
      expect(evalResult.isExhausted).toBe(false);
    });

    it('immediately aborts and marks permanent failure for fatal errors', () => {
      const evalResult = RetryPolicyService.evaluateRetry({
        currentAttempt: 1,
        maxAttempts: 5,
        error: 'Invalid recipient: customer@invalid_domain_99999.xyz',
      });

      expect(evalResult.shouldRetry).toBe(false);
      expect(evalResult.failureCategory).toBe('permanent');
      expect(evalResult.isExhausted).toBe(true);
      expect(evalResult.nextDelaySeconds).toBe(0);
      expect(evalResult.reason).toContain('Permanent error');
    });

    it('terminates and exhausts retries when maximum retry attempts is reached', () => {
      const evalResult = RetryPolicyService.evaluateRetry({
        currentAttempt: 3,
        maxAttempts: 3,
        error: '504 Gateway Timeout',
      });

      expect(evalResult.shouldRetry).toBe(false);
      expect(evalResult.failureCategory).toBe('transient');
      expect(evalResult.isExhausted).toBe(true);
      expect(evalResult.reason).toContain('Maximum retry attempts (3) reached');
    });
  });
});
