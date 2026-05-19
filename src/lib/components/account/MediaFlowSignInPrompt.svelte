<script lang="ts">
  import { Loader2, LogIn, XCircle } from '@lucide/svelte';

  import { Button } from '$lib/components/ui/button';
  import * as Item from '$lib/components/ui/item';
  import { mediaflowAuthUiStore } from '$lib/stores';

  interface MediaFlowSignInPromptProps {
    title: string;
    description: string;
    class?: string;
  }

  let {
    title,
    description,
    class: className = '',
  }: MediaFlowSignInPromptProps = $props();

  const authAction = $derived(mediaflowAuthUiStore.action);
  const isBusy = $derived(mediaflowAuthUiStore.isBusy);
  const isWaitingForCallback = $derived(mediaflowAuthUiStore.isWaitingForCallback);
  const buttonLabel = $derived(mediaflowAuthUiStore.buttonLabel);
  const statusMessage = $derived(mediaflowAuthUiStore.statusMessage);
</script>

<Item.Root
  variant="outline"
  size="sm"
  class={['border-primary/20 bg-primary/5 text-foreground', className]}
>
  <Item.Media
    variant="icon"
    class="text-primary"
  >
    {#if authAction === 'opening-browser' || authAction === 'signing-out'}
      <Loader2 class="size-4 animate-spin" />
    {:else}
      <LogIn class="size-4" />
    {/if}
  </Item.Media>

  <Item.Content class="min-w-0">
    <Item.Title class="w-full line-clamp-none">{title}</Item.Title>
    <Item.Description class="line-clamp-none">{description}</Item.Description>
    {#if isBusy}
      <Item.Description class="line-clamp-none text-xs">{statusMessage}</Item.Description>
    {/if}
  </Item.Content>

  <Item.Actions class="w-full justify-start pl-11">
    {#if isWaitingForCallback}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onclick={() => mediaflowAuthUiStore.cancelSignIn()}
      >
        <XCircle class="size-4" />
        Cancel sign-in
      </Button>
    {:else}
      <Button
        type="button"
        size="sm"
        disabled={isBusy}
        onclick={() => mediaflowAuthUiStore.startSignIn()}
      >
        {#if authAction === 'opening-browser' || authAction === 'signing-out'}
          <Loader2 class="size-4 animate-spin" />
        {:else}
          <LogIn class="size-4" />
        {/if}
        {buttonLabel}
      </Button>
    {/if}
  </Item.Actions>
</Item.Root>
