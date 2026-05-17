export type MediaFlowDistribution = 'standard' | 'microsoft-store';

export const MEDIAFLOW_DISTRIBUTION = normalizeMediaFlowDistribution(
  import.meta.env.VITE_MEDIAFLOW_DISTRIBUTION
);

export function normalizeMediaFlowDistribution(value: unknown): MediaFlowDistribution {
  return value === 'microsoft-store' ? 'microsoft-store' : 'standard';
}

export function isMicrosoftStoreDistribution(
  distribution = MEDIAFLOW_DISTRIBUTION
): boolean {
  return distribution === 'microsoft-store';
}

export function getUpdateManagementLabel(distribution = MEDIAFLOW_DISTRIBUTION): string {
  return isMicrosoftStoreDistribution(distribution)
    ? 'Updates are managed by Microsoft Store'
    : 'Updates are managed by MediaFlow';
}
