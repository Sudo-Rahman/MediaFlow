import { Store } from '@tauri-apps/plugin-store';
import { DEFAULT_OCR_REGION } from '$lib/types';
import type { LLMApiKeys, OcrRegion, TranslationSettings } from '$lib/types';

// Settings interface
export interface AppSettings {
  ffmpegPath: string;
  ffprobePath: string;
  theme: 'system' | 'light' | 'dark';
  outputPathHistory: string[];
  llmApiKeys: LLMApiKeys;
  translationSettings: TranslationSettings;
  openRouterModels: string[]; // Saved OpenRouter model IDs
  deepgramApiKey: string;     // Deepgram API key for transcription
  videoOcrGlobalRegion: OcrRegion;
}

const DEFAULT_SETTINGS: AppSettings = {
  ffmpegPath: '',
  ffprobePath: '',
  theme: 'system',
  outputPathHistory: [],
  llmApiKeys: {
    openai: '',
    anthropic: '',
    google: '',
    openrouter: ''
  },
  translationSettings: {
    maxParallelFiles: 1,
    defaultBatchCount: 1
  },
  openRouterModels: [],
  deepgramApiKey: '',
  videoOcrGlobalRegion: { ...DEFAULT_OCR_REGION }
};

// Persistent store
let store: Store | null = null;
let settings = $state<AppSettings>({ ...DEFAULT_SETTINGS });
let isLoaded = $state(false);

async function getStore(): Promise<Store> {
  if (!store) {
    store = await Store.load('settings.json');
  }
  return store;
}

export const settingsStore = {
  get settings() { return settings; },
  get isLoaded() { return isLoaded; },

  async load() {
    try {
      const s = await getStore();

      const ffmpegPath = await s.get<string>('ffmpegPath');
      const ffprobePath = await s.get<string>('ffprobePath');
      const theme = await s.get<'system' | 'light' | 'dark'>('theme');
      const outputPathHistory = await s.get<string[]>('outputPathHistory');
      const llmApiKeys = await s.get<LLMApiKeys>('llmApiKeys');
      const translationSettings = await s.get<TranslationSettings>('translationSettings');
      const openRouterModels = await s.get<string[]>('openRouterModels');
      const deepgramApiKey = await s.get<string>('deepgramApiKey');
      const videoOcrGlobalRegion = await s.get<OcrRegion>('videoOcrGlobalRegion');

      settings = {
        ffmpegPath: ffmpegPath ?? DEFAULT_SETTINGS.ffmpegPath,
        ffprobePath: ffprobePath ?? DEFAULT_SETTINGS.ffprobePath,
        theme: theme ?? DEFAULT_SETTINGS.theme,
        outputPathHistory: outputPathHistory ?? DEFAULT_SETTINGS.outputPathHistory,
        llmApiKeys: llmApiKeys ?? DEFAULT_SETTINGS.llmApiKeys,
        translationSettings: translationSettings ?? DEFAULT_SETTINGS.translationSettings,
        openRouterModels: openRouterModels ?? DEFAULT_SETTINGS.openRouterModels,
        deepgramApiKey: deepgramApiKey ?? DEFAULT_SETTINGS.deepgramApiKey,
        videoOcrGlobalRegion: videoOcrGlobalRegion ?? { ...DEFAULT_SETTINGS.videoOcrGlobalRegion }
      };

      isLoaded = true;
    } catch (e) {
      console.error('Failed to load settings:', e);
      settings = { ...DEFAULT_SETTINGS };
      isLoaded = true;
    }
  },

  async setFFmpegPath(path: string) {
    settings = { ...settings, ffmpegPath: path };
    const s = await getStore();
    await s.set('ffmpegPath', path);
  },

  async setFFprobePath(path: string) {
    settings = { ...settings, ffprobePath: path };
    const s = await getStore();
    await s.set('ffprobePath', path);
  },

  async setTheme(theme: 'system' | 'light' | 'dark') {
    settings = { ...settings, theme };
    const s = await getStore();
    await s.set('theme', theme);
  },

  async setLLMApiKey(provider: keyof LLMApiKeys, key: string) {
    const newKeys = { ...settings.llmApiKeys, [provider]: key };
    settings = { ...settings, llmApiKeys: newKeys };
    const s = await getStore();
    await s.set('llmApiKeys', newKeys);
  },

  getLLMApiKey(provider: keyof LLMApiKeys): string {
    return settings.llmApiKeys[provider] || '';
  },

  async setTranslationSettings(newSettings: Partial<TranslationSettings>) {
    const updated = { ...settings.translationSettings, ...newSettings };
    settings = { ...settings, translationSettings: updated };
    const s = await getStore();
    await s.set('translationSettings', updated);
  },

  async setMaxParallelFiles(count: number) {
    await this.setTranslationSettings({ maxParallelFiles: count });
  },

  async setDefaultBatchCount(count: number) {
    await this.setTranslationSettings({ defaultBatchCount: count });
  },

  async addOutputPathToHistory(path: string) {
    const history = settings.outputPathHistory.filter(p => p !== path);
    history.unshift(path);
    const newHistory = history.slice(0, 10); // Keep last 10
    settings = { ...settings, outputPathHistory: newHistory };
    const s = await getStore();
    await s.set('outputPathHistory', newHistory);
  },

  async addOpenRouterModel(modelId: string) {
    if (!modelId.trim() || settings.openRouterModels.includes(modelId)) return;
    const newModels = [modelId, ...settings.openRouterModels].slice(0, 20); // Keep last 20
    settings = { ...settings, openRouterModels: newModels };
    const s = await getStore();
    await s.set('openRouterModels', newModels);
  },

  async removeOpenRouterModel(modelId: string) {
    const newModels = settings.openRouterModels.filter(m => m !== modelId);
    settings = { ...settings, openRouterModels: newModels };
    const s = await getStore();
    await s.set('openRouterModels', newModels);
  },

  // Deepgram API Key
  async setDeepgramApiKey(key: string) {
    settings = { ...settings, deepgramApiKey: key };
    const s = await getStore();
    await s.set('deepgramApiKey', key);
  },

  getDeepgramApiKey(): string {
    return settings.deepgramApiKey || '';
  },

  hasDeepgramApiKey(): boolean {
    return (settings.deepgramApiKey?.length ?? 0) > 0;
  },

  async setVideoOcrGlobalRegion(region: OcrRegion) {
    const nextRegion = { ...region };
    settings = { ...settings, videoOcrGlobalRegion: nextRegion };
    const s = await getStore();
    await s.set('videoOcrGlobalRegion', nextRegion);
  },

  getVideoOcrGlobalRegion(): OcrRegion {
    return { ...settings.videoOcrGlobalRegion };
  },

  async reset() {
    settings = { ...DEFAULT_SETTINGS };
    const s = await getStore();
    await s.clear();
  }
};
