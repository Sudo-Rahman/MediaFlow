import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { toast } from 'svelte-sonner';
import { browser, dev } from '$app/environment';
import { formatFileSize } from '$lib/utils/format';
import { log, logAndToast } from '$lib/utils/log-toast';

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready-to-restart'
  | 'error';

type AvailableUpdate = NonNullable<Awaited<ReturnType<typeof check>>>;

const UPDATE_TARGET = 'macos-universal';
const INFINITE_TOAST_DURATION = Number.POSITIVE_INFINITY;

let status = $state<AppUpdateStatus>('idle');
let currentVersion = $state<string | null>(null);
let availableVersion = $state<string | null>(null);
let releaseNotes = $state('');
let releasedAt = $state<string | null>(null);
let errorMessage = $state<string | null>(null);
let hasChecked = $state(false);
let dismissedVersion = $state<string | null>(null);

let pendingUpdate: AvailableUpdate | null = null;
let initializePromise: Promise<void> | null = null;
let availabilityToastId = $state<number | string | null>(null);
let downloadToastId = $state<number | string | null>(null);
let restartToastId = $state<number | string | null>(null);
let downloadedBytes = 0;

function isTauriRuntime(): boolean {
  return browser && typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function canCheckForUpdates(): boolean {
  return isTauriRuntime() && !dev;
}

function normalizeNotes(notes: string | null | undefined): string {
  return notes?.trim() ?? '';
}

function getReleaseNotePreview(notes: string): string {
  const firstLine = notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*#\s]+/, '').trim())
    .find((line) => line.length > 0);

  return firstLine ?? '';
}

function buildAvailabilityDescription(): string {
  if (!availableVersion) {
    return 'A newer MediaFlow build is available.';
  }

  const detailParts = [`Version ${availableVersion}`];
  if (releasedAt) {
    detailParts.push(new Date(releasedAt).toLocaleString('en-US'));
  }

  const preview = getReleaseNotePreview(releaseNotes);
  return preview.length > 0 ? `${detailParts.join(' • ')} — ${preview}` : detailParts.join(' • ');
}

function buildRestartDescription(): string {
  if (!availableVersion) {
    return 'Restart MediaFlow to finish applying the latest update.';
  }

  return `MediaFlow ${availableVersion} has been installed. Restart the app to finish updating.`;
}

function dismissToast(id: number | string | null): void {
  if (id !== null) {
    toast.dismiss(id);
  }
}

function clearAvailabilityToast(): void {
  dismissToast(availabilityToastId);
  availabilityToastId = null;
}

function clearDownloadToast(): void {
  dismissToast(downloadToastId);
  downloadToastId = null;
}

function clearRestartToast(): void {
  dismissToast(restartToastId);
  restartToastId = null;
}

function showAvailabilityToast(): void {
  if (!availableVersion || dismissedVersion === availableVersion) {
    return;
  }

  clearDownloadToast();
  clearRestartToast();
  clearAvailabilityToast();

  availabilityToastId = toast.info('Update available', {
    description: buildAvailabilityDescription(),
    duration: INFINITE_TOAST_DURATION,
    action: {
      label: 'Update',
      onClick: () => {
        void appUpdateStore.installUpdate();
      }
    },
    onDismiss: () => {
      availabilityToastId = null;
      if (status === 'available' && availableVersion) {
        dismissedVersion = availableVersion;
      }
    }
  });
}

function updateDownloadToast(description: string): void {
  downloadToastId = toast.loading('Installing update...', {
    id: downloadToastId ?? undefined,
    description,
    duration: INFINITE_TOAST_DURATION,
    dismissable: false
  });
}

function showRestartToast(): void {
  clearAvailabilityToast();
  clearDownloadToast();
  clearRestartToast();

  restartToastId = toast.success('Restart required', {
    description: buildRestartDescription(),
    duration: INFINITE_TOAST_DURATION,
    action: {
      label: 'Restart',
      onClick: () => {
        void appUpdateStore.restartToApplyUpdate();
      }
    },
    onDismiss: () => {
      restartToastId = null;
    }
  });
}

async function loadCurrentVersion(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }

  try {
    currentVersion = await getVersion();
  } catch (error) {
    log(
      'warning',
      'system',
      'App version lookup failed',
      error instanceof Error ? error.message : String(error)
    );
  }
}

