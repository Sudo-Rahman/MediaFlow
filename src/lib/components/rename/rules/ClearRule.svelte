<script lang="ts">
  import type { ClearConfig } from '$lib/types/rename';
  import AlertTriangle from 'lucide-svelte/icons/alert-triangle';

  interface ClearRuleProps {
    config: ClearConfig;
    onUpdate: (config: ClearConfig) => void;
  }

  let { config: _config, onUpdate: _onUpdate }: ClearRuleProps = $props();
</script>

<div class="space-y-3">
  <div class="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
    <AlertTriangle class="size-4 shrink-0 mt-0.5" />
    <div class="text-sm">
      <p class="font-medium">This rule removes the entire filename</p>
      <p class="text-xs opacity-80 mt-1">
        Use this with other rules (like Numbering or Timestamp) to build a completely new name.
      </p>
    </div>
  </div>
</div>
