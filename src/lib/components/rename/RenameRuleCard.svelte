<script lang="ts">
  import { GripVertical, MoreVertical, Copy, Trash2, Pencil, TextCursorInput, Type, Replace, Regex, Eraser, CaseSensitive, Hash, MoveHorizontal, Clock, CircleOff, Text } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import type { RenameRule, RuleType } from '$lib/types/rename';
  import { RULE_TYPE_LABELS } from '$lib/types/rename';
  import { getRuleSummary } from '$lib/services/rename';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Item from '$lib/components/ui/item';
  
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

<Item.Root
  variant="outline"
  size="xs"
  class={cn(
    'flex-nowrap',
    !rule.enabled && 'opacity-60',
    isExpanded && 'ring-2 ring-primary/20',
    className
  )}
>
  <Item.Media
    class="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
    aria-hidden="true"
  >
    <GripVertical class="size-4" />
  </Item.Media>

  <Badge variant="secondary" class="flex size-5 shrink-0 items-center justify-center rounded-full p-0 text-xs">
    {index + 1}
  </Badge>

  <Item.Media>
    <Icon class={cn('size-4', rule.enabled ? 'text-primary' : 'text-muted-foreground')} />
  </Item.Media>

  <Item.Content class="min-w-0">
    <button class="min-w-0 text-left" onclick={onEdit}>
      <Item.Title class="w-full truncate">{RULE_TYPE_LABELS[rule.type]}</Item.Title>
      <Item.Description class="w-full truncate text-xs">{summary}</Item.Description>
    </button>
  </Item.Content>

  <Item.Actions class="shrink-0">
    <Switch
      checked={rule.enabled}
      onCheckedChange={onToggle}
      class="shrink-0"
      aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${RULE_TYPE_LABELS[rule.type]} rule`}
    />

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
  </Item.Actions>
</Item.Root>
