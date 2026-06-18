export interface MediaFlowErrorInput {
  status?: number;
  error?: string;
  errorCode?: string;
  errorMessage?: string;
  requestId?: string;
  technicalError?: string;
  retryable?: boolean;
  retryAfter?: number;
}

export interface NormalizedMediaFlowError {
  title: string;
  message: string;
  action: string;
  details: string;
  severity: 'warning' | 'error';
  retryable: boolean;
  status?: number;
  code?: string;
  backendMessage?: string;
  requestId?: string;
  retryAfter?: number;
  technicalError?: string;
}

interface ParsedMediaFlowApiError {
  code?: string;
  message?: string;
  requestId?: string;
}

interface MediaFlowErrorCopy {
  title: string;
  message: string;
  action: string;
  retryable?: boolean;
  severity?: 'warning' | 'error';
}

const ERROR_COPY_BY_CODE: Record<string, MediaFlowErrorCopy> = {
  rate_limit_exceeded: {
    title: 'MediaFlow rate limit reached',
    message: 'MediaFlow rate limit reached. Wait a moment, then retry.',
    action: 'Wait a moment, then retry.',
    retryable: true,
    severity: 'warning',
  },
  free_daily_request_in_progress: {
    title: 'MediaFlow request already running',
    message: 'A MediaFlow Free daily request is already running. Wait for it to finish before starting another one.',
    action: 'Wait for the current MediaFlow request to finish before retrying.',
    retryable: true,
    severity: 'warning',
  },
  free_daily_limit_exceeded: {
    title: 'Free daily usage exhausted',
    message: 'Free daily MediaFlow usage is exhausted. Try again after the daily reset or upgrade.',
    action: 'Try again after the daily reset or upgrade.',
  },
  free_daily_model_not_allowed: {
    title: 'Model unavailable on Free daily',
    message: 'This model is not available with Free daily access. Use Lite or upgrade.',
    action: 'Select the Lite model or upgrade your MediaFlow plan.',
  },
  starter_model_not_allowed: {
    title: 'Model unavailable on Starter',
    message: 'This model is not available with Starter access. Use Lite or Medium, or upgrade.',
    action: 'Select Lite or Medium, or upgrade your MediaFlow plan.',
  },
  subscription_required: {
    title: 'MediaFlow subscription required',
    message: 'A MediaFlow subscription is required for this request.',
    action: 'Subscribe or choose a request available on your current access.',
  },
  starter_access_expired: {
    title: 'Starter access expired',
    message: 'Starter access has expired.',
    action: 'Upgrade your MediaFlow access before retrying.',
  },
  insufficient_credits: {
    title: 'No MediaFlow usage available',
    message: 'No MediaFlow usage is available for this request.',
    action: 'Add MediaFlow usage or wait until access is available again.',
  },
  invalid_token: {
    title: 'MediaFlow sign-in expired',
    message: 'MediaFlow sign-in expired. Sign in again.',
    action: 'Sign out of MediaFlow, then sign in again.',
  },
  invalid_request: {
    title: 'MediaFlow could not accept the request',
    message: 'MediaFlow could not accept this request.',
    action: 'Review the selected model and input, then retry.',
  },
  provider_error: {
    title: 'MediaFlow provider request failed',
    message: 'MediaFlow could not complete the provider request. Try again later.',
    action: 'Try again later.',
    retryable: true,
    severity: 'warning',
  },
  service_unavailable: {
    title: 'MediaFlow temporarily unavailable',
    message: 'MediaFlow is temporarily unavailable. Try again later.',
    action: 'Try again later.',
    retryable: true,
    severity: 'warning',
  },
  request_cancelled: {
    title: 'MediaFlow request cancelled',
    message: 'MediaFlow request cancelled.',
    action: 'Start the request again if needed.',
  },
};

