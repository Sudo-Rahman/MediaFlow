<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { open } from '@tauri-apps/plugin-dialog';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { mode, setMode } from 'mode-watcher';
  import { toast } from 'svelte-sonner';

  import { settingsStore } from '$lib/stores';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Card from '$lib/components/ui/card';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { Separator } from '$lib/components/ui/separator';
  import { Badge } from '$lib/components/ui/badge';
  import { Progress } from '$lib/components/ui/progress';

  import Sun from 'lucide-svelte/icons/sun';
  import Moon from 'lucide-svelte/icons/moon';
  import Monitor from 'lucide-svelte/icons/monitor';
  import Palette from 'lucide-svelte/icons/palette';
  import Terminal from 'lucide-svelte/icons/terminal';
  import FolderOpen from 'lucide-svelte/icons/folder-open';
  import Download from 'lucide-svelte/icons/download';
  import CheckCircle from 'lucide-svelte/icons/check-circle';
  import XCircle from 'lucide-svelte/icons/x-circle';
  import RefreshCw from 'lucide-svelte/icons/refresh-cw';
  import Info from 'lucide-svelte/icons/info';
  import Key from 'lucide-svelte/icons/key';
  import Eye from 'lucide-svelte/icons/eye';
  import EyeOff from 'lucide-svelte/icons/eye-off';
  import Languages from 'lucide-svelte/icons/languages';
  import AudioLines from 'lucide-svelte/icons/audio-lines';
  import Trash2 from 'lucide-svelte/icons/trash-2';
  import Loader2 from 'lucide-svelte/icons/loader-2';
  import ExternalLink from 'lucide-svelte/icons/external-link';

  import { LLM_PROVIDERS, type LLMProvider, WHISPER_MODELS } from '$lib/types';
  import { 
    checkWhisperInstalled, 
    getWhisperVersion, 
    listDownloadedModels,
    downloadModel,
    deleteModel
  } from '$lib/services/whisper';

  let ffmpegStatus = $state<'checking' | 'found' | 'not-found'>('checking');
  let ffmpegVersion = $state<string | null>(null);

  // OS detection (simple approach using navigator)
  let currentPlatform = $state<'macos' | 'windows' | 'linux'>('macos');

  // Whisper state
  let whisperStatus = $state<'checking' | 'found' | 'not-found'>('checking');
  let whisperVersion = $state<string | null>(null);
  let whisperDownloadedModels = $state<string[]>([]);
  let whisperIsRefreshing = $state(false);
  let whisperIsDownloading = $state(false);
  let whisperDownloadProgress = $state(0);
  let whisperSelectedModel = $state<string>('small');
  let whisperDeletingModel = $state<string | null>(null);

  // Detect platform on mount
  function detectPlatform(): 'macos' | 'windows' | 'linux' {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('mac')) return 'macos';
    if (userAgent.includes('win')) return 'windows';
    return 'linux';
  }

  async function openWhisperGitHub() {
    try {
      await openUrl('https://github.com/ggerganov/whisper.cpp');
    } catch {
      // Fallback to window.open
      window.open('https://github.com/ggerganov/whisper.cpp', '_blank');
    }
  }

  const themeOptions = [
    { value: 'system', label: 'System', icon: Monitor, description: 'Follow system preferences' },
    { value: 'light', label: 'Light', icon: Sun, description: 'Light theme' },
    { value: 'dark', label: 'Dark', icon: Moon, description: 'Dark theme' },
  ] as const;

  // API Key visibility states
  let showApiKeys = $state<Record<LLMProvider, boolean>>({
    openai: false,
    anthropic: false,
    google: false,
    openrouter: false
  });

  function toggleApiKeyVisibility(provider: LLMProvider) {
    showApiKeys = { ...showApiKeys, [provider]: !showApiKeys[provider] };
  }

  async function handleApiKeyChange(provider: LLMProvider, value: string) {
    await settingsStore.setLLMApiKey(provider, value);
  }

  onMount(async () => {
    currentPlatform = detectPlatform();
    await settingsStore.load();
    await checkFFmpeg();
    await checkWhisper();
  });

  // Whisper functions
  async function checkWhisper() {
    whisperStatus = 'checking';
    try {
      const installed = await checkWhisperInstalled();
      if (installed) {
        whisperStatus = 'found';
        try {
          whisperVersion = await getWhisperVersion();
        } catch {
          whisperVersion = null;
        }
        await refreshWhisperModels();
      } else {
        whisperStatus = 'not-found';
        whisperVersion = null;
      }
    } catch {
      whisperStatus = 'not-found';
      whisperVersion = null;
    }
  }

  async function refreshWhisperModels() {
    whisperIsRefreshing = true;
    try {
      whisperDownloadedModels = await listDownloadedModels();
    } catch (e) {
      console.error('Failed to list whisper models:', e);
    } finally {
      whisperIsRefreshing = false;
    }
  }

  async function handleDownloadWhisperModel() {
    if (!whisperSelectedModel || whisperIsDownloading) return;
    
    whisperIsDownloading = true;
    whisperDownloadProgress = 0;
    
    try {
      await downloadModel(whisperSelectedModel, (progress) => {
        whisperDownloadProgress = progress;
      });
      toast.success(`Model ${whisperSelectedModel} downloaded successfully`);
      await refreshWhisperModels();
    } catch (e) {
      toast.error(`Failed to download model: ${e}`);
    } finally {
      whisperIsDownloading = false;
      whisperDownloadProgress = 0;
    }
  }

  async function handleDeleteWhisperModel(modelFile: string) {
    whisperDeletingModel = modelFile;
    try {
      await deleteModel(modelFile);
      toast.success('Model deleted');
      await refreshWhisperModels();
    } catch (e) {
      toast.error(`Failed to delete model: ${e}`);
    } finally {
      whisperDeletingModel = null;
    }
  }

  async function checkFFmpeg() {
    ffmpegStatus = 'checking';
    try {
      const available = await invoke<boolean>('check_ffmpeg');
      if (available) {
        ffmpegStatus = 'found';
        // Try to get version
        try {
          const version = await invoke<string>('get_ffmpeg_version');
          ffmpegVersion = version;
        } catch {
          ffmpegVersion = 'Unknown version';
        }
      } else {
        ffmpegStatus = 'not-found';
        ffmpegVersion = null;
      }
    } catch {
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
    }
  }

  function handleDownloadFFmpeg() {
    // Open FFmpeg download page
    window.open('https://ffmpeg.org/download.html', '_blank');
  }

  const currentMode = $derived(mode.current || 'system');
