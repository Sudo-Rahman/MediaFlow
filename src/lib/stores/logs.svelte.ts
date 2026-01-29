/**
 * Centralized logs store for RsExtractor
 * Manages all application logs (FFmpeg, FFprobe, Translation, etc.)
 */

export type LogLevel = 'info' | 'success' | 'warning' | 'error';
export type LogSource = 'ffmpeg' | 'ffprobe' | 'translation' | 'merge' | 'extraction' | 'rename' | 'whisper' | 'system';

export interface LogContext {
  filePath?: string;
  command?: string;
  trackIndex?: number;
  provider?: string;
  apiError?: string;
  outputPath?: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: LogLevel;
  source: LogSource;
  title: string;
  details: string;
  context?: LogContext;
  read?: boolean;
}

// Maximum number of logs to keep in memory
const MAX_LOGS = 500;

// Private state
let logs = $state<LogEntry[]>([]);
let selectedLogId = $state<string | null>(null);
let isOpen = $state(false);

// Filters
let sourceFilter = $state<LogSource | null>(null);
let levelFilter = $state<LogLevel | null>(null);
let searchQuery = $state('');

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const logStore = {
  // Getters
  get logs() {
    return logs;
  },

  get filteredLogs() {
    let filtered = logs;

    if (sourceFilter) {
      filtered = filtered.filter(log => log.source === sourceFilter);
    }

    if (levelFilter) {
      filtered = filtered.filter(log => log.level === levelFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log =>
        log.title.toLowerCase().includes(query) ||
        log.details.toLowerCase().includes(query) ||
        log.source.toLowerCase().includes(query) ||
        log.context?.filePath?.toLowerCase().includes(query)
      );
    }

    return filtered;
  },

  get selectedLog(): LogEntry | undefined {
    if (!selectedLogId) return undefined;
    return logs.find(log => log.id === selectedLogId);
  },

  get selectedLogId() {
    return selectedLogId;
  },

  get isOpen() {
    return isOpen;
  },

  get unreadErrorCount(): number {
    return logs.filter(log => log.level === 'error' && !log.read).length;
  },

  get sourceFilter() {
    return sourceFilter;
  },

  get levelFilter() {
    return levelFilter;
  },

  get searchQuery() {
    return searchQuery;
  },

  // Filter actions
  setSourceFilter(source: LogSource | null) {
    sourceFilter = source;
  },

  setLevelFilter(level: LogLevel | null) {
    levelFilter = level;
  },

  setSearchQuery(query: string) {
    searchQuery = query;
  },

  clearFilters() {
    sourceFilter = null;
    levelFilter = null;
    searchQuery = '';
  },

  // Log actions
  addLog(entry: Omit<LogEntry, 'id' | 'timestamp' | 'read'>): string {
    const id = generateId();
    const newLog: LogEntry = {
      ...entry,
      id,
      timestamp: new Date(),
      read: false
    };

    // Add to the beginning (newest first)
    logs = [newLog, ...logs];

    // Trim if exceeds max
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(0, MAX_LOGS);
    }

    return id;
  },

  getLog(id: string): LogEntry | undefined {
    return logs.find(log => log.id === id);
  },

  markAsRead(id: string) {
    logs = logs.map(log =>
      log.id === id ? { ...log, read: true } : log
    );
  },

  markAllAsRead() {
    logs = logs.map(log => ({ ...log, read: true }));
  },

  clearLogs() {
    logs = [];
    selectedLogId = null;
  },

  // Selection
  selectLog(id: string) {
    selectedLogId = id;
    this.markAsRead(id);
  },

  clearSelection() {
    selectedLogId = null;
  },

  // Sheet/Dialog state
  open() {
    isOpen = true;
  },

  close() {
    isOpen = false;
    selectedLogId = null;
  },

  toggle() {
    if (isOpen) {
      this.close();
    } else {
      this.open();
    }
  }
};

// Helper functions for source colors/badges
export function getSourceColor(source: LogSource): string {
  const colors: Record<LogSource, string> = {
    ffmpeg: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
    ffprobe: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    translation: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
    merge: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30',
    extraction: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
    rename: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/30',
    whisper: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/30',
    system: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30'
  };
  return colors[source] || colors.system;
}

export function getLevelColor(level: LogLevel): string {
  const colors: Record<LogLevel, string> = {
    error: 'text-destructive',
    warning: 'text-orange-500',
    success: 'text-green-500',
    info: 'text-muted-foreground'
  };
  return colors[level] || colors.info;
}

export function getLevelBgColor(level: LogLevel): string {
  const colors: Record<LogLevel, string> = {
    error: 'bg-destructive/10 border-destructive/30',
    warning: 'bg-orange-500/10 border-orange-500/30',
    success: 'bg-green-500/10 border-green-500/30',
    info: 'bg-muted border-border'
  };
  return colors[level] || colors.info;
}