function parseMediaFlowApiErrorBody(body: string | undefined): ParsedMediaFlowApiError {
  if (!body?.trim()) return {};

  try {
    const parsed = JSON.parse(body) as {
      error?: {
        code?: unknown;
        message?: unknown;
        request_id?: unknown;
      };
      code?: unknown;
      message?: unknown;
      request_id?: unknown;
    };
    const error = parsed.error;
    return {
      code: typeof error?.code === 'string'
        ? error.code
        : typeof parsed.code === 'string'
          ? parsed.code
          : undefined,
      message: typeof error?.message === 'string'
        ? error.message
        : typeof parsed.message === 'string'
          ? parsed.message
          : undefined,
      requestId: typeof error?.request_id === 'string'
        ? error.request_id
        : typeof parsed.request_id === 'string'
          ? parsed.request_id
          : undefined,
    };
  } catch {
    return {};
  }
}

function codeFromStatus(status: number | undefined): string | undefined {
  switch (status) {
    case 401:
      return 'invalid_token';
    case 429:
      return 'rate_limit_exceeded';
    case 503:
      return 'service_unavailable';
    default:
      return status && status >= 500 ? 'service_unavailable' : undefined;
  }
}

function technicalLines(error: NormalizedMediaFlowError): string[] {
  return [
    error.status ? `Status: ${error.status}` : undefined,
    error.code ? `Code: ${error.code}` : undefined,
    error.requestId ? `Request ID: ${error.requestId}` : undefined,
    error.retryAfter ? `Retry after: ${Math.ceil(error.retryAfter / 1000)}s` : undefined,
    error.backendMessage ? `Backend message: ${error.backendMessage}` : undefined,
  ].filter((line): line is string => Boolean(line));
}

function buildDetails(error: Omit<NormalizedMediaFlowError, 'details'>): string {
  const lines = [
    error.message,
    error.action ? `What to do: ${error.action}` : undefined,
    ...technicalLines(error as NormalizedMediaFlowError),
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

export function normalizeMediaFlowError(input: MediaFlowErrorInput): NormalizedMediaFlowError {
  const parsed = parseMediaFlowApiErrorBody(input.technicalError ?? input.error);
  const code = input.errorCode ?? parsed.code ?? codeFromStatus(input.status);
  const backendMessage = input.errorMessage ?? parsed.message ?? input.error;
  const requestId = input.requestId ?? parsed.requestId;
  const copy = code ? ERROR_COPY_BY_CODE[code] : undefined;
  const retryable = copy?.retryable ?? input.retryable ?? false;
  const normalizedWithoutDetails: Omit<NormalizedMediaFlowError, 'details'> = {
    title: copy?.title ?? 'MediaFlow request failed',
    message: copy?.message ?? 'MediaFlow could not complete this request.',
    action: copy?.action ?? 'Try again later. If the issue continues, copy the technical details and contact support.',
    severity: copy?.severity ?? (retryable ? 'warning' : 'error'),
    retryable,
    ...(input.status ? { status: input.status } : {}),
    ...(code ? { code } : {}),
    ...(backendMessage ? { backendMessage } : {}),
    ...(requestId ? { requestId } : {}),
    ...(input.retryAfter ? { retryAfter: input.retryAfter } : {}),
    ...(input.technicalError ? { technicalError: input.technicalError } : {}),
  };

  return {
    ...normalizedWithoutDetails,
    details: buildDetails(normalizedWithoutDetails),
  };
}

export function hasStructuredMediaFlowError(input: MediaFlowErrorInput): boolean {
  return Boolean(
    input.errorCode ||
    input.errorMessage ||
    input.technicalError ||
    input.requestId ||
    (input.status !== undefined && input.status >= 400)
  );
}

export function isTerminalMediaFlowApiError(input: MediaFlowErrorInput): boolean {
  const normalized = normalizeMediaFlowError(input);
  return Boolean(normalized.code || (normalized.status !== undefined && normalized.status >= 400));
}
