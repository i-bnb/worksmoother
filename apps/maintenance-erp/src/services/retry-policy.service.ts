export type FailureCategory = 'transient' | 'permanent';

export interface RetryEvaluationResult {
  shouldRetry: boolean;
  failureCategory: FailureCategory;
  nextAttempt: number;
  nextDelaySeconds: number;
  isExhausted: boolean;
  reason: string;
}

export class RetryPolicyService {
  private static readonly DEFAULT_BASE_DELAY_SECONDS = 30;
  private static readonly DEFAULT_MAX_DELAY_SECONDS = 3600; // 1 hour max

  /**
   * Pure classifier: determines if an error is temporary/retryable or permanently fatal.
   */
  static classifyError(error: any): FailureCategory {
    if (!error) return 'transient';

    const errStr = (
      typeof error === 'string'
        ? error
        : error.message || error.code || JSON.stringify(error)
    ).toLowerCase();

    // Permanent fatal error indicators
    const permanentPatterns = [
      'invalid_recipient',
      'invalid recipient',
      'invalid email',
      'invalid phone',
      'invalid_number',
      'invalid number',
      'does not exist',
      'not found',
      'unauthorized',
      'authentication failed',
      'invalid api key',
      'forbidden',
      '400',
      '401',
      '403',
      '404',
      'template_not_found',
      'syntax_error',
      'missing required variable',
    ];

    for (const pattern of permanentPatterns) {
      if (errStr.includes(pattern)) {
        return 'permanent';
      }
    }

    return 'transient';
  }

  /**
   * Pure exponential backoff delay calculation.
   * delay = min(maxDelay, baseDelay * 2^(attempt - 1))
   */
  static calculateBackoffDelay(
    attempt: number,
    baseDelaySeconds = RetryPolicyService.DEFAULT_BASE_DELAY_SECONDS,
    maxDelaySeconds = RetryPolicyService.DEFAULT_MAX_DELAY_SECONDS
  ): number {
    const exponent = Math.max(0, attempt - 1);
    const calculated = baseDelaySeconds * Math.pow(2, exponent);
    return Math.min(maxDelaySeconds, calculated);
  }

  /**
   * Evaluates whether a failed notification delivery should be scheduled for retry.
   */
  static evaluateRetry(params: {
    currentAttempt: number;
    maxAttempts?: number;
    error: any;
    baseDelaySeconds?: number;
  }): RetryEvaluationResult {
    const currentAttempt = Math.max(1, params.currentAttempt);
    const maxAttempts = params.maxAttempts || 5;
    const category = this.classifyError(params.error);

    if (category === 'permanent') {
      return {
        shouldRetry: false,
        failureCategory: 'permanent',
        nextAttempt: currentAttempt,
        nextDelaySeconds: 0,
        isExhausted: true,
        reason: 'Permanent error detected; will not retry.',
      };
    }

    if (currentAttempt >= maxAttempts) {
      return {
        shouldRetry: false,
        failureCategory: 'transient',
        nextAttempt: currentAttempt,
        nextDelaySeconds: 0,
        isExhausted: true,
        reason: `Maximum retry attempts (${maxAttempts}) reached. Moving to dead-letter.`,
      };
    }

    const nextAttempt = currentAttempt + 1;
    const nextDelay = this.calculateBackoffDelay(
      nextAttempt,
      params.baseDelaySeconds || this.DEFAULT_BASE_DELAY_SECONDS
    );

    return {
      shouldRetry: true,
      failureCategory: 'transient',
      nextAttempt,
      nextDelaySeconds: nextDelay,
      isExhausted: false,
      reason: `Transient error. Retrying in ${nextDelay}s (attempt ${nextAttempt}/${maxAttempts}).`,
    };
  }
}