</script>

<div class="h-full overflow-auto p-6">
  <div class="max-w-2xl mx-auto space-y-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold">Settings</h1>
      <p class="text-muted-foreground mt-1">Customize the app appearance and configuration</p>
    </div>

    <Separator />

    <!-- FFmpeg Configuration -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Terminal class="size-5 text-primary" />
          <Card.Title>FFmpeg Configuration</Card.Title>
        </div>
        <Card.Description>
          Configure FFmpeg and FFprobe paths for media processing
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <!-- Status -->
        <div class="flex items-center justify-between p-3 rounded-md bg-muted/50">
          <div class="flex items-center gap-2">
            {#if ffmpegStatus === 'checking'}
              <RefreshCw class="size-4 animate-spin text-muted-foreground" />
              <span class="text-sm">Checking FFmpeg...</span>
            {:else if ffmpegStatus === 'found'}
              <CheckCircle class="size-4 text-green-500" />
              <span class="text-sm">FFmpeg found</span>
              {#if ffmpegVersion}
                <Badge variant="secondary" class="text-xs">{ffmpegVersion}</Badge>
              {/if}
            {:else}
              <XCircle class="size-4 text-destructive" />
              <span class="text-sm text-destructive">FFmpeg not found</span>
            {/if}
          </div>
          <Button variant="ghost" size="sm" onclick={checkFFmpeg}>
            <RefreshCw class="size-4" />
          </Button>
        </div>

        <!-- FFmpeg path -->
        <div class="space-y-2">
          <Label for="ffmpeg-path">FFmpeg path (optional)</Label>
          <div class="flex gap-2">
            <Input
              id="ffmpeg-path"
              placeholder="Leave empty to use system PATH"
              value={settingsStore.settings.ffmpegPath}
              oninput={(e) => settingsStore.setFFmpegPath(e.currentTarget.value)}
              class="flex-1"
            />
            <Button variant="outline" size="icon" onclick={handleBrowseFFmpeg}>
              <FolderOpen class="size-4" />
            </Button>
          </div>
          <p class="text-xs text-muted-foreground">
            If empty, the app will use FFmpeg from your system PATH
          </p>
        </div>

        <!-- FFprobe path -->
        <div class="space-y-2">
          <Label for="ffprobe-path">FFprobe path (optional)</Label>
          <div class="flex gap-2">
            <Input
              id="ffprobe-path"
              placeholder="Leave empty to use system PATH"
              value={settingsStore.settings.ffprobePath}
              oninput={(e) => settingsStore.setFFprobePath(e.currentTarget.value)}
              class="flex-1"
            />
            <Button variant="outline" size="icon" onclick={handleBrowseFFprobe}>
              <FolderOpen class="size-4" />
            </Button>
          </div>
        </div>

        <!-- Download button -->
        {#if ffmpegStatus === 'not-found'}
          <Button variant="outline" class="w-full" onclick={handleDownloadFFmpeg}>
            <Download class="size-4 mr-2" />
            Download FFmpeg
          </Button>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Whisper Configuration -->
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <AudioLines class="size-5 text-primary" />
          <Card.Title>Whisper Configuration</Card.Title>
        </div>
        <Card.Description>
          Configure whisper.cpp for local audio transcription
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        <!-- Status -->
        <div class="flex items-center justify-between p-3 rounded-md bg-muted/50">
          <div class="flex items-center gap-2">
            {#if whisperStatus === 'checking'}
              <RefreshCw class="size-4 animate-spin text-muted-foreground" />
              <span class="text-sm">Checking whisper.cpp...</span>
            {:else if whisperStatus === 'found'}
              <CheckCircle class="size-4 text-green-500" />
              <span class="text-sm">whisper.cpp found</span>
              {#if whisperVersion}
                <Badge variant="secondary" class="text-xs">{whisperVersion}</Badge>
              {/if}
            {:else}
              <XCircle class="size-4 text-destructive" />
              <span class="text-sm text-destructive">whisper.cpp not found</span>
            {/if}
          </div>
          <Button variant="ghost" size="sm" onclick={() => checkWhisper()}>
            <RefreshCw class="size-4" />
          </Button>
        </div>

        <!-- Installation instructions if not found -->
        {#if whisperStatus === 'not-found'}
          <div class="p-3 rounded-md border border-amber-500/30 bg-amber-500/10">
            <p class="text-sm font-medium text-amber-600 dark:text-amber-400 mb-2">
              whisper.cpp is required for audio transcription
            </p>
            
            {#if currentPlatform === 'macos'}
              <p class="text-xs text-muted-foreground mb-2">
                Install via Homebrew (macOS):
              </p>
              <code class="block text-xs bg-muted p-2 rounded font-mono">
                brew install whisper-cpp
              </code>
            {:else}
              <p class="text-xs text-muted-foreground mb-2">
                Please compile whisper.cpp from source or download pre-built binaries from GitHub.
              </p>
            {/if}
            
            <Button 
              variant="outline" 
              size="sm" 
              class="mt-3 w-full"
              onclick={openWhisperGitHub}
            >
              <ExternalLink class="size-4 mr-2" />
              View whisper.cpp on GitHub
            </Button>
          </div>
        {/if}

        <!-- Downloaded Models -->
        {#if whisperStatus === 'found'}
          <div class="space-y-2">
            <div class="flex items-center justify-between">
              <Label>Downloaded Models</Label>
              <Button 
                variant="ghost" 
                size="sm" 
                onclick={() => refreshWhisperModels()}
                disabled={whisperIsRefreshing}
              >
                <RefreshCw class={`size-4 ${whisperIsRefreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            
            {#if whisperDownloadedModels.length === 0}
              <p class="text-sm text-muted-foreground py-2">
                No models downloaded yet. Download a model to start transcribing.
              </p>
            {:else}
              <div class="space-y-2">
                {#each whisperDownloadedModels as model (model)}
                  {@const modelId = model.replace('ggml-', '').replace('.bin', '')}
                  {@const modelInfo = WHISPER_MODELS.find((m) => m.id === modelId)}
                  <div class="flex items-center justify-between p-2 rounded-md bg-muted/50">
                    <div class="flex items-center gap-2">
                      <CheckCircle class="size-4 text-green-500" />
                      <span class="text-sm font-medium">
                        {modelInfo?.name || model}
                      </span>
                      {#if modelInfo}
                        <Badge variant="outline" class="text-xs">{modelInfo.size}</Badge>
                      {/if}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onclick={() => handleDeleteWhisperModel(model)}
                      disabled={whisperDeletingModel === model}
                    >
                      {#if whisperDeletingModel === model}
                        <Loader2 class="size-4 animate-spin" />
                      {:else}
                        <Trash2 class="size-4" />
                      {/if}
                    </Button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <!-- Download new model -->
          {@const availableModels = WHISPER_MODELS.filter((m) => !whisperDownloadedModels.includes(`ggml-${m.id}.bin`))}
          <div class="space-y-2">
            <Label>Download Model</Label>
            <div class="flex gap-2">
              <select
                class="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
                bind:value={whisperSelectedModel}
              >
                {#each availableModels as model (model.id)}
                  <option value={model.id}>
                    {model.name} ({model.size}) - {model.speed}
                  </option>
                {/each}
              </select>
              <Button
                variant="outline"
                size="icon"
                onclick={() => handleDownloadWhisperModel()}
                disabled={whisperIsDownloading || !whisperSelectedModel || availableModels.length === 0}
              >
                {#if whisperIsDownloading}
                  <Loader2 class="size-4 animate-spin" />
                {:else}
                  <Download class="size-4" />
                {/if}
              </Button>
            </div>
            
            {#if whisperIsDownloading}
              <div class="space-y-1">
                <Progress value={whisperDownloadProgress} class="h-2" />
                <p class="text-xs text-muted-foreground text-center">
                  Downloading... {whisperDownloadProgress}%
                </p>
              </div>
            {/if}
          </div>
        {/if}

        <div class="pt-2 text-xs text-muted-foreground">
          <p>Models are stored in <code class="bg-muted px-1 rounded">~/.cache/whisper/</code></p>
          <p class="mt-1">Larger models are more accurate but slower. Recommended: <strong>small</strong> or <strong>medium</strong> for most use cases.</p>
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
          Configure API keys for AI-powered subtitle translation
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-4">
        {#each Object.entries(LLM_PROVIDERS) as [key, provider] (key)}
          {@const providerKey = key as LLMProvider}
          <div class="space-y-2">
            <Label for={`api-key-${key}`}>{provider.name} API Key</Label>
            <div class="flex gap-2">
              <div class="relative flex-1">
                <Input
                  id={`api-key-${key}`}
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
          <p>API keys are stored locally and never shared. Get your keys from:</p>
          <ul class="mt-1 space-y-1 list-disc list-inside">
            <li><a href="https://platform.openai.com/api-keys" target="_blank" class="text-primary hover:underline">OpenAI Platform</a></li>
            <li><a href="https://console.anthropic.com/" target="_blank" class="text-primary hover:underline">Anthropic Console</a></li>
            <li><a href="https://aistudio.google.com/apikey" target="_blank" class="text-primary hover:underline">Google AI Studio</a></li>
            <li><a href="https://openrouter.ai/keys" target="_blank" class="text-primary hover:underline">OpenRouter</a></li>
          </ul>
        </div>
      </Card.Content>
    </Card.Root>

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
          <Label for="max-parallel">Maximum Parallel Files</Label>
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
          <Label for="default-batch">Default Number of Batches</Label>
          <Input
            id="default-batch"
            type="number"
            min="1"
            max="20"
            value={settingsStore.settings.translationSettings.defaultBatchCount}
            oninput={(e) => settingsStore.setDefaultBatchCount(parseInt(e.currentTarget.value) || 1)}
          />
          <p class="text-xs text-muted-foreground">
            Default number of parts to split files into (1 = no split)
          </p>
        </div>
      </Card.Content>
    </Card.Root>

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
          {#each themeOptions as option}
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
        <div class="flex items-center justify-between">
          <span class="text-muted-foreground">Version</span>
          <span class="font-mono text-sm">1.0.0</span>
        </div>
        <Separator />
        <div class="text-sm text-muted-foreground">
          <p>RsExtractor is a tool for extracting and merging media tracks (audio, video, subtitles) from MKV and other container files.</p>
          <p class="mt-2">Built with Tauri, Svelte, and FFmpeg.</p>
        </div>
      </Card.Content>
    </Card.Root>
  </div>
</div>

