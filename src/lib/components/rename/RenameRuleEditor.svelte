<script lang="ts">
  import { cn } from '$lib/utils';
  import type { RenameRule, RuleType, RuleConfig } from '$lib/types/rename';
  import { RULE_TYPE_LABELS, RULE_TYPE_DESCRIPTIONS } from '$lib/types/rename';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import RenameRuleCard from './RenameRuleCard.svelte';
  import RenamePresets from './RenamePresets.svelte';
  import PrefixRule from './rules/PrefixRule.svelte';
  import SuffixRule from './rules/SuffixRule.svelte';
  import ReplaceRule from './rules/ReplaceRule.svelte';
  import RegexRule from './rules/RegexRule.svelte';
  import RemoveRule from './rules/RemoveRule.svelte';
  import CaseRule from './rules/CaseRule.svelte';
  import NumberRule from './rules/NumberRule.svelte';
  import MoveRule from './rules/MoveRule.svelte';
  import TimestampRule from './rules/TimestampRule.svelte';
  import ClearRule from './rules/ClearRule.svelte';
  import TextRule from './rules/TextRule.svelte';
  import { dndzone, type DndEvent } from 'svelte-dnd-action';
  import { flip } from 'svelte/animate';
  
  import Plus from 'lucide-svelte/icons/plus';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import TextCursorInput from 'lucide-svelte/icons/text-cursor-input';
  import Type from 'lucide-svelte/icons/type';
  import Replace from 'lucide-svelte/icons/replace';
  import Regex from 'lucide-svelte/icons/regex';
  import Eraser from 'lucide-svelte/icons/eraser';
  import CaseSensitive from 'lucide-svelte/icons/case-sensitive';
  import Hash from 'lucide-svelte/icons/hash';
  import MoveHorizontal from 'lucide-svelte/icons/move-horizontal';
  import Clock from 'lucide-svelte/icons/clock';
  import CircleOff from 'lucide-svelte/icons/circle-off';
  import Text from 'lucide-svelte/icons/text';

  interface RenameRuleEditorProps {
    rules: RenameRule[];
    onAddRule: (type: RuleType) => void;
    onRemoveRule: (id: string) => void;
    onToggleRule: (id: string) => void;
    onDuplicateRule: (id: string) => void;
    onUpdateRuleConfig: (id: string, config: RuleConfig) => void;
    onReorderRules: (rules: RenameRule[]) => void;
    onClearRules: () => void;
    class?: string;
  }

  let { 
    rules, 
    onAddRule,
    onRemoveRule,
    onToggleRule,
    onDuplicateRule,
    onUpdateRuleConfig,
    onReorderRules,
    onClearRules,
    class: className = '' 
  }: RenameRuleEditorProps = $props();

  const FLIP_DURATION_MS = 200;

  let editingRuleId = $state<string | null>(null);
  let dialogOpen = $state(false);
  
  // Local copy of rules for drag-and-drop
  // svelte-dnd-action mutates the array, so we need a local copy
  let localRules = $state<RenameRule[]>([]);
  
  // Sync local rules with prop when not dragging
  $effect(() => {
    localRules = [...rules];
  });

  const RULE_ICONS: Record<RuleType, typeof TextCursorInput> = {
    prefix: TextCursorInput,
    suffix: Type,
    replace: Replace,
    regex: Regex,
    remove: Eraser,
    case: CaseSensitive,
    number: Hash,
    move: MoveHorizontal,
    timestamp: Clock,
    clear: CircleOff,
    text: Text,
  };

  const ruleTypes: RuleType[] = [
    'prefix', 'suffix', 'replace', 'regex', 
    'remove', 'case', 'number', 'move', 'timestamp',
    'clear', 'text'
  ];

  function handleEditRule(id: string) {
    editingRuleId = id;
    dialogOpen = true;
  }

  function handleCloseDialog() {
    editingRuleId = null;
    dialogOpen = false;
  }

  function handleDndConsider(e: CustomEvent<DndEvent<RenameRule>>) {
    localRules = e.detail.items;
  }

  function handleDndFinalize(e: CustomEvent<DndEvent<RenameRule>>) {
    localRules = e.detail.items;
    onReorderRules(localRules);
  }

  const editingRule = $derived(rules.find(r => r.id === editingRuleId));
</script>

