<script lang="ts">
  import type { MergeOutputConfig } from '$lib/types';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Progress } from '$lib/components/ui/progress';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import * as Alert from '$lib/components/ui/alert';
  import Folder from 'lucide-svelte/icons/folder';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import Play from 'lucide-svelte/icons/play';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import AlertCircle from 'lucide-svelte/icons/alert-circle';
  import FileVideo from 'lucide-svelte/icons/file-video';

  interface MergeOutputPanelProps {
    outputConfig: MergeOutputConfig;
    enabledTracksCount: number;
    status: 'idle' | 'processing' | 'completed' | 'error';
    progress: number;
    error: string | null;
    onSelectOutputDir?: () => void;
    onOutputNameChange?: (name: string) => void;
    onMerge?: () => void;
    onOpenFolder?: () => void;
    class?: string;
  }

  let {
    outputConfig,
    enabledTracksCount,
    status,
    progress,
    error,
    onSelectOutputDir,
    onOutputNameChange,
    onMerge,
    onOpenFolder,
    class: className = ''
  }: MergeOutputPanelProps = $props();

  const isProcessing = $derived(status === 'processing');
  const isCompleted = $derived(status === 'completed');
  const canMerge = $derived(
    enabledTracksCount > 0 &&
    outputConfig.outputPath &&
    outputConfig.outputName &&
    !isProcessing
  );
</script>

<Card.Root class={className}>
  <Card.Header class="pb-3">
    <Card.Title class="text-base">Fichier de sortie</Card.Title>
    <Card.Description>Configurez le fichier MKV de sortie</Card.Description>
  </Card.Header>
  <Card.Content class="space-y-4">
    <div class="space-y-2">
      <Label>Dossier de destination</Label>
      <div class="flex gap-2">
        <div class="flex-1 flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm min-w-0">
          <Folder class="size-4 text-muted-foreground shrink-0" />
          <span class="truncate text-muted-foreground">
            {outputConfig.outputPath || 'Aucun dossier sélectionné'}
          </span>
        </div>
        <Button variant="outline" size="icon" onclick={onSelectOutputDir}>
          <FolderOpen class="size-4" />
          <span class="sr-only">Parcourir</span>
        </Button>
      </div>
    </div>

    <div class="space-y-2">
      <Label for="output-name">Nom du fichier</Label>
      <div class="flex items-center gap-2">
        <FileVideo class="size-4 text-muted-foreground shrink-0" />
        <Input
          id="output-name"
          placeholder="nom_fichier"
          value={outputConfig.outputName}
          oninput={(e) => onOutputNameChange?.(e.currentTarget.value)}
          class="flex-1"
        />
        <span class="text-sm text-muted-foreground">.mkv</span>
      </div>
    </div>

    <div class="rounded-md bg-muted/50 p-3 text-sm flex items-center justify-between">
      <span>Pistes à inclure</span>
      <Badge variant={enabledTracksCount > 0 ? 'default' : 'secondary'}>
        {enabledTracksCount}
      </Badge>
    </div>

    {#if isProcessing || isCompleted}
      <div class="space-y-3">
        {#if isCompleted}
          <Alert.Root class="border-green-500/50 bg-green-500/10">
            <CheckCircle class="size-4 text-green-500" />
            <Alert.Title>Merge terminé !</Alert.Title>
            <Alert.Description>
              Le fichier a été créé avec succès.
            </Alert.Description>
          </Alert.Root>
        {:else}
          <div class="space-y-2">
            <div class="flex justify-between text-sm">
              <span class="text-muted-foreground">Merge en cours...</span>
              <span class="font-medium">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
          </div>
        {/if}
      </div>
    {/if}

    {#if error}
      <Alert.Root variant="destructive">
        <AlertCircle class="size-4" />
        <Alert.Title>Erreur</Alert.Title>
        <Alert.Description>{error}</Alert.Description>
      </Alert.Root>
    {/if}
  </Card.Content>
  <Card.Footer>
    {#if isCompleted}
      <Button class="w-full" onclick={onOpenFolder}>
        <FolderOpen class="size-4 mr-2" />
        Ouvrir le dossier
      </Button>
    {:else}
      <Button
        class="w-full"
        onclick={onMerge}
        disabled={!canMerge}
      >
        {#if isProcessing}
          <Loader2 class="size-4 mr-2 animate-spin" />
          Merge en cours...
        {:else}
          <Play class="size-4 mr-2" />
          Lancer le merge
        {/if}
      </Button>
    {/if}
  </Card.Footer>
</Card.Root>

