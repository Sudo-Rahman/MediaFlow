<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { open } from '@tauri-apps/plugin-dialog';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { mode, setMode } from 'mode-watcher';
  import { toast } from 'svelte-sonner';

  import { settingsStore, updaterStore } from '$lib/stores';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Progress } from '$lib/components/ui/progress';
  import * as Card from '$lib/components/ui/card';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { Separator } from '$lib/components/ui/separator';
  import { Badge } from '$lib/components/ui/badge';
  import { loadAppVersion } from '$lib/services/app-metadata';
  import * as Item from "$lib/components/ui/item/index.js";


  import { Sun, Moon, Monitor, Palette, Terminal, FolderOpen, Download, CheckCircle, XCircle, RefreshCw, Info, Key, Eye, EyeOff, Languages, AudioLines, ExternalLink, LogIn, LogOut, UserRound } from '@lucide/svelte';

  import { LLM_API_KEY_PROVIDERS, LLM_PROVIDERS, type LLMApiKeyProvider } from '$lib/types';
  import {
    refreshMediaFlowSession,
    restoreMediaFlowSession,
    signInWithMediaFlow,
    signOutMediaFlow,
  } from '$lib/services/mediaflow-auth';

  type DownloadResult = {
    ffmpegPath: string;
    ffprobePath: string;
    warning?: string | null;
  };

  type DownloadProgressEvent = {
    progress: number;
    stage: string;
  };

  type BinaryPathSource = 'bundled' | 'custom' | 'system';

  interface SettingsViewProps {
    onOpenUpdateDialog?: () => void;
  }

  let { onOpenUpdateDialog }: SettingsViewProps = $props();

  type FFmpegInfo = {
    ffmpegPath: string;
    ffprobePath: string;
    source: BinaryPathSource;
    ffmpegSource: BinaryPathSource;
    ffprobeSource: BinaryPathSource;
    version: string;
  };

  let ffmpegStatus = $state<'checking' | 'found' | 'not-found'>('checking');
  let ffmpegVersion = $state<string | null>(null);
  let ffmpegError = $state<string | null>(null);
  let ffmpegInfo = $state<FFmpegInfo | null>(null);
  let isDownloading = $state(false);
  let downloadProgress = $state<number | null>(null);
  let downloadStage = $state<string | null>(null);
  let appVersion = $state('Loading...');
  let unlistenProgress: (() => void) | null = null;

  const isDebugBuild = import.meta.env.DEV;

  // Deepgram API key visibility
  let showDeepgramApiKey = $state(false);

  const themeOptions = [
    { value: 'system', label: 'System', icon: Monitor, description: 'Follow system preferences' },
    { value: 'light', label: 'Light', icon: Sun, description: 'Light theme' },
    { value: 'dark', label: 'Dark', icon: Moon, description: 'Dark theme' },
  ] as const;

  // API Key visibility states
  let showApiKeys = $state<Record<LLMApiKeyProvider, boolean>>({
    openai: false,
    anthropic: false,
    google: false,
    openrouter: false
  });

  let isMediaFlowBusy = $state(false);

  function toggleApiKeyVisibility(provider: LLMApiKeyProvider) {
    showApiKeys = { ...showApiKeys, [provider]: !showApiKeys[provider] };
  }

  async function handleApiKeyChange(provider: LLMApiKeyProvider, value: string) {
    await settingsStore.setLLMApiKey(provider, value);
  }

  async function handleDeepgramApiKeyChange(value: string) {
    await settingsStore.setDeepgramApiKey(value);
  }

  onMount(() => {
    let destroyed = false;

    const setup = async () => {
      await settingsStore.load();
      if (destroyed) return;

      await restoreMediaFlowSession();
      if (destroyed) return;

      try {
        const version = await loadAppVersion();
        if (destroyed) return;
        appVersion = version;
      } catch {
        if (destroyed) return;
        appVersion = 'Unavailable';
      }

      if (destroyed) return;
      await checkFFmpeg();
      if (destroyed) return;

      const unlisten = await listen<DownloadProgressEvent>('ffmpeg-download-progress', (event) => {
        const next = Math.max(0, Math.min(100, event.payload.progress));
        downloadProgress = next;
        downloadStage = event.payload.stage;
      });

      if (destroyed) {
        unlisten();
        return;
      }

      unlistenProgress = unlisten;
    };

    void setup();

    return () => {
      destroyed = true;
      unlistenProgress?.();
      unlistenProgress = null;

      if (checkTimeout) {
        clearTimeout(checkTimeout);
        checkTimeout = null;
      }
    };
  });

  async function checkFFmpeg() {
    ffmpegStatus = 'checking';
    ffmpegError = null;
    ffmpegInfo = null;
    try {
      const info = await invoke<FFmpegInfo>('get_ffmpeg_info');
      ffmpegInfo = info;
      ffmpegStatus = 'found';
      ffmpegVersion = info.version || 'Unknown version';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ffmpegError = message;
      ffmpegStatus = 'not-found';
      ffmpegVersion = null;
    }
  }

  async function handleThemeChange(value: string) {
    const theme = value as 'system' | 'light' | 'dark';
    setMode(theme);
    await settingsStore.setTheme(theme);
  }

  async function handleBrowseFFmpeg() {
    const selected = await open({
      multiple: false,
      title: 'Select FFmpeg executable'
    });
    if (selected && typeof selected === 'string') {
      await settingsStore.setFFmpegPath(selected);
      toast.success('FFmpeg path updated');
      await checkFFmpeg();
    }
  }

  async function handleBrowseFFprobe() {
    const selected = await open({
      multiple: false,
      title: 'Select FFprobe executable'
    });
    if (selected && typeof selected === 'string') {
      await settingsStore.setFFprobePath(selected);
      toast.success('FFprobe path updated');
      await checkFFmpeg();
    }
  }

  let checkTimeout: ReturnType<typeof setTimeout> | null = null;

  function scheduleCheckFFmpeg() {
    if (checkTimeout) {
      clearTimeout(checkTimeout);
    }
    checkTimeout = setTimeout(() => {
      checkFFmpeg();
    }, 400);
  }

  async function handleFFmpegPathInput(value: string) {
    await settingsStore.setFFmpegPath(value);
    scheduleCheckFFmpeg();
  }

  async function handleFFprobePathInput(value: string) {
    await settingsStore.setFFprobePath(value);
    scheduleCheckFFmpeg();
  }

  async function handleDownloadFFmpeg() {
    if (!isDebugBuild) return;
    if (isDownloading) return;
    isDownloading = true;
    downloadProgress = 0;
    downloadStage = 'Starting download...';
    try {
      const result = await invoke<DownloadResult>('download_ffmpeg');
      await settingsStore.setFFmpegPath(result.ffmpegPath);
      await settingsStore.setFFprobePath(result.ffprobePath);
      if (result.warning) {
        toast.warning(result.warning);
      }
      toast.success('FFmpeg installed');
      downloadProgress = 100;
      downloadStage = 'FFmpeg installed';
      await checkFFmpeg();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
      downloadProgress = null;
      downloadStage = null;
    } finally {
      isDownloading = false;
    }
  }

  function formatBinarySource(source: BinaryPathSource): string {
    if (source === 'bundled') return 'Bundled';
    if (source === 'custom') return 'Custom path';
    return 'System PATH';
  }

  function formatUpdateStatus(): string {
    if (updaterStore.status === 'unsupported') return 'Unavailable outside the desktop app';
    if (updaterStore.status === 'checking') return 'Checking...';
    if (updaterStore.status === 'available') return `Update available: v${updaterStore.availableVersion}`;
    if (updaterStore.status === 'up-to-date') return 'Up to date';
    if (updaterStore.status === 'downloading') return 'Downloading update...';
    if (updaterStore.status === 'installing') return 'Installing update...';
    if (updaterStore.status === 'relaunching') return 'Relaunching...';
    if (updaterStore.status === 'error') return 'Update check failed';
    return 'Not checked yet';
  }

  function formatLastUpdateCheck(): string {
    if (!updaterStore.lastCheckAt) return 'Never';

    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(updaterStore.lastCheckAt);
  }

  async function handleOpenDeepgramConsole() {
    try {
      await openUrl('https://console.deepgram.com/');
    } catch (error) {
      console.error('Failed to open Deepgram console:', error);
      toast.error('Failed to open Deepgram website');
    }
  }

  async function handleMediaFlowSignIn() {
    isMediaFlowBusy = true;
    try {
      await signInWithMediaFlow();
      toast.info('Complete sign-in in your browser');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      isMediaFlowBusy = false;
    }
  }

  async function handleMediaFlowRefresh() {
    isMediaFlowBusy = true;
    try {
      await refreshMediaFlowSession();
      toast.success('MediaFlow session refreshed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      isMediaFlowBusy = false;
    }
  }

  async function handleMediaFlowSignOut() {
    isMediaFlowBusy = true;
    try {
      await signOutMediaFlow();
      toast.success('Signed out from MediaFlow');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(message);
    } finally {
      isMediaFlowBusy = false;
    }
  }

  const currentMode = $derived(mode.current || 'system');
  const deepgramApiKeyConfigured = $derived(
    settingsStore.settings.deepgramApiKey && settingsStore.settings.deepgramApiKey.length > 0
  );
  const mediaflowUser = $derived(settingsStore.settings.mediaflowUser);
</script>

<div class="h-full overflow-auto p-6">
  <div class="max-w-2xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold">Settings</h1>
      <p class="text-muted-foreground mt-1">Customize appearance and configuration</p>
    </div>

    <Separator />

    <!-- FFmpeg Configuration -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Terminal class="size-5 text-primary" />
          <Card.Title>FFmpeg</Card.Title>
        </div>
        {#if isDebugBuild}
            <Card.Description>
                Configure FFmpeg and FFprobe paths for multimedia processing
            </Card.Description>
        {/if}
      </Card.Header>
      <Card.Content class="space-y-4">
        <!-- Status -->
        <Item.Root variant="muted">
           <Item.Content>
             <Item.Title>
                 <div class="flex flex-wrap items-center gap-2">
                   {#if ffmpegStatus === 'checking'}
                     <RefreshCw class="size-4 animate-spin text-muted-foreground" />
                     <span class="text-sm">Checking FFmpeg...</span>
                   {:else if ffmpegStatus === 'found'}
                     <CheckCircle class="size-4 text-green-500" />
                     <span class="text-sm">FFmpeg found</span>
                     {#if ffmpegVersion}
                       <Badge variant="secondary" class="text-xs">{ffmpegVersion}</Badge>
                     {/if}
                     {#if ffmpegInfo}
                       <Badge variant="outline" class="text-xs">{formatBinarySource(ffmpegInfo.source)}</Badge>
                     {/if}
                   {:else}
                     <XCircle class="size-4 text-destructive" />
                     <span class="text-sm text-destructive">FFmpeg not found</span>
                   {/if}
                 </div>
             </Item.Title>
           </Item.Content>
           <Item.Actions>
               <Button variant="ghost" size="sm" onclick={checkFFmpeg}>
                 <RefreshCw class="size-4" />
               </Button>
           </Item.Actions>
         </Item.Root>

        {#if isDebugBuild}
          <!-- FFmpeg path -->
          <div class="space-y-2">
            <Label for="ffmpeg-path">FFmpeg Path (optional)</Label>
            <div class="flex gap-2">
              <Input
                id="ffmpeg-path"
                placeholder="Leave empty to use bundled FFmpeg or system PATH"
                value={settingsStore.settings.ffmpegPath}
                oninput={(e) => void handleFFmpegPathInput(e.currentTarget.value)}
                class="flex-1"
              />
              <Button variant="outline" size="icon" onclick={handleBrowseFFmpeg}>
                <FolderOpen class="size-4" />
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">
              If empty, the application will try the bundled FFmpeg first, then system PATH
            </p>
          </div>

          <!-- FFprobe path -->
          <div class="space-y-2">
            <Label for="ffprobe-path">FFprobe Path (optional)</Label>
            <div class="flex gap-2">
              <Input
                id="ffprobe-path"
                placeholder="Leave empty to use bundled FFprobe or system PATH"
                value={settingsStore.settings.ffprobePath}
                oninput={(e) => void handleFFprobePathInput(e.currentTarget.value)}
                class="flex-1"
              />
              <Button variant="outline" size="icon" onclick={handleBrowseFFprobe}>
                <FolderOpen class="size-4" />
              </Button>
            </div>
            {#if ffmpegError}
              <p class="text-xs text-destructive">{ffmpegError}</p>
            {/if}
          </div>
        {:else}
          <div class="space-y-3">
            <div class="space-y-1">
              <Label>Active FFmpeg</Label>
              <p class="break-all rounded bg-muted px-2 py-1 text-xs">
                {ffmpegInfo?.ffmpegPath ?? 'Unavailable'}
              </p>
            </div>
            <div class="space-y-1">
              <Label>Active FFprobe</Label>
              <p class="break-all rounded bg-muted px-2 py-1 text-xs">
                {ffmpegInfo?.ffprobePath ?? 'Unavailable'}
              </p>
            </div>
            <p class="text-xs text-muted-foreground">
              Production builds always use the bundled FFmpeg tools.
            </p>
          </div>
          {#if ffmpegError}
            <p class="text-xs text-destructive">{ffmpegError}</p>
          {/if}
        {/if}

        <!-- Download button -->
        {#if isDebugBuild && ffmpegStatus === 'not-found'}
          <Button
            variant="outline"
            class="w-full"
            onclick={handleDownloadFFmpeg}
            disabled={isDownloading}
          >
            {#if isDownloading}
              <RefreshCw class="size-4 mr-2 animate-spin" />
              Downloading FFmpeg...
            {:else}
              <Download class="size-4 mr-2" />
              Download FFmpeg
            {/if}
          </Button>
          {#if isDownloading || downloadProgress !== null}
            <div class="space-y-2">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{downloadStage ?? 'Preparing...'}</span>
                <span>{downloadProgress !== null ? `${Math.round(downloadProgress)}%` : ''}</span>
              </div>
              <Progress value={downloadProgress ?? 0} max={100} />
            </div>
          {/if}
        {/if}
      </Card.Content>
    </Card.Root>

    {#if isDebugBuild}
      <!-- MediaFlow Account -->
      <Card.Root>
        <Card.Header>
          <div class="flex items-center gap-2">
            <UserRound class="size-5 text-primary" />
            <Card.Title>MediaFlow Account</Card.Title>
          </div>
          <Card.Description>
            Connect to the local MediaFlow backend for managed AI credits
          </Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          <div class="flex items-center justify-between p-3 rounded-md bg-muted/50">
            <div class="flex items-center gap-2 min-w-0">
              {#if mediaflowUser}
                <CheckCircle class="size-4 text-green-500 shrink-0" />
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">{mediaflowUser.name || mediaflowUser.email}</p>
                  <p class="text-xs text-muted-foreground truncate">{mediaflowUser.email}</p>
                </div>
              {:else}
                <XCircle class="size-4 text-amber-500 shrink-0" />
                <span class="text-sm text-amber-600 dark:text-amber-400">Not signed in</span>
              {/if}
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            {#if mediaflowUser}
              <Button variant="outline" onclick={handleMediaFlowRefresh} disabled={isMediaFlowBusy}>
                <RefreshCw class={['size-4 mr-2', isMediaFlowBusy && 'animate-spin']} />
                Refresh session
              </Button>
              <Button variant="outline" onclick={handleMediaFlowSignOut} disabled={isMediaFlowBusy}>
                <LogOut class="size-4 mr-2" />
                Sign out
              </Button>
            {:else}
              <Button onclick={handleMediaFlowSignIn} disabled={isMediaFlowBusy}>
                {#if isMediaFlowBusy}
                  <RefreshCw class="size-4 mr-2 animate-spin" />
                {:else}
                  <LogIn class="size-4 mr-2" />
                {/if}
                Sign in with MediaFlow
              </Button>
            {/if}
          </div>
        </Card.Content>
      </Card.Root>

      <!-- LLM API Keys -->
      <Card.Root>
        <Card.Header>
          <div class="flex items-center gap-2">
            <Key class="size-5 text-primary" />
            <Card.Title>LLM API Keys</Card.Title>
          </div>
          <Card.Description>
            Configure API keys for AI subtitle translation
          </Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          {#each LLM_API_KEY_PROVIDERS as providerKey (providerKey)}
            {@const provider = LLM_PROVIDERS[providerKey]}
            <div class="space-y-2">
              <Label for={`api-key-${providerKey}`}>{provider.name} API Key</Label>
              <div class="flex gap-2">
                <div class="relative flex-1">
                  <Input
                    id={`api-key-${providerKey}`}
                    type={showApiKeys[providerKey] ? 'text' : 'password'}
                    placeholder={`Enter your ${provider.name} API key`}
                    value={settingsStore.settings.llmApiKeys[providerKey]}
                    oninput={(e) => handleApiKeyChange(providerKey, e.currentTarget.value)}
                    class="pr-10"
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onclick={() => toggleApiKeyVisibility(providerKey)}
                >
                  {#if showApiKeys[providerKey]}
                    <EyeOff class="size-4" />
                  {:else}
                    <Eye class="size-4" />
                  {/if}
                </Button>
              </div>
              {#if providerKey === 'openrouter'}
                <p class="text-xs text-muted-foreground">
                  OpenRouter allows access to multiple models from different providers
                </p>
              {/if}
            </div>
          {/each}

          <div class="pt-2 text-xs text-muted-foreground">
            <p>API keys are stored locally and are never shared. Get your keys:</p>
            <ul class="mt-1 space-y-1 list-disc list-inside">
              <li><a href="https://platform.openai.com/api-keys" target="_blank" class="text-primary hover:underline">OpenAI Platform</a></li>
              <li><a href="https://console.anthropic.com/" target="_blank" class="text-primary hover:underline">Anthropic Console</a></li>
              <li><a href="https://aistudio.google.com/apikey" target="_blank" class="text-primary hover:underline">Google AI Studio</a></li>
              <li><a href="https://openrouter.ai/keys" target="_blank" class="text-primary hover:underline">OpenRouter</a></li>
            </ul>
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Translation Settings -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Languages class="size-5 text-primary" />
          <Card.Title>Translation Settings</Card.Title>
        </div>
        <Card.Description>
          Configure parallel processing and batching
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="space-y-2">
          <Label for="max-parallel">Maximum parallel files</Label>
          <Input
            id="max-parallel"
            type="number"
            min="1"
            max="10"
            value={settingsStore.settings.translationSettings.maxParallelFiles}
            oninput={(e) => settingsStore.setMaxParallelFiles(parseInt(e.currentTarget.value) || 1)}
          />
          <p class="text-xs text-muted-foreground">
            Number of files to translate simultaneously (1-10)
          </p>
        </div>

        <div class="space-y-2">
          <Label for="default-batch">Default batch count</Label>
          <Input
            id="default-batch"
            type="number"
            min="1"
            max="20"
            value={settingsStore.settings.translationSettings.defaultBatchCount}
            oninput={(e) => settingsStore.setDefaultBatchCount(parseInt(e.currentTarget.value) || 1)}
          />
          <p class="text-xs text-muted-foreground">
            Number of parts to divide files into (1 = no division)
          </p>
        </div>
      </Card.Content>
    </Card.Root>

    {#if isDebugBuild}
      <!-- Deepgram Configuration -->
      <Card.Root>
        <Card.Header>
          <div class="flex items-center gap-2">
            <AudioLines class="size-5 text-primary" />
            <Card.Title>Deepgram</Card.Title>
          </div>
          <Card.Description>
            Configure Deepgram Nova API for audio transcription
          </Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          <!-- Status -->
          <div class="flex items-center justify-between p-3 rounded-md bg-muted/50">
            <div class="flex items-center gap-2">
              {#if deepgramApiKeyConfigured}
                <CheckCircle class="size-4 text-green-500" />
                <span class="text-sm">API key configured</span>
              {:else}
                <XCircle class="size-4 text-amber-500" />
                <span class="text-sm text-amber-600 dark:text-amber-400">API key not configured</span>
              {/if}
            </div>
          </div>

          <!-- API Key input -->
          <div class="space-y-2">
            <Label for="deepgram-api-key">Deepgram API Key</Label>
            <div class="flex gap-2">
              <div class="relative flex-1">
                <Input
                  id="deepgram-api-key"
                  type={showDeepgramApiKey ? 'text' : 'password'}
                  placeholder="Enter your Deepgram API key"
                  value={settingsStore.settings.deepgramApiKey}
                  oninput={(e) => handleDeepgramApiKeyChange(e.currentTarget.value)}
                  class="pr-10"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onclick={() => showDeepgramApiKey = !showDeepgramApiKey}
              >
                {#if showDeepgramApiKey}
                  <EyeOff class="size-4" />
                {:else}
                  <Eye class="size-4" />
                {/if}
              </Button>
            </div>
          </div>

          <!-- Info and link -->
          <div class="p-3 rounded-md border border-muted bg-muted/30">
            <p class="text-sm text-muted-foreground mb-2">
              Deepgram Nova offers high-quality audio transcription with multilingual support.
            </p>
            <Button
              variant="outline"
              size="sm"
              class="w-full"
              onclick={handleOpenDeepgramConsole}
            >
              <ExternalLink class="size-4 mr-2" />
              Get API key on Deepgram
            </Button>
          </div>

          <div class="pt-2 text-xs text-muted-foreground">
            <p>The API key is stored locally and is never shared.</p>
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- Appearance -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Palette class="size-5 text-primary" />
          <Card.Title>Appearance</Card.Title>
        </div>
        <Card.Description>
          Choose the interface theme
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <RadioGroup.Root value={currentMode} onValueChange={handleThemeChange} class="grid gap-3">
          {#each themeOptions as option (option.value)}
            {@const Icon = option.icon}
            <Label
              for={option.value}
              class="flex items-center gap-4 rounded-lg border p-4 cursor-pointer transition-colors hover:bg-accent/50 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-primary/5"
            >
              <RadioGroup.Item value={option.value} id={option.value} />
              <div class="flex items-center gap-3 flex-1">
                <div class="p-2 rounded-md bg-muted">
                  <Icon class="size-5 text-muted-foreground" />
                </div>
                <div class="flex-1">
                  <div class="font-medium">{option.label}</div>
                  <div class="text-sm text-muted-foreground">{option.description}</div>
                </div>
              </div>
            </Label>
          {/each}
        </RadioGroup.Root>
      </Card.Content>
    </Card.Root>

    <!-- About -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Info class="size-5 text-primary" />
          <Card.Title>About</Card.Title>
        </div>
      </Card.Header>
      <Card.Content class="space-y-4">
        <div class="flex items-center gap-3">
          <img
            src="/mediaflow-logo.svg"
            alt="MediaFlow logo"
            class="size-16 rounded-2xl object-contain shrink-0"
            draggable="false"
          />
          <div>
            <p class="font-semibold">MediaFlow</p>
            <p class="text-xs text-muted-foreground">Desktop multimedia toolkit</p>
          </div>
        </div>
        <Separator />
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Version</span>
          <span class="font-mono text-sm">{appVersion}</span>
        </div>
        <Separator />
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium">Updates</p>
              <p class="text-xs text-muted-foreground">{formatUpdateStatus()}</p>
              <p class="mt-1 text-xs text-muted-foreground">Last check: {formatLastUpdateCheck()}</p>
              {#if updaterStore.lastError}
                <p class="mt-1 text-xs text-destructive">{updaterStore.lastError}</p>
              {/if}
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-2">
              {#if updaterStore.hasUpdate}
                <Button variant="default" size="sm" onclick={() => onOpenUpdateDialog?.()}>
                  <Download class="size-4 mr-2" />
                  View update
                </Button>
              {/if}
              <Button
                variant="outline"
                size="sm"
                onclick={() => updaterStore.checkForUpdates({ manual: true })}
                disabled={updaterStore.isBusy}
              >
                <RefreshCw class={['size-4 mr-2', updaterStore.status === 'checking' && 'animate-spin']} />
                Check now
              </Button>
            </div>
          </div>
        </div>
        <Separator />
        <div class="text-sm text-muted-foreground">
          <p>
            MediaFlow is an all-in-one desktop toolkit for multimedia workflows: Extraction, Merge,
            Transcode, Audio to Subs, Video OCR, AI Translation, Rename, and file Info analysis.
          </p>
          <p class="mt-2">
            Built with Tauri, Svelte 5, TypeScript, Rust, and FFmpeg for fast local processing.
          </p>
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>
