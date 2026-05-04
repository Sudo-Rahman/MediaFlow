<script lang="ts">
  import { AlertTriangle, Download, RefreshCw, RotateCcw } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';

  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Progress } from '$lib/components/ui/progress';
  import { updaterStore } from '$lib/stores';
  import { formatFileSize } from '$lib/utils/format';

  interface AppUpdateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    hasActiveJobs?: boolean;
  }

  let {
    open = $bindable(false),
    onOpenChange,
    hasActiveJobs = false,
  }: AppUpdateDialogProps = $props();

  let confirmInterruptionOpen = $state(false);

  const titleText = $derived(
    updaterStore.availableVersion
      ? `MediaFlow v${updaterStore.availableVersion} is available`
      : 'MediaFlow update',
  );

  const progressLabel = $derived.by(() => {
    if (!updaterStore.progress) {
      return updaterStore.status === 'installing' ? 'Installing...' : 'Preparing...';
    }

    const downloaded = formatFileSize(updaterStore.progress.downloadedBytes);
    if (!updaterStore.progress.totalBytes) {
      return `Downloaded ${downloaded}`;
    }

    return `${downloaded} of ${formatFileSize(updaterStore.progress.totalBytes)}`;
  });

  const progressValue = $derived(updaterStore.progress?.percentage ?? 0);

  const updateDateLabel = $derived.by(() => {
    if (!updaterStore.updateDate) return null;

    const parsed = new Date(updaterStore.updateDate);
    if (Number.isNaN(parsed.getTime())) return null;

    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  });

  function requestInstall(): void {
    if (updaterStore.isInstalling) return;

    if (hasActiveJobs) {
      confirmInterruptionOpen = true;
      return;
    }

    void installAndRelaunch();
  }

  async function installAndRelaunch(): Promise<void> {
    try {
      await updaterStore.installAndRelaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{titleText}</Dialog.Title>
      <Dialog.Description>
        Download and install the update, then relaunch MediaFlow.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="rounded-lg border bg-muted/30 p-3">
        <div class="flex items-start gap-3">
          <div class="mt-0.5 rounded-md bg-background p-2">
            <Download class="size-4 text-primary" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">Version {updaterStore.availableVersion ?? 'unknown'}</p>
            {#if updateDateLabel}
              <p class="text-xs text-muted-foreground">{updateDateLabel}</p>
            {/if}
            {#if updaterStore.currentVersion}
              <p class="mt-1 text-xs text-muted-foreground">
                Current version: {updaterStore.currentVersion}
              </p>
            {/if}
          </div>
        </div>
      </div>

      {#if updaterStore.isInstalling}
        <div class="space-y-2">
          <div class="flex items-center justify-between text-xs text-muted-foreground">
            <span>{progressLabel}</span>
            {#if updaterStore.progress?.percentage !== null && updaterStore.progress?.percentage !== undefined}
              <span>{updaterStore.progress.percentage}%</span>
            {/if}
          </div>
          <Progress value={progressValue} />
        </div>
      {/if}

      {#if hasActiveJobs && !updaterStore.isInstalling}
        <div class="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p class="text-amber-700 dark:text-amber-300">
            Processing is active. Updating now will stop current work and relaunch the app.
          </p>
        </div>
      {/if}
    </div>

    <Dialog.Footer>
      <Button
        variant="outline"
        onclick={() => onOpenChange(false)}
        disabled={updaterStore.isInstalling}
      >
        Later
      </Button>
      <Button onclick={requestInstall} disabled={updaterStore.isInstalling}>
        {#if updaterStore.status === 'downloading' || updaterStore.status === 'installing'}
          <RefreshCw class="size-4 animate-spin" />
          Updating...
        {:else if updaterStore.status === 'relaunching'}
          <RotateCcw class="size-4 animate-spin" />
          Relaunching...
        {:else}
          <Download class="size-4" />
          Update & Relaunch
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmInterruptionOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Stop active work?</AlertDialog.Title>
      <AlertDialog.Description>
        MediaFlow will stop current processing, install the update, and relaunch.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={() => {
          confirmInterruptionOpen = false;
          void installAndRelaunch();
        }}
      >
        Update & Relaunch
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
