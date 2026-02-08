<script lang="ts">
  import { Video, Volume2, Subtitles, Clock, Languages, Save, Bookmark } from '@lucide/svelte';
  import type { TrackGroup, MergeTrackConfig } from '$lib/types';
  import { COMMON_LANGUAGES } from '$lib/types';
  import { mergeStore } from '$lib/stores/merge.svelte';
  import { formatLanguage } from '$lib/utils/format';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Separator } from '$lib/components/ui/separator';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import * as Tabs from '$lib/components/ui/tabs';

  interface MergeGroupEditorProps {
    open: boolean;
    group: TrackGroup | null;
    onClose: () => void;
  }

  let { open = $bindable(), group, onClose }: MergeGroupEditorProps = $props();

  let activeTab = $state('edit');
  let presetName = $state('');

  // Local config state
  let localConfig = $state<Partial<MergeTrackConfig>>({});

  // Get tracks in the group
  const tracks = $derived(
    group?.trackIds
      .map((id: string) => mergeStore.getTrackById(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined) ?? []
  );

  // Get consistent values across all tracks
  function getConsistentValue<T>(getter: (config: MergeTrackConfig) => T): T | undefined | 'mixed' {
    const values = tracks
      .map((t: { id: string; sourceFileId?: string; config?: MergeTrackConfig }) => {
        if ('sourceFileId' in t) {
          return mergeStore.getSourceTrackConfig(t.id);
        }
        return t.config;
      })
      .filter((c: MergeTrackConfig | undefined): c is MergeTrackConfig => c !== undefined)
      .map(getter);
    
    if (values.length === 0) return undefined;
    
    const firstValue = values[0];
    const allSame = values.every((v: T) => v === firstValue);
    
    return allSame ? firstValue : 'mixed';
  }

  // Initialize local config when dialog opens
  $effect(() => {
    if (open && group) {
      // Load presets from store when opening
      mergeStore.loadPresets();
      
      const lang = getConsistentValue(c => c.language);
      const title = getConsistentValue(c => c.title);
      const def = getConsistentValue(c => c.default);
      const forced = getConsistentValue(c => c.forced);
      const delay = getConsistentValue(c => c.delayMs);

      localConfig = {
        language: lang === 'mixed' ? undefined : lang,
        title: title === 'mixed' ? undefined : title,
        default: def === 'mixed' ? undefined : def,
        forced: forced === 'mixed' ? undefined : forced,
        delayMs: delay === 'mixed' ? undefined : delay
      };
      presetName = '';
      activeTab = 'edit';
    }
  });

  const typeIcons = {
    video: Video,
    audio: Volume2,
    subtitle: Subtitles,
  };

  const typeLabels: Record<string, string> = {
    video: 'Video',
    audio: 'Audio',
    subtitle: 'Subtitle',
    data: 'Data'
  };

  function handleSave() {
    if (!group) return;
    
    // Filter out undefined values
    const updates: Partial<MergeTrackConfig> = {};
    if (localConfig.language !== undefined) updates.language = localConfig.language;
    if (localConfig.title !== undefined) updates.title = localConfig.title || undefined;
    if (localConfig.default !== undefined) updates.default = localConfig.default;
    if (localConfig.forced !== undefined) updates.forced = localConfig.forced;
    if (localConfig.delayMs !== undefined) updates.delayMs = localConfig.delayMs;

    mergeStore.applyToGroup(group.id, updates);
    onClose();
  }

  function handleSaveAsPreset() {
    if (!group || !presetName.trim()) return;

    mergeStore.savePreset({
      name: presetName.trim(),
      type: group.type,
      language: localConfig.language,
      title: localConfig.title,
      default: localConfig.default,
      forced: localConfig.forced,
      delayMs: localConfig.delayMs
    });

    presetName = '';
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onClose();
    }
  }

  function handleDelayChange(value: string) {
    const num = parseInt(value, 10);
    localConfig.delayMs = isNaN(num) ? 0 : num;
  }

  // Check if subtitle type
  const isSubtitle = $derived(group?.type === 'subtitle');
  
  // Track count
  const trackCount = $derived(tracks.length);
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg max-h-[90vh] overflow-y-auto">
    {#if group}
      <Dialog.Header>
        <Dialog.Title class="flex items-center gap-2">
          {#if group.type === 'video'}
            <Video class="size-5" />
          {:else if group.type === 'audio'}
            <Volume2 class="size-5" />
          {:else}
            <Subtitles class="size-5" />
          {/if}
          Edit Group
        </Dialog.Title>
        <Dialog.Description>
          {typeLabels[group.type]}s • {group.language ? formatLanguage(group.language) : 'Undefined'} • {trackCount} track{trackCount > 1 ? 's' : ''}
        </Dialog.Description>
      </Dialog.Header>

      <Tabs.Root value={activeTab} onValueChange={(v) => activeTab = v} class="mt-4">
        <Tabs.List class="grid w-full grid-cols-2">
          <Tabs.Trigger value="edit">Edit</Tabs.Trigger>
          <Tabs.Trigger value="preset">Presets</Tabs.Trigger>
        </Tabs.List>

        <!-- Edit Tab -->
        <Tabs.Content value="edit" class="space-y-4 mt-4">
          <div class="space-y-2">
            <Label for="group-title">Title</Label>
            <Input
              id="group-title"
              placeholder="Track title (leave empty for unchanged)"
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
            <Label for="group-delay" class="flex items-center gap-2">
              <Clock class="size-4" />
              Delay (ms)
            </Label>
            <div class="flex items-center gap-2">
              <Input
                id="group-delay"
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
                id="group-default"
                checked={localConfig.default || false}
                onCheckedChange={(checked) => localConfig.default = !!checked}
              />
              <Label for="group-default" class="font-normal cursor-pointer">
                Default track
              </Label>
            </div>

            {#if isSubtitle}
              <div class="flex items-center gap-3">
                <Checkbox
                  id="group-forced"
                  checked={localConfig.forced || false}
                  onCheckedChange={(checked) => localConfig.forced = !!checked}
                />
                <Label for="group-forced" class="font-normal cursor-pointer">
                  Forced subtitles
                </Label>
              </div>
            {/if}
          </div>

          <Separator />

          <!-- Save as Preset -->
          <div class="space-y-2">
            <Label class="flex items-center gap-2">
              <Save class="size-4" />
              Save as Preset
            </Label>
            <div class="flex gap-2">
              <Input
                placeholder="Preset name..."
                value={presetName}
                oninput={(e) => presetName = e.currentTarget.value}
              />
              <Button
                variant="outline"
                onclick={handleSaveAsPreset}
                disabled={!presetName.trim()}
              >
                Save
              </Button>
            </div>
          </div>
        </Tabs.Content>

        <!-- Preset Tab -->
        <Tabs.Content value="preset" class="space-y-4 mt-4">
          <div class="space-y-2">
            <Label class="flex items-center gap-2">
              <Bookmark class="size-4" />
              Saved Presets
            </Label>
            
            {#if mergeStore.presets.length === 0}
              <p class="text-sm text-muted-foreground py-4 text-center">
                No presets saved
              </p>
            {:else}
              <div class="space-y-2">
                {#each mergeStore.presets.filter(p => p.type === group?.type) as preset}
                  <div class="flex items-center justify-between p-3 rounded-md border hover:bg-muted/50">
                    <div class="flex-1 min-w-0">
                      <p class="font-medium truncate">{preset.name}</p>
                      <p class="text-xs text-muted-foreground">
                        {preset.language ? formatLanguage(preset.language) : 'Language undefined'}
                        {#if preset.default}• Default{/if}
                        {#if preset.forced}• Forced{/if}
                      </p>
                    </div>
                    
                    <div class="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => {
                          localConfig = {
                            language: preset.language,
                            title: preset.title,
                            default: preset.default,
                            forced: preset.forced,
                            delayMs: preset.delayMs
                          };
                          activeTab = 'edit';
                        }}
                      >
                        Load
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => mergeStore.deletePreset(preset.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </Tabs.Content>
      </Tabs.Root>

      <Dialog.Footer class="mt-6">
        <Button variant="outline" onclick={onClose}>
          Cancel
        </Button>
        <Button onclick={handleSave}>
          Apply to {trackCount} tracks
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