<div class={cn('flex flex-col h-full', className)}>
  <!-- Header -->
  <div class="flex items-center justify-between p-3 border-b shrink-0">
    <h3 class="font-semibold">Rules ({rules.length})</h3>
    <div class="flex items-center gap-1">
      {#if rules.length > 0}
        <Button
          variant="ghost"
          size="icon-sm"
          onclick={onClearRules}
          class="text-muted-foreground hover:text-destructive"
        >
          <Trash2 class="size-4" />
          <span class="sr-only">Clear all</span>
        </Button>
      {/if}
      
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} size="sm">
              <Plus class="size-4 mr-1" />
              Add
            </Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="w-56">
          <DropdownMenu.Label>Add Rule</DropdownMenu.Label>
          <DropdownMenu.Separator />
          {#each ruleTypes as type}
            {@const Icon = RULE_ICONS[type]}
            <DropdownMenu.Item onclick={() => onAddRule(type)}>
              <Icon class="size-4 mr-2" />
              <div class="flex-1">
                <p>{RULE_TYPE_LABELS[type]}</p>
                <p class="text-xs text-muted-foreground">{RULE_TYPE_DESCRIPTIONS[type]}</p>
              </div>
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </div>

  <!-- Presets bar -->
  <div class="p-2 border-b shrink-0">
    <RenamePresets />
  </div>

  <!-- Rules list -->
  <div class="flex-1 overflow-auto p-2">
    {#if localRules.length === 0}
      <div class="flex flex-col items-center justify-center py-8 text-center">
        <p class="text-muted-foreground text-sm mb-2">No rules added</p>
        <p class="text-xs text-muted-foreground max-w-[200px]">
          Add rules to transform your filenames. Rules are applied in order from top to bottom.
        </p>
      </div>
    {:else}
      <div
        class="space-y-2"
        use:dndzone={{ 
          items: localRules, 
          flipDurationMs: FLIP_DURATION_MS,
          dropTargetStyle: {},
        }}
        onconsider={handleDndConsider}
        onfinalize={handleDndFinalize}
      >
        {#each localRules as rule, index (rule.id)}
          <div animate:flip={{ duration: FLIP_DURATION_MS }}>
            <RenameRuleCard
              {rule}
              {index}
              isExpanded={editingRuleId === rule.id}
              onToggle={() => onToggleRule(rule.id)}
              onEdit={() => handleEditRule(rule.id)}
              onDuplicate={() => onDuplicateRule(rule.id)}
              onRemove={() => onRemoveRule(rule.id)}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Tip -->
  {#if rules.length > 0}
    <div class="p-3 border-t shrink-0">
      <p class="text-xs text-muted-foreground">
        Rules are applied in order. Drag to reorder.
      </p>
    </div>
  {/if}
</div>

<!-- Edit Rule Dialog -->
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title>
        {#if editingRule}
          Edit {RULE_TYPE_LABELS[editingRule.type]} Rule
        {:else}
          Edit Rule
        {/if}
      </Dialog.Title>
      <Dialog.Description>
        Configure the rule settings below.
      </Dialog.Description>
    </Dialog.Header>
    
    {#if editingRule}
      <div class="py-4">
        {#if editingRule.type === 'prefix'}
          <PrefixRule 
            config={editingRule.config as import('$lib/types/rename').PrefixConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'suffix'}
          <SuffixRule 
            config={editingRule.config as import('$lib/types/rename').SuffixConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'replace'}
          <ReplaceRule 
            config={editingRule.config as import('$lib/types/rename').ReplaceConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'regex'}
          <RegexRule 
            config={editingRule.config as import('$lib/types/rename').RegexConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'remove'}
          <RemoveRule 
            config={editingRule.config as import('$lib/types/rename').RemoveConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'case'}
          <CaseRule 
            config={editingRule.config as import('$lib/types/rename').CaseConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'number'}
          <NumberRule 
            config={editingRule.config as import('$lib/types/rename').NumberConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'move'}
          <MoveRule 
            config={editingRule.config as import('$lib/types/rename').MoveConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'timestamp'}
          <TimestampRule 
            config={editingRule.config as import('$lib/types/rename').TimestampConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'clear'}
          <ClearRule 
            config={editingRule.config as import('$lib/types/rename').ClearConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {:else if editingRule.type === 'text'}
          <TextRule 
            config={editingRule.config as import('$lib/types/rename').TextConfig}
            onUpdate={(config) => onUpdateRuleConfig(editingRule.id, config)}
          />
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" onclick={handleCloseDialog}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
