<script lang="ts">
  import { FileText, Check, X, Loader2, Download, Copy } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';

  import { translationStore } from '$lib/stores';

  import { toast } from 'svelte-sonner';

  interface TranslationResultPanelProps {
    onSave?: () => void;
  }

  let { onSave }: TranslationResultPanelProps = $props();

  const hasResult = $derived(translationStore.result !== null);
  const isSuccess = $derived(translationStore.result?.success ?? false);
  const isTranslating = $derived(translationStore.progress.status === 'translating');
  const progressValue = $derived(translationStore.progress.progress);

  async function handleCopyToClipboard() {
    if (translationStore.result?.translatedContent) {
      try {
        await navigator.clipboard.writeText(translationStore.result.translatedContent);
        toast.success('Copied to clipboard');
      } catch {
        toast.error('Failed to copy to clipboard');
      }
    }
  }
</script>

<Card.Root class="flex-1 flex flex-col min-h-0">
  <Card.Header>
    <div class="flex items-center gap-2">
      <FileText class="size-5 text-primary" />
      <Card.Title>Translation Result</Card.Title>
    </div>
    <Card.Description>
      Preview and export translated subtitles
    </Card.Description>
  </Card.Header>
  <Card.Content class="flex-1 flex flex-col min-h-0">
    {#if isTranslating}
      <!-- Progress state -->
      <div class="flex-1 flex flex-col items-center justify-center gap-4">
        <Loader2 class="size-8 text-primary animate-spin" />
        <div class="text-center">
          <p class="font-medium">Translating...</p>
          <p class="text-sm text-muted-foreground mt-1">
            This may take a few moments
          </p>
        </div>
        <Progress value={progressValue} class="w-full max-w-xs" />
        <p class="text-sm text-muted-foreground">{progressValue}%</p>
      </div>
    {:else if hasResult}
      {#if isSuccess}
        <!-- Success state -->
        <div class="flex items-center gap-2 mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <Check class="size-4 text-green-500" />
          <span class="text-sm font-medium text-green-600 dark:text-green-400">Translation completed</span>
        </div>

        <!-- Preview -->
        <div class="flex-1 border rounded-lg overflow-auto">
          <pre class="p-4 text-sm whitespace-pre-wrap font-mono">{translationStore.result?.translatedContent}</pre>
        </div>

        <!-- Actions -->
        <div class="flex gap-2 mt-4">
          <Button variant="outline" class="flex-1" onclick={handleCopyToClipboard}>
            <Copy class="size-4 mr-2" />
            Copy
          </Button>
          <Button class="flex-1" onclick={() => onSave?.()}>
            <Download class="size-4 mr-2" />
            Save File
          </Button>
        </div>
      {:else}
        <!-- Error state -->
        <div class="flex-1 flex flex-col items-center justify-center gap-4">
          <div class="p-4 rounded-full bg-destructive/10">
            <X class="size-8 text-destructive" />
          </div>
          <div class="text-center">
            <p class="font-medium text-destructive">Translation failed</p>
            <p class="text-sm text-muted-foreground mt-2 max-w-md">
              {translationStore.result?.error || 'An unknown error occurred'}
            </p>
          </div>
          <Button variant="outline" onclick={() => translationStore.clearResult()}>
            Try Again
          </Button>
        </div>
      {/if}
    {:else}
      <!-- Empty state -->
      <div class="flex-1 flex flex-col items-center justify-center text-center">
        <div class="p-4 rounded-full bg-muted mb-4">
          <FileText class="size-8 text-muted-foreground" />
        </div>
        <p class="text-muted-foreground">
          Translation results will appear here
        </p>
      </div>
    {/if}
  </Card.Content>
</Card.Root>
