import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMediaFlowAccountUsageMock = vi.hoisted(() => vi.fn());

vi.mock('$lib/services/mediaflow-auth', () => ({
  fetchMediaFlowAccountUsage: fetchMediaFlowAccountUsageMock,
}));

function usageResponse(body: unknown) {
  return {
    status: 200,
    body: JSON.stringify(body),
  };
}

describe('mediaflowUsageStore', () => {
  beforeEach(() => {
    fetchMediaFlowAccountUsageMock.mockReset();
  });

  it('normalizes the v1.1 abstract usage meter without legacy credit fields', async () => {
    const { mediaflowUsageStore } = await import('./mediaflow-usage.svelte');
    mediaflowUsageStore.clear();
    fetchMediaFlowAccountUsageMock.mockResolvedValueOnce(usageResponse({
      plan: 'free',
      hasApiAccess: true,
      accessKind: 'free_daily',
      meter: {
        source: 'free_daily',
        remainingPercent: 84,
        blocked: false,
        requestInProgress: false,
        resetAt: Date.parse('2026-06-18T00:00:00Z'),
      },
      monthlyBalance: 12,
      monthlyAllocation: 400,
      purchasedBalance: 8,
    }));

    await mediaflowUsageStore.refresh();

    expect(mediaflowUsageStore.status).toBe('ready');
    expect(mediaflowUsageStore.usage).toEqual({
      plan: 'free',
      hasApiAccess: true,
      accessKind: 'free_daily',
      meter: {
        source: 'free_daily',
        remainingPercent: 84,
        blocked: false,
        requestInProgress: false,
        resetAt: Date.parse('2026-06-18T00:00:00Z'),
      },
    });
    expect(mediaflowUsageStore.usage).not.toHaveProperty('monthlyBalance');
    expect(mediaflowUsageStore.usage).not.toHaveProperty('monthlyAllocation');
    expect(mediaflowUsageStore.usage).not.toHaveProperty('purchasedBalance');
  });

  it('clamps v1.1 remaining percentage to the progress range', async () => {
    const { mediaflowUsageStore } = await import('./mediaflow-usage.svelte');
    mediaflowUsageStore.clear();
    fetchMediaFlowAccountUsageMock.mockResolvedValueOnce(usageResponse({
      plan: 'plus',
      hasApiAccess: true,
      accessKind: 'subscription',
      meter: {
        source: 'subscription',
        remainingPercent: 150,
        blocked: false,
        requestInProgress: false,
        resetAt: null,
      },
    }));

    await mediaflowUsageStore.refresh();

    expect(mediaflowUsageStore.usage?.meter.remainingPercent).toBe(100);

    fetchMediaFlowAccountUsageMock.mockResolvedValueOnce(usageResponse({
      plan: 'plus',
      hasApiAccess: true,
      accessKind: 'subscription',
      meter: {
        source: 'subscription',
        remainingPercent: -20,
        blocked: true,
        requestInProgress: false,
        resetAt: null,
      },
    }));

    await mediaflowUsageStore.refresh();

    expect(mediaflowUsageStore.usage?.meter.remainingPercent).toBe(0);
  });
});
