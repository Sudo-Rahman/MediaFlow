import type { OSType } from '$lib/utils';

export type PlatformChrome = 'macos-overlay' | 'windows-custom' | 'native';

export function getPlatformChrome(os: OSType): PlatformChrome {
  if (os === 'MacOS') return 'macos-overlay';
  if (os === 'Windows') return 'windows-custom';
  return 'native';
}
