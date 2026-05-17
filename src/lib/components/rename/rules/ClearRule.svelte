<script lang="ts">
  import { AlertTriangle } from '@lucide/svelte';
  import type { ClearConfig } from '$lib/types/rename';
  import * as Alert from '$lib/components/ui/alert';

  interface ClearRuleProps {
    config: ClearConfig;
    onUpdate: (config: ClearConfig) => void;
  }

  let { config: _config, onUpdate: _onUpdate }: ClearRuleProps = $props();
</script>

<div class="space-y-3">
  <Alert.Root variant="destructive" role="note" aria-live="off">
    <AlertTriangle class="size-4 shrink-0 mt-0.5" />
    <Alert.Title>This rule removes the entire filename</Alert.Title>
    <Alert.Description>
      Use this with other rules (like Numbering or Timestamp) to build a completely new name.
    </Alert.Description>
  </Alert.Root>
</div>
