<script lang="ts" module>
  import type { MediaFlowUser } from '$lib/stores/settings.svelte';

  export interface AccountDisplayLines {
    primary: string;
    secondary: string | null;
  }

  function trimmed(value: string | undefined): string {
    return value?.trim() ?? '';
  }

  export function getAccountDisplayLines(user: MediaFlowUser): AccountDisplayLines {
    const name = trimmed(user.name);

    if (name) {
      return {
        primary: name,
        secondary: user.email,
      };
    }

    return {
      primary: user.email,
      secondary: null,
    };
  }

  export function getAccountInitials(user: MediaFlowUser | null | undefined): string {
    const source = trimmed(user?.name) || user?.email || 'MF';
    const parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }

  export function getAccountAvatarAlt(user: MediaFlowUser): string {
    return trimmed(user.name) || user.email;
  }
</script>

<script lang="ts">
  import {
    ChevronsUpDown,
    LayoutDashboard,
    Loader2,
    LogIn,
    LogOut,
    RefreshCw,
    XCircle,
    UserRound,
  } from '@lucide/svelte';
  import { untrack } from 'svelte';

  import * as Avatar from '$lib/components/ui/avatar';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Progress } from '$lib/components/ui/progress';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { mediaflowAuthUiStore, mediaflowUsageStore, settingsStore } from '$lib/stores';

  let isOpen = $state(false);

  const mediaflowUser = $derived(settingsStore.settings.mediaflowUser);
  const usage = $derived(mediaflowUsageStore.usage);
  const usageStatus = $derived(mediaflowUsageStore.status);
  const effectiveAccountAction = $derived(mediaflowAuthUiStore.action);
  const isAccountBusy = $derived(mediaflowAuthUiStore.isBusy);
  const isWaitingForCallback = $derived(mediaflowAuthUiStore.isWaitingForCallback);
  const signedInAccountLines = $derived(mediaflowUser ? getAccountDisplayLines(mediaflowUser) : null);
  const accountPrimaryLine = $derived(
    signedInAccountLines?.primary ?? (isWaitingForCallback ? 'Waiting for browser' : 'MediaFlow Account')
  );
  const accountSecondaryLine = $derived.by(() => {
    if (signedInAccountLines) return signedInAccountLines.secondary;
    if (effectiveAccountAction !== 'idle') return mediaflowAuthUiStore.statusMessage;
    return 'Sign in to continue';
  });
  const accountButtonLabel = $derived.by(() => {
    if (effectiveAccountAction !== 'idle') return mediaflowAuthUiStore.buttonLabel;
    return 'Account';
  });
  const accountInitials = $derived(getAccountInitials(mediaflowUser));
  const monthlyRemaining = $derived(usage?.monthlyBalance ?? 0);
  const monthlyAllocation = $derived(usage?.monthlyAllocation ?? 0);
  const monthlyUsagePercent = $derived(usage?.monthlyUsagePercent ?? 0);

  $effect(() => {
    const user = mediaflowUser;
    untrack(() => {
      if (!user) {
        mediaflowUsageStore.clear();
        return;
      }
    });
  });

  $effect(() => {
    const shouldRefresh = isOpen && Boolean(mediaflowUser);
    untrack(() => {
      if (shouldRefresh) {
        void mediaflowUsageStore.refresh({ silent: true });
      }
    });
  });

</script>

<DropdownMenu.Root bind:open={isOpen}>
  <DropdownMenu.Trigger>
    {#snippet child({ props })}
      <Sidebar.MenuButton {...props} class={['transition-colors', isAccountBusy && 'text-primary']}>
        {#if isAccountBusy}
          <Loader2 class="size-4 animate-spin" />
        {:else}
          <UserRound class="size-4" />
        {/if}
        <span>{accountButtonLabel}</span>
        <ChevronsUpDown class={['ml-auto size-4 text-muted-foreground transition-transform duration-200', isAccountBusy && 'rotate-180']} />
      </Sidebar.MenuButton>
    {/snippet}
  </DropdownMenu.Trigger>
  <DropdownMenu.Content side="right" align="end" class="w-56">
    <DropdownMenu.Label>
      <div class="flex items-center gap-2 py-1">
        <Avatar.Root class={['transition-colors', isAccountBusy && 'after:border-primary/40']}>
          {#if mediaflowUser?.avatarUrl}
            <Avatar.Image src={mediaflowUser.avatarUrl} alt={getAccountAvatarAlt(mediaflowUser)} />
          {/if}
          <Avatar.Fallback class={['bg-background text-xs font-medium transition-colors', isAccountBusy && 'bg-primary/10 text-primary']}>
            {#if mediaflowUser}
              {accountInitials}
            {:else}
              <UserRound class="size-4 text-muted-foreground" />
            {/if}
          </Avatar.Fallback>
        </Avatar.Root>
        <div class={['min-w-0', accountSecondaryLine ? 'leading-tight' : 'leading-normal']}>
          <p class="truncate text-sm font-medium">{accountPrimaryLine}</p>
          {#if accountSecondaryLine}
            <p class="truncate text-xs font-normal text-muted-foreground">{accountSecondaryLine}</p>
          {/if}
        </div>
      </div>
    </DropdownMenu.Label>

    {#if mediaflowUser}
      <DropdownMenu.Separator />
      <div class="space-y-2 px-2 py-2">
        <div class="flex items-center justify-between gap-3 text-xs">
          <span class="font-medium text-foreground">Monthly credits</span>
          {#if usageStatus === 'loading'}
            <span class="text-muted-foreground">Loading...</span>
          {:else if usageStatus === 'ready'}
            <span class="text-muted-foreground">{Math.round(monthlyUsagePercent)}% used</span>
          {:else}
            <button
              type="button"
              class="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              onclick={() => mediaflowUsageStore.refresh()}
            >
              <RefreshCw class="size-3" />
              Retry
            </button>
          {/if}
        </div>
        <Progress value={monthlyUsagePercent} max={100} class="h-2" />
        <div class="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          {#if usageStatus === 'ready'}
            <span>{monthlyRemaining.toLocaleString()} of {monthlyAllocation.toLocaleString()} left</span>
            <span>{usage?.purchasedBalance.toLocaleString() ?? '0'} extra</span>
          {:else if usageStatus === 'loading'}
            <span>Checking your monthly usage</span>
          {:else}
            <span>Usage unavailable</span>
          {/if}
        </div>
      </div>
    {/if}

    <DropdownMenu.Separator />
    {#if mediaflowUser}
      <DropdownMenu.Item onclick={() => mediaflowAuthUiStore.openDashboard()} disabled={isAccountBusy}>
        <LayoutDashboard class="size-4" />
        <span>Dashboard</span>
      </DropdownMenu.Item>
    {:else if isWaitingForCallback}
      <DropdownMenu.Item onclick={() => mediaflowAuthUiStore.cancelSignIn()}>
        <XCircle class="size-4" />
        <span>Cancel sign-in</span>
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item onclick={() => mediaflowAuthUiStore.startSignIn()} disabled={isAccountBusy}>
        <LogIn class="size-4" />
        {#if effectiveAccountAction === 'opening-browser'}
          <span>Opening browser...</span>
        {:else}
          <span>Sign in</span>
        {/if}
      </DropdownMenu.Item>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item
      onclick={() => mediaflowAuthUiStore.signOut()}
      disabled={!mediaflowUser || isAccountBusy}
      variant="destructive"
    >
      <LogOut class="size-4" />
      {#if effectiveAccountAction === 'signing-out'}
        <span>Signing out...</span>
      {:else}
        <span>Log out</span>
      {/if}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
