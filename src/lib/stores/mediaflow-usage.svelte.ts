import { fetchMediaFlowAccountUsage, type MediaFlowHttpResponse } from '$lib/services/mediaflow-auth';

export type MediaFlowUsageStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MediaFlowUsage {
  plan: 'free' | 'plus' | 'pro';
  hasApiAccess: boolean;
  monthlyBalance: number;
  monthlyAllocation: number;
  monthlyUsed: number;
  monthlyUsagePercent: number;
  monthlyRemainingPercent: number;
  purchasedBalance: number;
  totalBalance: number;
  availableBalance: number;
  lastResetDate: number;
}

export interface MediaFlowUsageRefreshOptions {
  silent?: boolean;
}

interface MediaFlowApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

const SCHEDULE_REFRESH_DELAY_MS = 250;

let usage = $state<MediaFlowUsage | null>(null);
let status = $state<MediaFlowUsageStatus>('idle');
let isRefreshing = $state(false);
let error = $state<string | null>(null);
let lastLoadedAt = $state<number | null>(null);
let refreshRequestId = 0;
let scheduledRefresh: ReturnType<typeof setTimeout> | null = null;

function toFiniteNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : 0;
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined;
}

function normalizePlan(value: unknown): MediaFlowUsage['plan'] {
  return value === 'plus' || value === 'pro' ? value : 'free';
}

function normalizeUsage(payload: unknown): MediaFlowUsage {
  return {
    plan: normalizePlan(objectValue(payload, 'plan')),
    hasApiAccess: Boolean(objectValue(payload, 'hasApiAccess')),
    monthlyBalance: toFiniteNumber(objectValue(payload, 'monthlyBalance')),
    monthlyAllocation: toFiniteNumber(objectValue(payload, 'monthlyAllocation')),
    monthlyUsed: toFiniteNumber(objectValue(payload, 'monthlyUsed')),
    monthlyUsagePercent: toFiniteNumber(objectValue(payload, 'monthlyUsagePercent')),
    monthlyRemainingPercent: toFiniteNumber(objectValue(payload, 'monthlyRemainingPercent')),
    purchasedBalance: toFiniteNumber(objectValue(payload, 'purchasedBalance')),
    totalBalance: toFiniteNumber(objectValue(payload, 'totalBalance')),
    availableBalance: toFiniteNumber(objectValue(payload, 'availableBalance')),
    lastResetDate: toFiniteNumber(objectValue(payload, 'lastResetDate')),
  };
}

async function responseErrorMessage(response: MediaFlowHttpResponse): Promise<string> {
  try {
    const body = JSON.parse(response.body) as MediaFlowApiErrorBody;
    const code = body.error?.code;
    const message = body.error?.message;
    if (code && message) return `${message} (${code})`;
    if (message) return message;
    if (code) return code;
  } catch {
    // Older backend builds may return plain text errors.
  }

  return `Usage request failed (${response.status}).`;
}

async function fetchUsage(): Promise<MediaFlowUsage> {
  const response = await fetchMediaFlowAccountUsage();
  if (response.status >= 200 && response.status < 300) {
    return normalizeUsage(JSON.parse(response.body));
  }

  throw new Error(await responseErrorMessage(response));
}

export const mediaflowUsageStore = {
  get usage() { return usage; },
  get status() { return status; },
  get isRefreshing() { return isRefreshing; },
  get error() { return error; },
  get lastLoadedAt() { return lastLoadedAt; },

  async refresh(options: MediaFlowUsageRefreshOptions = {}): Promise<void> {
    const requestId = ++refreshRequestId;
    const keepVisibleValue = options.silent && usage;

    isRefreshing = true;
    error = null;
    if (!keepVisibleValue) {
      status = 'loading';
    }

    try {
      const nextUsage = await fetchUsage();
      if (requestId !== refreshRequestId) return;

      usage = nextUsage;
      status = 'ready';
      lastLoadedAt = Date.now();
    } catch (refreshError) {
      if (requestId !== refreshRequestId) return;

      error = refreshError instanceof Error ? refreshError.message : String(refreshError);
      status = usage ? 'ready' : 'error';
    } finally {
      if (requestId === refreshRequestId) {
        isRefreshing = false;
      }
    }
  },

  scheduleRefresh(): void {
    if (scheduledRefresh) {
      clearTimeout(scheduledRefresh);
    }

    scheduledRefresh = setTimeout(() => {
      scheduledRefresh = null;
      void this.refresh({ silent: true });
    }, SCHEDULE_REFRESH_DELAY_MS);
  },

  clear(): void {
    refreshRequestId += 1;
    if (scheduledRefresh) {
      clearTimeout(scheduledRefresh);
      scheduledRefresh = null;
    }

    usage = null;
    status = 'idle';
    isRefreshing = false;
    error = null;
    lastLoadedAt = null;
  },
};
