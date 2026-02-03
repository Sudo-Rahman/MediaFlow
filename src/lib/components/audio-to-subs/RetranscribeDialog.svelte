<script lang="ts">
  import type { AudioFile, DeepgramConfig } from '$lib/types';
  import { DEFAULT_DEEPGRAM_CONFIG } from '$lib/types';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Separator } from '$lib/components/ui/separator';
  import ModelSelector from './ModelSelector.svelte';
  import LanguageSelector from './LanguageSelector.svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import RotateCw from 'lucide-svelte/icons/rotate-cw';
  import Settings2 from 'lucide-svelte/icons/settings-2';
  import Users from 'lucide-svelte/icons/users';

  interface RetranscribeDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: AudioFile | null;
    onConfirm: (fileId: string, versionName: string, config: DeepgramConfig) => void;
  }

  let { 
    open = $bindable(false), 
    onOpenChange,
    file,
    onConfirm
  }: RetranscribeDialogProps = $props();

  // Local state for the form
  let versionName = $state('');
  let config = $state<DeepgramConfig>({ ...DEFAULT_DEEPGRAM_CONFIG });

  // Reset form when dialog opens
  $effect(() => {
    if (open && file) {
      const versionCount = file.transcriptionVersions?.length ?? 0;
      versionName = `Version ${versionCount + 1}`;
      config = { ...DEFAULT_DEEPGRAM_CONFIG };
    }
  });

  function handleConfirm() {
    if (!file) return;
    onConfirm(file.id, versionName.trim() || 'New version', config);
    onOpenChange(false);
  }
</script>

<Dialog.Root bind:open onOpenChange={onOpenChange}>
  <Dialog.Content class="max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <RotateCw class="size-5" />
        New Transcription
      </Dialog.Title>
      <Dialog.Description>
        Create a new transcription version for {file?.name ?? 'this file'}
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex-1 overflow-auto p-4 space-y-6">
      <!-- Version name -->
      <div class="space-y-2">
        <Label>Version name</Label>
        <Input 
          bind:value={versionName}
          placeholder="Version 1"
        />
      </div>

      <Separator />

      <!-- Model selection -->
      <ModelSelector
        value={config.model}
        onValueChange={(model) => config = { ...config, model }}
      />

      <!-- Language selection -->
      <LanguageSelector
        value={config.language}
        onValueChange={(language) => config = { ...config, language }}
      />

      <Separator />

      <!-- Deepgram options -->
      <div class="space-y-4">
        <h4 class="text-sm font-medium flex items-center gap-2">
          <Settings2 class="size-4" />
          Options
        </h4>

        <!-- Punctuation -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Auto Punctuation</Label>
            <p class="text-xs text-muted-foreground">Add punctuation</p>
          </div>
          <Switch
            checked={config.punctuate}
            onCheckedChange={(checked) => config = { ...config, punctuate: checked }}
          />
        </div>

        <!-- Smart Format -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Smart Format</Label>
            <p class="text-xs text-muted-foreground">Format numbers, dates, currencies</p>
          </div>
          <Switch
            checked={config.smartFormat}
            onCheckedChange={(checked) => config = { ...config, smartFormat: checked }}
          />
        </div>

        <!-- Paragraphs -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm">Paragraphs</Label>
            <p class="text-xs text-muted-foreground">Detect paragraphs</p>
          </div>
          <Switch
            checked={config.paragraphs}
            onCheckedChange={(checked) => config = { ...config, paragraphs: checked }}
          />
        </div>

        <Separator />

        <!-- Diarization -->
        <div class="flex items-center justify-between">
          <div class="space-y-0.5">
            <Label class="text-sm flex items-center gap-2">
              <Users class="size-4" />
              Diarization
            </Label>
            <p class="text-xs text-muted-foreground">Identify speakers</p>
          </div>
          <Switch
            checked={config.diarize}
            onCheckedChange={(checked) => config = { ...config, diarize: checked }}
          />
        </div>

        <Separator />

        <!-- Utterance Split -->
        <div class="space-y-3">
          <div class="space-y-0.5">
            <Label class="text-sm">Pause Threshold</Label>
            <p class="text-xs text-muted-foreground">
              Silence duration to split phrases ({config.uttSplit.toFixed(1)}s)
            </p>
          </div>
          <Slider
            type="multiple"
            value={[config.uttSplit]}
            onValueChange={(values: number[]) => config = { ...config, uttSplit: values[0] }}
            min={0.1}
            max={2.0}
            step={0.1}
          />
          <div class="flex justify-between text-xs text-muted-foreground">
            <span>0.1s</span>
            <span>2.0s</span>
          </div>
        </div>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button onclick={handleConfirm}>
        <RotateCw class="size-4 mr-2" />
        Transcribe
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
