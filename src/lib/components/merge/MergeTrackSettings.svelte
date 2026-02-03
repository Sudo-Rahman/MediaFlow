<script lang="ts">
  import type { MergeTrack, MergeTrackConfig } from '$lib/types';
  import { COMMON_LANGUAGES } from '$lib/types';
  import { formatLanguage } from '$lib/utils/format';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Separator } from '$lib/components/ui/separator';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Video, Volume2, Subtitles, Clock, Languages } from '@lucide/svelte';

  interface MergeTrackSettingsProps {
    open: boolean;
    track: MergeTrack | null;
    config: MergeTrackConfig | null;
    onClose: () => void;
    onSave: (updates: Partial<MergeTrackConfig>) => void;
  }

  let {
    open = $bindable(),
    track,
    config,
    onClose,
    onSave
  }: MergeTrackSettingsProps = $props();

  let localConfig = $state<Partial<MergeTrackConfig>>({});

  $effect(() => {
    if (open && config) {
      localConfig = { ...config };
    }
  });

  const typeIcons = {
    video: Video,
    audio: Volume2,
    subtitle: Subtitles,
  };

  function handleSave() {
    onSave(localConfig);
    onClose();
  }

  function handleDelayChange(value: string) {
    const num = parseInt(value, 10);
    localConfig.delayMs = isNaN(num) ? 0 : num;
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onClose();
    }
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg max-h-[90vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        {#if track}
          {@const Icon = typeIcons[track.type as keyof typeof typeIcons]}
          {#if Icon}
            <Icon class="size-5" />
          {/if}
          Track Settings #{track.originalIndex}
        {:else}
          Track Settings
        {/if}
      </Dialog.Title>
      <Dialog.Description>
        Configure the properties of this track for the output file.
      </Dialog.Description>
    </Dialog.Header>

    {#if track && config}
      <div class="space-y-4 py-4">
        <div class="rounded-md bg-muted/50 p-3 text-sm">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium">{track.codec.toUpperCase()}</span>
            {#if track.type === 'video' && track.width && track.height}
              <span class="text-muted-foreground">• {track.width}x{track.height}</span>
            {/if}
            {#if track.type === 'audio' && track.channels}
              <span class="text-muted-foreground">• {track.channels}ch</span>
            {/if}
          </div>
        </div>

        <Separator />

        <div class="space-y-2">
          <Label for="track-title">Title</Label>
          <Input
            id="track-title"
            placeholder="Track title (optional)"
            value={localConfig.title || ''}
            oninput={(e) => localConfig.title = e.currentTarget.value}
          />
        </div>

        <div class="space-y-2">
          <Label>Language</Label>
          <Select.Root
            type="single"
            value={localConfig.language || 'und'}
            onValueChange={(value) => localConfig.language = value}
          >
            <Select.Trigger class="w-full">
              <Languages class="size-4 mr-2" />
              <span>{formatLanguage(localConfig.language || 'und')}</span>
            </Select.Trigger>
            <Select.Content>
              {#each COMMON_LANGUAGES as lang}
                <Select.Item value={lang.code}>{lang.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <div class="space-y-2">
          <Label for="track-delay" class="flex items-center gap-2">
            <Clock class="size-4" />
            Delay (ms)
          </Label>
          <div class="flex items-center gap-2">
            <Input
              id="track-delay"
              type="number"
              placeholder="0"
              value={localConfig.delayMs?.toString() || '0'}
              oninput={(e) => handleDelayChange(e.currentTarget.value)}
              class="w-32"
            />
            <span class="text-sm text-muted-foreground">milliseconds</span>
          </div>
          <p class="text-xs text-muted-foreground">
            Positive value = delay track, negative = advance
          </p>
        </div>

        <Separator />

        <div class="space-y-3">
          <Label>Options</Label>

          <div class="flex items-center gap-3">
            <Checkbox
              id="track-default"
              checked={localConfig.default || false}
              onCheckedChange={(checked) => localConfig.default = !!checked}
            />
            <Label for="track-default" class="font-normal cursor-pointer">
              Default track
            </Label>
          </div>

          {#if track.type === 'subtitle'}
            <div class="flex items-center gap-3">
              <Checkbox
                id="track-forced"
                checked={localConfig.forced || false}
                onCheckedChange={(checked) => localConfig.forced = !!checked}
              />
              <Label for="track-forced" class="font-normal cursor-pointer">
                Forced subtitles
              </Label>
            </div>
          {/if}
        </div>
      </div>

      <Dialog.Footer>
        <Button variant="outline" onclick={onClose}>
          Cancel
        </Button>
        <Button onclick={handleSave}>
          Apply
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>

