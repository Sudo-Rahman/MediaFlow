import type { FileRunState } from '$lib/types';

type ScannableFileStatus = 'pending' | 'scanning' | 'ready' | 'error';

export type FileCardStatus =
  | 'pending'
  | 'scanning'
  | 'ready'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'cancelled'
  | 'error';

export function getFileCardStatus(
  fileStatus: ScannableFileStatus,
  runState?: FileRunState,
): FileCardStatus {
  if (fileStatus === 'scanning') {
    return 'scanning';
  }

  if (fileStatus === 'error' || runState?.status === 'error') {
    return 'error';
  }

  if (runState?.status === 'queued') {
    return 'queued';
  }
  if (runState?.status === 'processing') {
    return 'processing';
  }
  if (runState?.status === 'completed') {
    return 'completed';
  }
  if (runState?.status === 'cancelled') {
    return 'cancelled';
  }

  if (fileStatus === 'pending') {
    return 'pending';
  }

  return 'ready';
}

export function getFileCardStatusLabel(
  fileStatus: ScannableFileStatus,
  runState?: FileRunState,
  fileError?: string,
): string {
  const status = getFileCardStatus(fileStatus, runState);

  if (status === 'processing') {
    return `Processing ${Math.round(runState?.progress ?? 0)}%`;
  }
  if (status === 'queued') {
    return 'Queued';
  }
  if (status === 'completed') {
    return 'Completed';
  }
  if (status === 'cancelled') {
    return 'Cancelled';
  }
  if (status === 'scanning') {
    return 'Scanning...';
  }
  if (status === 'pending') {
    return 'Pending';
  }
  if (status === 'error') {
    return runState?.error || fileError || 'Failed';
  }

  return 'Ready';
}

export function getFileCardStatusTextClass(status: FileCardStatus): string {
  if (status === 'error') {
    return 'text-destructive';
  }
  if (status === 'cancelled') {
    return 'text-orange-500';
  }
  return 'text-muted-foreground';
}

export function shouldShowFileCardProgress(status: FileCardStatus): boolean {
  return status === 'processing' || status === 'queued';
}
