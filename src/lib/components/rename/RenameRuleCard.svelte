<script lang="ts">
  import { GripVertical, MoreVertical, Copy, Trash2, Pencil, TextCursorInput, Type, Replace, Regex, Eraser, CaseSensitive, Hash, MoveHorizontal, Clock, CircleOff, Text } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { RenameRule, RuleType } from '$lib/types/rename';
  import { RULE_TYPE_LABELS } from '$lib/types/rename';
  import { getRuleSummary } from '$lib/services/rename';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  
  // Rule type icons

  interface RenameRuleCardProps {
    rule: RenameRule;
    index: number;
    isExpanded?: boolean;
    onToggle?: () => void;
    onEdit?: () => void;
    onDuplicate?: () => void;
    onRemove?: () => void;
    class?: string;
  }

  let { 
    rule, 
    index,
    isExpanded = false,
    onToggle, 
    onEdit,
    onDuplicate,
    onRemove,
    class: className = '' 
  }: RenameRuleCardProps = $props();

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

  const Icon = $derived(RULE_ICONS[rule.type]);
  const summary = $derived(getRuleSummary(rule));
</script>

<div
  class={cn(
    'rounded-lg border transition-all',
    rule.enabled 
      ? 'bg-card border-border' 
      : 'bg-muted/30 border-border/50 opacity-60',
    isExpanded && 'ring-2 ring-primary/20',
    className
  )}
>
  <!-- Header -->
  <div class="flex items-center gap-2 p-2">
    <!-- Drag handle -->
    <div class="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
      <GripVertical class="size-4" />
    </div>

    <!-- Index badge -->
    <span class="flex items-center justify-center size-5 rounded-full bg-muted text-xs font-medium">
      {index + 1}
    </span>

    <!-- Icon -->
    <Icon class={cn('size-4', rule.enabled ? 'text-primary' : 'text-muted-foreground')} />

    <!-- Title and summary -->
    <button
      class="flex-1 text-left min-w-0"
      onclick={onEdit}
    >
      <p class="text-sm font-medium truncate">
        {RULE_TYPE_LABELS[rule.type]}
      </p>
      <p class="text-xs text-muted-foreground truncate">
        {summary}
      </p>
    </button>

    <!-- Enable/Disable switch -->
    <Switch
      checked={rule.enabled}
      onCheckedChange={onToggle}
      class="shrink-0"
    />

    <!-- Menu -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="ghost" size="icon-sm" class="shrink-0">
            <MoreVertical class="size-4" />
            <span class="sr-only">Options</span>
          </Button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" class="w-40">
        <DropdownMenu.Item onclick={onEdit}>
          <Pencil class="size-4 mr-2" />
          Edit
        </DropdownMenu.Item>
        <DropdownMenu.Item onclick={onDuplicate}>
          <Copy class="size-4 mr-2" />
          Duplicate
        </DropdownMenu.Item>
        <DropdownMenu.Separator />
        <DropdownMenu.Item onclick={onRemove} class="text-destructive focus:text-destructive">
          <Trash2 class="size-4 mr-2" />
          Remove
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
</div>
