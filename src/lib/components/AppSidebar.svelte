<script lang="ts">
  import {
    FileOutput,
    FileVideo,
    GitMerge,
    Info,
    Settings,
    Languages,
    PenLine,
    AudioLines,
    ScanText,
  } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import type { ComponentProps } from 'svelte';

  import { Badge } from '$lib/components/ui/badge';
  import AccountMenu from '$lib/components/account/AccountMenu.svelte';
  import * as Sidebar from '$lib/components/ui/sidebar';
  import { formatAppVersion, loadAppVersion } from '$lib/services/app-metadata';
  import { OS } from '$lib/utils';

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
      id: 'transcode',
      title: 'Transcode',
      icon: FileVideo,
    },
    {
      id: 'audio-to-subs',
      title: 'Audio to Subs',
      icon: AudioLines,
    },
    {
      id: 'video-ocr',
      title: 'Video OCR',
      icon: ScanText,
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
  let appVersionLabel = $state('Loading version...');

  onMount(() => {
    void loadAppVersion()
      .then((version) => {
        appVersionLabel = formatAppVersion(version);
      })
      .catch(() => {
        appVersionLabel = 'Version unavailable';
      });
  });

</script>

<Sidebar.Root variant="floating"  {...restProps}>
  <Sidebar.Header>
    <Sidebar.Menu>
      <Sidebar.MenuItem>
        <Sidebar.MenuButton size="lg" class="pointer-events-none">
          {#snippet child({ props })}
            <div {...props} class="flex items-center gap-2" class:pt-8={isMacOS} data-tauri-drag-region={isMacOS}>
              <img
                src="/mediaflow-logo.svg"
                alt="MediaFlow logo"
                class="size-10 rounded-lg object-contain shrink-0"
                draggable="false"
              />
              <div class="flex flex-col gap-0.5 leading-none">
                <span class="font-semibold">MediaFlow</span>
                <span class="text-xs text-muted-foreground">{appVersionLabel}</span>
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
                <Icon class="size-4" />
                <span>{item.title}</span>
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
        {@const isSettingsActive = currentView === 'settings'}
        <Sidebar.MenuButton
          isActive={isSettingsActive}
          onclick={() => onNavigate?.('settings')}
        >
          <Settings class="size-4" />
          <span>Settings</span>
        </Sidebar.MenuButton>
      </Sidebar.MenuItem>
      <Sidebar.MenuItem>
        <AccountMenu />
      </Sidebar.MenuItem>
    </Sidebar.Menu>
  </Sidebar.Footer>

</Sidebar.Root>
