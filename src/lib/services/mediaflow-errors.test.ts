import { describe, expect, it } from 'vitest';
import { normalizeMediaFlowError } from './mediaflow-errors';

describe('normalizeMediaFlowError', () => {
  it('maps structured rate limit errors to a human-readable warning', () => {
    const error = normalizeMediaFlowError({
      status: 429,
      errorCode: 'rate_limit_exceeded',
      errorMessage: 'Rate limit exceeded.',
      requestId: 'req_123',
      retryable: true,
      retryAfter: 60_000,
      technicalError: '{"error":{"code":"rate_limit_exceeded"}}',
    });

    expect(error).toMatchObject({
      title: 'MediaFlow rate limit reached',
      message: 'MediaFlow rate limit reached. Wait a moment, then retry.',
      action: 'Wait a moment, then retry.',
      severity: 'warning',
      retryable: true,
      status: 429,
      code: 'rate_limit_exceeded',
      backendMessage: 'Rate limit exceeded.',
      requestId: 'req_123',
      retryAfter: 60_000,
    });
    expect(error.details).toContain('What to do: Wait a moment, then retry.');
    expect(error.details).toContain('Request ID: req_123');
  });

  it('parses raw MediaFlow API error bodies', () => {
    const error = normalizeMediaFlowError({
      status: 429,
      error: JSON.stringify({
        error: {
          code: 'free_daily_limit_exceeded',
          message: 'Free daily usage limit exceeded.',
          request_id: 'req_daily',
        },
      }),
    });

    expect(error).toMatchObject({
      title: 'Free daily usage exhausted',
      message: 'Free daily MediaFlow usage is exhausted. Try again after the daily reset or upgrade.',
      severity: 'error',
      retryable: false,
      code: 'free_daily_limit_exceeded',
      backendMessage: 'Free daily usage limit exceeded.',
      requestId: 'req_daily',
    });
  });

  it('falls back from status when the backend body is malformed', () => {
    const error = normalizeMediaFlowError({
      status: 429,
      error: 'too many requests',
      retryable: true,
    });

    expect(error).toMatchObject({
      title: 'MediaFlow rate limit reached',
      message: 'MediaFlow rate limit reached. Wait a moment, then retry.',
      code: 'rate_limit_exceeded',
      backendMessage: 'too many requests',
      retryable: true,
    });
  });

  it('keeps unknown codes copyable as technical details', () => {
    const error = normalizeMediaFlowError({
      status: 418,
      errorCode: 'unexpected_backend_state',
      errorMessage: 'Unexpected backend state.',
      requestId: 'req_unknown',
    });

    expect(error).toMatchObject({
      title: 'MediaFlow request failed',
      message: 'MediaFlow could not complete this request.',
      code: 'unexpected_backend_state',
      backendMessage: 'Unexpected backend state.',
      requestId: 'req_unknown',
    });
    expect(error.details).toContain('Code: unexpected_backend_state');
    expect(error.details).toContain('Request ID: req_unknown');
  });
});
