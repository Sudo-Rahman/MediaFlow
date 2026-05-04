<script lang="ts">
  import { toast } from 'svelte-sonner';
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

  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { Progress } from '$lib/components/ui/progress';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { mediaflowUsageStore, settingsStore } from '$lib/stores';
  import {
    cancelPendingMediaFlowSignIn,
    openMediaFlowDashboard,
    signInWithMediaFlow,
    signOutMediaFlow,
  } from '$lib/services/mediaflow-auth';

  type AccountAction = 'idle' | 'opening-browser' | 'waiting-callback' | 'signing-out';

  let accountAction = $state<AccountAction>('idle');
  let isOpen = $state(false);

  const mediaflowUser = $derived(settingsStore.settings.mediaflowUser);
  const usage = $derived(mediaflowUsageStore.usage);
  const usageStatus = $derived(mediaflowUsageStore.status);
  const effectiveAccountAction = $derived(
    mediaflowUser && (accountAction === 'opening-browser' || accountAction === 'waiting-callback')
      ? 'idle'
      : accountAction
  );
  const isAccountBusy = $derived(effectiveAccountAction !== 'idle');
  const isWaitingForCallback = $derived(effectiveAccountAction === 'waiting-callback');
  const accountDisplayName = $derived(
    mediaflowUser?.name ||
      mediaflowUser?.email ||
      (isWaitingForCallback ? 'Waiting for browser' : 'MediaFlow Account')
  );
  const accountEmail = $derived.by(() => {
    if (effectiveAccountAction === 'opening-browser') return 'Opening sign-in page...';
    if (effectiveAccountAction === 'waiting-callback') return 'Complete sign-in in your browser';
    if (effectiveAccountAction === 'signing-out') return 'Signing out...';
    return mediaflowUser?.email || 'Sign in to continue';
  });
  const accountButtonLabel = $derived.by(() => {
    if (effectiveAccountAction === 'opening-browser') return 'Opening...';
    if (effectiveAccountAction === 'waiting-callback') return 'Waiting...';
    if (effectiveAccountAction === 'signing-out') return 'Signing out...';
    return 'Account';
  });
  const accountInitials = $derived.by(() => {
    const source = mediaflowUser?.name || mediaflowUser?.email || 'MF';
    const parts = source.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  });
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

  async function handleOpenDashboard(): Promise<void> {
    try {
      await openMediaFlowDashboard();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    }
  }

  async function handleSignIn(): Promise<void> {
    if (isAccountBusy) return;

    accountAction = 'opening-browser';
    try {
      await signInWithMediaFlow();
      accountAction = 'waiting-callback';
      toast.info('Complete sign-in in your browser');
    } catch (error) {
      accountAction = 'idle';
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    }
  }

  async function handleSignOut(): Promise<void> {
    if (!mediaflowUser || isAccountBusy) return;

    accountAction = 'signing-out';
    try {
      await signOutMediaFlow();
      toast.success('Signed out from MediaFlow');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      accountAction = 'idle';
    }
  }

  function handleCancelSignIn(): void {
    cancelPendingMediaFlowSignIn();
    accountAction = 'idle';
    toast.info('MediaFlow sign-in cancelled');
  }
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
        <div class={['flex size-8 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium transition-colors', isAccountBusy && 'border-primary/40 bg-primary/10 text-primary']}>
          {#if mediaflowUser}
            {accountInitials}
          {:else}
            <UserRound class="size-4 text-muted-foreground" />
          {/if}
        </div>
        <div class="min-w-0 leading-tight">
          <p class="truncate text-sm font-medium">{accountDisplayName}</p>
          <p class="truncate text-xs font-normal text-muted-foreground">{accountEmail}</p>
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
      <DropdownMenu.Item onclick={handleOpenDashboard} disabled={isAccountBusy}>
        <LayoutDashboard class="size-4" />
        <span>Dashboard</span>
      </DropdownMenu.Item>
    {:else if isWaitingForCallback}
      <DropdownMenu.Item onclick={handleCancelSignIn}>
        <XCircle class="size-4" />
        <span>Cancel sign-in</span>
      </DropdownMenu.Item>
    {:else}
      <DropdownMenu.Item onclick={handleSignIn} disabled={isAccountBusy}>
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
      onclick={handleSignOut}
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
