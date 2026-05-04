import { isTauri } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';

import { logAndToast } from '$lib/utils/log-toast';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const UPDATE_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export type UpdaterStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'installing'
  | 'relaunching'
  | 'error';

export interface UpdaterProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  percentage: number | null;
}

let status = $state<UpdaterStatus>('idle');
let availableVersion = $state<string | null>(null);
let currentVersion = $state<string | null>(null);
let updateDate = $state<string | null>(null);
let lastCheckAt = $state<Date | null>(null);
let lastError = $state<string | null>(null);
let progress = $state<UpdaterProgress | null>(null);
let currentUpdate = $state.raw<Update | null>(null);
let intervalId: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setAvailableUpdate(update: Update | null): void {
  if (currentUpdate && currentUpdate !== update) {
    void currentUpdate.close().catch(() => {});
  }

  currentUpdate = update;
  availableVersion = update?.version ?? null;
  currentVersion = update?.currentVersion ?? null;
  updateDate = update?.date ?? null;
}

function resetProgress(): void {
  progress = null;
}

function updateDownloadProgress(event: DownloadEvent): void {
  if (event.event === 'Started') {
    progress = {
      downloadedBytes: 0,
      totalBytes: event.data.contentLength ?? null,
      percentage: event.data.contentLength ? 0 : null,
    };
    return;
  }

  if (event.event === 'Progress') {
    const previous = progress ?? {
      downloadedBytes: 0,
      totalBytes: null,
      percentage: null,
    };
    const downloadedBytes = previous.downloadedBytes + event.data.chunkLength;
    const percentage = previous.totalBytes
      ? Math.min(100, Math.round((downloadedBytes / previous.totalBytes) * 100))
      : null;

    progress = {
      downloadedBytes,
      totalBytes: previous.totalBytes,
      percentage,
    };
    return;
  }

  progress = {
    downloadedBytes: progress?.totalBytes ?? progress?.downloadedBytes ?? 0,
    totalBytes: progress?.totalBytes ?? null,
    percentage: 100,
  };
  status = 'installing';
}

function logUpdateError(title: string, error: unknown, showToast: boolean): void {
  const details = formatError(error);
  lastError = details;
  status = 'error';
  logAndToast.error({
    source: 'updater',
    title,
    details,
    showToast,
    showAction: showToast,
  });
}

export const updaterStore = {
  get status() {
    return status;
  },

  get availableVersion() {
    return availableVersion;
  },

  get currentVersion() {
    return currentVersion;
  },

  get updateDate() {
    return updateDate;
  },

  get lastCheckAt() {
    return lastCheckAt;
  },

  get lastError() {
    return lastError;
  },

  get progress() {
    return progress;
  },

  get hasUpdate() {
    return status === 'available' && availableVersion !== null;
  },

  get isBusy() {
    return status === 'checking'
      || status === 'downloading'
      || status === 'installing'
      || status === 'relaunching';
  },

  get isInstalling() {
    return status === 'downloading' || status === 'installing' || status === 'relaunching';
  },

  initialize(): void {
    if (initialized) return;
    initialized = true;

    void this.checkForUpdates({ manual: false });
    intervalId = setInterval(() => {
      void this.checkForUpdates({ manual: false });
    }, UPDATE_CHECK_INTERVAL_MS);
  },

  dispose(): void {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    initialized = false;
  },

  async checkForUpdates({ manual = false }: { manual?: boolean } = {}): Promise<void> {
    if (!isTauri()) {
      status = 'unsupported';
      lastCheckAt = new Date();
      return;
    }

    if (this.isInstalling) {
      return;
    }

    status = 'checking';
    lastError = null;
    resetProgress();

    try {
      const update = await check({ timeout: UPDATE_CHECK_TIMEOUT_MS });
      lastCheckAt = new Date();

      if (!update) {
        setAvailableUpdate(null);
        status = 'up-to-date';
        if (manual) {
          logAndToast.info({
            source: 'updater',
            title: 'MediaFlow is up to date',
            details: 'No update is available.',
            showToast: true,
          });
        }
        return;
      }

      setAvailableUpdate(update);
      status = 'available';
      if (manual) {
        logAndToast.info({
          source: 'updater',
          title: `Update available: v${update.version}`,
          details: `Current version: v${update.currentVersion}`,
          showToast: true,
        });
      }
    } catch (error) {
      logUpdateError('Update check failed', error, manual);
    }
  },

  async installAndRelaunch(): Promise<void> {
    if (!currentUpdate) {
      throw new Error('No update is available.');
    }

    lastError = null;
    status = 'downloading';
    resetProgress();

    try {
      await currentUpdate.downloadAndInstall(updateDownloadProgress, {
        timeout: UPDATE_INSTALL_TIMEOUT_MS,
      });
      status = 'relaunching';
      await relaunch();
    } catch (error) {
      logUpdateError('Update installation failed', error, true);
      throw error;
    }
  },
};