export const appUpdateStore = {
  get status() {
    return status;
  },

  get currentVersion() {
    return currentVersion;
  },

  get availableVersion() {
    return availableVersion;
  },

  get releaseNotes() {
    return releaseNotes;
  },

  get releasedAt() {
    return releasedAt;
  },

  get errorMessage() {
    return errorMessage;
  },

  get hasChecked() {
    return hasChecked;
  },

  get updateTarget() {
    return UPDATE_TARGET;
  },

  async initialize(): Promise<void> {
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      await loadCurrentVersion();

      if (canCheckForUpdates()) {
        await this.checkForUpdates();
      } else {
        hasChecked = true;
      }
    })().finally(() => {
      initializePromise = null;
    });

    return initializePromise;
  },

  async checkForUpdates(force = false): Promise<AvailableUpdate | null> {
    if (!canCheckForUpdates()) {
      hasChecked = true;
      return null;
    }

    if (status === 'checking') {
      return pendingUpdate;
    }

    if (hasChecked && !force) {
      return pendingUpdate;
    }

    status = 'checking';
    errorMessage = null;

    try {
      const update = await check({ target: UPDATE_TARGET });
      hasChecked = true;

      if (!update) {
        pendingUpdate = null;
        status = 'idle';
        availableVersion = null;
        releaseNotes = '';
        releasedAt = null;
        errorMessage = null;
        return null;
      }

      pendingUpdate = update;
      currentVersion = update.currentVersion;
      availableVersion = update.version;
      releaseNotes = normalizeNotes(update.body);
      releasedAt = update.date ?? null;
      status = 'available';

      log(
        'info',
        'system',
        'Update available',
        `Current version: ${currentVersion ?? 'unknown'} | Available version: ${update.version}`
      );

      showAvailabilityToast();
      return update;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pendingUpdate = null;
      status = 'error';
      errorMessage = message;
      hasChecked = true;

      log('warning', 'system', 'Update check failed', message);
      return null;
    }
  },

  async installUpdate(): Promise<boolean> {
    if (!canCheckForUpdates()) {
      return false;
    }

    if (status === 'downloading') {
      return false;
    }

    let update = pendingUpdate;
    if (!update) {
      update = await this.checkForUpdates(true);
    }

    if (!update) {
      return false;
    }

    status = 'downloading';
    errorMessage = null;
    dismissedVersion = null;
    downloadedBytes = 0;
    clearAvailabilityToast();
    updateDownloadToast(`Downloading MediaFlow ${update.version} in the background...`);

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          const expectedBytes = event.data.contentLength;
          const detail = expectedBytes && expectedBytes > 0
            ? `Downloading ${formatFileSize(expectedBytes)} update package...`
            : `Downloading MediaFlow ${update.version}...`;

          updateDownloadToast(detail);
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          updateDownloadToast(`Downloaded ${formatFileSize(downloadedBytes)} of the update package...`);
        } else if (event.event === 'Finished') {
          updateDownloadToast('Finalizing the installation...');
        }
      });

      pendingUpdate = null;
      downloadedBytes = 0;
      status = 'ready-to-restart';
      clearDownloadToast();
      showRestartToast();

      log(
        'success',
        'system',
        'Update installed',
        `MediaFlow ${availableVersion ?? update.version} is ready to restart`
      );

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = 'error';
      errorMessage = message;
      downloadedBytes = 0;
      clearDownloadToast();

      logAndToast.error({
        source: 'system',
        title: 'Update installation failed',
        details: message
      });

      return false;
    }
  },

  async restartToApplyUpdate(): Promise<void> {
    try {
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logAndToast.error({
        source: 'system',
        title: 'Restart failed',
        details: message
      });
    }
  }
};
