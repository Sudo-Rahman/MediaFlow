<script lang="ts">
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { Badge } from '$lib/components/ui/badge';
  import { FileOutput, GitMerge, Info, Settings, Languages, PenLine, AudioLines } from '@lucide/svelte';
  import type { ComponentProps } from 'svelte';
  import {OS} from "$lib/utils";

  interface NavItem {
    id: string;
    title: string;
    icon: typeof FileOutput;
    badge?: string;
  }

  const navItems: NavItem[] = [
    {
      id: 'extract',
      title: 'Extraction',
      icon: FileOutput,
    },
    {
      id: 'merge',
      title: 'Merge',
      icon: GitMerge,
    },
    {
      id: 'audio-to-subs',
      title: 'Audio to Subs',
      icon: AudioLines,
    },
    {
      id: 'translate',
      title: 'AI Translation',
      icon: Languages,
    },
    {
      id: 'rename',
      title: 'Rename',
      icon: PenLine,
    },
    {
      id: 'info',
      title: 'Info',
      icon: Info,
    },
  ];

  interface AppSidebarProps extends ComponentProps<typeof Sidebar.Root> {
    currentView?: string;
    onNavigate?: (viewId: string) => void;
  }

  let {
    currentView = 'extract',
    onNavigate,
    ...restProps
  }: AppSidebarProps = $props();

  const isMacOS = OS() === 'MacOS';
</script>

<Sidebar.Root variant="floating" {...restProps}>
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg" class="pointer-events-none">
          {#snippet child({ props })}
            <div {...props} class="flex items-center gap-2" class:pt-8={isMacOS} data-tauri-drag-region={isMacOS}>
              <div class="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <span class="font-bold text-sm">Rs</span>
              </div>
              <div class="flex flex-col gap-0.5 leading-none">
                <span class="font-semibold">RsExtractor</span>
                <span class="text-xs text-muted-foreground">v1.0.0</span>
              </div>
            </div>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Header>

  <Sidebar.Content>
    <Sidebar.Group>
      <Sidebar.GroupLabel>Tools</Sidebar.GroupLabel>
      <Sidebar.GroupContent>
        <Sidebar.Menu>
          {#each navItems as item (item.id)}
            {@const Icon = item.icon}
            {@const isActive = currentView === item.id}
            <Sidebar.MenuItem>
              <Sidebar.MenuButton
                isActive={isActive}
                onclick={() => onNavigate?.(item.id)}
              >
                {#snippet child({ props })}
                  <button {...props} class="flex items-center gap-2 w-full p-2 rounded-lg" class:bg-accent={isActive}>
                    <Icon class="size-4" />
                    <span>{item.title}</span>
                  </button>
                {/snippet}
              </Sidebar.MenuButton>
              {#if item.badge}
                <Sidebar.MenuBadge>
                  <Badge variant="secondary" class="text-xs">{item.badge}</Badge>
                </Sidebar.MenuBadge>
              {/if}
            </Sidebar.MenuItem>
          {/each}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>

  <Sidebar.Footer>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        {@const isActive = currentView === 'settings'}
        <Sidebar.MenuButton
          isActive={isActive}
          onclick={() => onNavigate?.('settings')}
        >
          {#snippet child({ props })}
            <button {...props} class="flex items-center gap-2 w-full p-2 rounded-lg" class:bg-accent={isActive}>
              <Settings class="size-4" />
              <span>Settings</span>
            </button>
          {/snippet}
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>

</Sidebar.Root>

