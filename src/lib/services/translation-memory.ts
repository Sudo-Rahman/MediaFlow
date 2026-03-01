import { Store } from '@tauri-apps/plugin-store';

export interface TranslationMemoryEntry {
  signature: string;
  sourceLanguage: string;
  targetLanguage: string;
  provider: string;
  model: string;
  translatedCanonicalSkeleton: string;
  createdAt: string;
  updatedAt: string;
  hitCount: number;
}

export interface TranslationMemoryScope {
  updatedAt: string;
  entries: Record<string, TranslationMemoryEntry>;
}

export interface TranslationMemoryStoreData {
  version: 1;
  scopes: Record<string, TranslationMemoryScope>;
}

const MEMORY_STORE_FILE = 'translation-memory.json';
const MEMORY_STORE_KEY = 'memory';

const DEFAULT_MEMORY_DATA: TranslationMemoryStoreData = {
  version: 1,
  scopes: {}
};

let memoryStore: Store | null = null;

async function getStore(): Promise<Store> {
  if (!memoryStore) {
    memoryStore = await Store.load(MEMORY_STORE_FILE);
  }

  return memoryStore;
}

function normalizeMemoryData(value: TranslationMemoryStoreData | null | undefined): TranslationMemoryStoreData {
  if (!value || value.version !== 1 || typeof value.scopes !== 'object' || value.scopes === null) {
    return { ...DEFAULT_MEMORY_DATA };
  }

  return {
    version: 1,
    scopes: value.scopes
  };
}

async function saveTranslationMemory(data: TranslationMemoryStoreData): Promise<void> {
  const store = await getStore();
  await store.set(MEMORY_STORE_KEY, data);
  await store.save();
}

export async function loadTranslationMemory(): Promise<TranslationMemoryStoreData> {
  const store = await getStore();
  const data = await store.get<TranslationMemoryStoreData>(MEMORY_STORE_KEY);
  return normalizeMemoryData(data);
}

export function getTranslationMemoryScopeKey(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const hasLeadingSlash = normalizedPath.startsWith('/');
  const parts = normalizedPath.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return normalizedPath;
  }

  parts.pop();

  const lastDirectory = parts[parts.length - 1]?.toLowerCase();
  if (lastDirectory && /^(subs|subtitle|subtitles)$/.test(lastDirectory) && parts.length > 1) {
    parts.pop();
  }

  if (parts.length === 0) {
    return normalizedPath;
  }

  const joined = parts.join('/');
  return hasLeadingSlash ? `/${joined}` : joined;
}

export async function getThemeMemoryEntries(
  scopeKey: string,
  keys: string[]
): Promise<Map<string, TranslationMemoryEntry>> {
  const data = await loadTranslationMemory();
  const scope = data.scopes[scopeKey];
  const found = new Map<string, TranslationMemoryEntry>();

  if (!scope) {
    return found;
  }

  for (const key of keys) {
    const entry = scope.entries[key];
    if (entry) {
      found.set(key, entry);
    }
  }

  return found;
}

export async function touchThemeMemoryEntries(scopeKey: string, keys: string[]): Promise<void> {
  if (keys.length === 0) {
    return;
  }

  const data = await loadTranslationMemory();
  const scope = data.scopes[scopeKey];
  if (!scope) {
    return;
  }

  const now = new Date().toISOString();
  let changed = false;

  for (const key of keys) {
    const existing = scope.entries[key];
    if (!existing) {
      continue;
    }

    scope.entries[key] = {
      ...existing,
      updatedAt: now,
      hitCount: existing.hitCount + 1
    };
    changed = true;
  }

  if (!changed) {
    return;
  }

  data.scopes[scopeKey] = {
    ...scope,
    updatedAt: now
  };

  await saveTranslationMemory(data);
}

export async function upsertThemeMemoryEntries(
  scopeKey: string,
  entries: Map<string, Omit<TranslationMemoryEntry, 'createdAt' | 'updatedAt' | 'hitCount'>>
): Promise<void> {
  if (entries.size === 0) {
    return;
  }

  const data = await loadTranslationMemory();
  const now = new Date().toISOString();
  const existingScope = data.scopes[scopeKey] ?? {
    updatedAt: now,
    entries: {}
  };

  const nextEntries = { ...existingScope.entries };

  for (const [key, entry] of entries) {
    const existing = nextEntries[key];
    nextEntries[key] = {
      ...entry,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      hitCount: existing?.hitCount ?? 0
    };
  }

  data.scopes[scopeKey] = {
    updatedAt: now,
    entries: nextEntries
  };

  await saveTranslationMemory(data);
}
