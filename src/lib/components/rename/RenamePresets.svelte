<script lang="ts">
  import { FolderOpen, Save, CopyPlus, Star, Trash2, ChevronDown, Check } from '@lucide/svelte';
  import type { RulePreset } from '$lib/types/rename';
  import type { RenameWorkspaceStore } from '$lib/stores/rename.svelte';
  import { toast } from 'svelte-sonner';

  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';


  interface RenamePresetsProps {
    workspace: RenameWorkspaceStore;
    class?: string;
  }

  let {
    workspace,
    class: className = '',
  }: RenamePresetsProps = $props();

  // Dialog states
  let saveDialogOpen = $state(false);
  let deleteDialogOpen = $state(false);
  let presetToDelete = $state<RulePreset | null>(null);
  
  // Form state
  let presetName = $state('');
  let presetDescription = $state('');
  let isSaving = $state(false);

  // Load presets on mount
  $effect(() => {
    workspace.loadPresets();
  });

  const presets = $derived(workspace.presets);
  const builtInPresets = $derived(presets.filter(p => p.isBuiltIn));
  const userPresets = $derived(presets.filter(p => !p.isBuiltIn));
  const hasRules = $derived(workspace.rules.length > 0);
  const activePreset = $derived(workspace.activePreset);

  async function handleSaveAsPreset() {
    if (!presetName.trim()) {
      toast.error('Please enter a preset name');
      return;
    }

    isSaving = true;
    try {
      const result = await workspace.saveAsPreset(presetName.trim(), presetDescription.trim());
      if (result) {
        toast.success(`Preset "${result.name}" saved`);
        saveDialogOpen = false;
        presetName = '';
        presetDescription = '';
      } else {
        toast.error('Failed to save preset');
      }
    } catch (error) {
      console.error('Save preset error:', error);
      toast.error('Failed to save preset');
    } finally {
      isSaving = false;
    }
  }

  async function handleSaveCurrentPreset() {
    if (!activePreset || activePreset.isBuiltIn) {
      openSaveDialog();
      return;
    }

    isSaving = true;
    try {
      const result = await workspace.saveActivePreset();
      if (result) {
        toast.success(`Preset "${result.name}" updated`);
      } else {
        toast.error('Failed to save preset');
      }
    } catch (error) {
      console.error('Save preset error:', error);
      toast.error('Failed to save preset');
    } finally {
      isSaving = false;
    }
  }

  function handleLoadPreset(preset: RulePreset) {
    workspace.applyPreset(preset.id);
    toast.success(`Loaded "${preset.name}"`);
  }

  function handleDeleteClick(preset: RulePreset) {
    presetToDelete = preset;
    deleteDialogOpen = true;
  }

  async function confirmDelete() {
    if (!presetToDelete) return;
    
    const success = await workspace.deletePreset(presetToDelete.id);
    if (success) {
      toast.success(`Deleted "${presetToDelete.name}"`);
    } else {
      toast.error('Failed to delete preset');
    }
    
    deleteDialogOpen = false;
    presetToDelete = null;
  }

  function openSaveDialog() {
    presetName = '';
    presetDescription = '';
    saveDialogOpen = true;
  }
</script>

<div class="flex items-center gap-1 {className}">
  <!-- Load Preset Dropdown -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button variant="outline" size="sm" {...props}>
          <FolderOpen class="size-4 mr-1.5" />
          Presets
          <ChevronDown class="size-3 ml-1" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="start" class="w-64">
      <DropdownMenu.Label>Built-in Presets</DropdownMenu.Label>
      {#each builtInPresets as preset (preset.id)}
        <DropdownMenu.Item onclick={() => handleLoadPreset(preset)}>
          <Star class="size-4 mr-2 text-yellow-500" />
          <div class="flex-1 min-w-0">
            <p class="truncate">{preset.name}</p>
            <p class="text-xs text-muted-foreground truncate">{preset.description}</p>
          </div>
          {#if activePreset?.id === preset.id}
            <Check class="size-4 ml-2" />
          {/if}
        </DropdownMenu.Item>
      {/each}

      {#if userPresets.length > 0}
        <DropdownMenu.Separator />
        <DropdownMenu.Label>My Presets</DropdownMenu.Label>
        {#each userPresets as preset (preset.id)}
          <DropdownMenu.Item class="group" onclick={() => handleLoadPreset(preset)}>
            <div class="flex-1 min-w-0">
              <p class="truncate">{preset.name}</p>
              {#if preset.description}
                <p class="text-xs text-muted-foreground truncate">{preset.description}</p>
              {/if}
            </div>
            {#if activePreset?.id === preset.id}
              <Check class="size-4 ml-2" />
            {/if}
            <button
              class="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-opacity"
              onclick={(e) => {
                e.stopPropagation();
                handleDeleteClick(preset);
              }}
            >
              <Trash2 class="size-3.5" />
            </button>
          </DropdownMenu.Item>
        {/each}
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <!-- Save Preset Buttons -->
  <Button 
    variant="outline" 
    size="sm" 
    disabled={!hasRules || isSaving}
    onclick={handleSaveCurrentPreset}
    title={activePreset && !activePreset.isBuiltIn ? `Save "${activePreset.name}"` : 'Save as a new preset'}
  >
    <Save class="size-4 mr-1.5" />
    Save
  </Button>
  <Button
    variant="outline"
    size="sm"
    disabled={!hasRules || isSaving}
    onclick={openSaveDialog}
  >
    <CopyPlus class="size-4 mr-1.5" />
    Save As
  </Button>
</div>

<!-- Save Preset Dialog -->
<Dialog.Root bind:open={saveDialogOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>Save Preset As</Dialog.Title>
      <Dialog.Description>
        Save your current rules as a new reusable preset.
      </Dialog.Description>
    </Dialog.Header>
    
    <div class="space-y-4 py-4">
      <div class="space-y-2">
        <Label for="preset-name">Name</Label>
        <Input
          id="preset-name"
          bind:value={presetName}
          placeholder="My Preset"
        />
      </div>
      
      <div class="space-y-2">
        <Label for="preset-description">Description (optional)</Label>
        <Textarea
          id="preset-description"
          bind:value={presetDescription}
          placeholder="What does this preset do?"
          rows={2}
        />
      </div>
      
      <div class="text-sm text-muted-foreground">
        {workspace.rules.length} rule{workspace.rules.length !== 1 ? 's' : ''} will be saved
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => saveDialogOpen = false}>
        Cancel
      </Button>
      <Button onclick={handleSaveAsPreset} disabled={isSaving}>
        {#if isSaving}
          Saving...
        {:else}
          <Check class="size-4 mr-1.5" />
          Save Preset
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete Confirmation Dialog -->
<AlertDialog.Root bind:open={deleteDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete Preset?</AlertDialog.Title>
      <AlertDialog.Description>
        Are you sure you want to delete "{presetToDelete?.name}"? This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action onclick={confirmDelete} class="bg-destructive text-white hover:bg-destructive/90">
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
