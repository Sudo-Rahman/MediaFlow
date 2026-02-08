<script lang="ts">
  import { Sun, Moon } from '@lucide/svelte';
  import { toggleMode, mode } from 'mode-watcher';
  import { Button } from '$lib/components/ui/button';
</script>

<Button variant="ghost" size="icon" onclick={toggleMode}>
  {#if mode.current === 'dark'}
    <Sun class="size-5" />
    <span class="sr-only">Switch to light mode</span>
  {:else}
    <Moon class="size-5" />
    <span class="sr-only">Switch to dark mode</span>
  {/if}
</Button>

