export type SubtitleOcrPreviewRestorePhase = 'queued' | 'in_flight';

export interface SubtitleOcrPreviewRestoreEntry {
  itemId: string;
  hydrationToken: string;
  attempts: number;
  phase: SubtitleOcrPreviewRestorePhase;
}

type PreviewRestoreTimerHandle = ReturnType<typeof setTimeout>;
type SchedulePreviewRestoreTimeout = (
  callback: () => void,
  delayMs: number,
) => PreviewRestoreTimerHandle;
type ClearPreviewRestoreTimeout = (handle: PreviewRestoreTimerHandle) => void;

export interface SubtitleOcrPreviewRestoreState {
  getCurrent(itemId: string): SubtitleOcrPreviewRestoreEntry | undefined;
  get(itemId: string, hydrationToken: string): SubtitleOcrPreviewRestoreEntry | undefined;
  listCurrent(): SubtitleOcrPreviewRestoreEntry[];
  hasQueued(): boolean;
  queue(itemId: string, hydrationToken: string, tokenValid: boolean, attempts?: number): boolean;
  begin(itemId: string, hydrationToken: string, tokenValid: boolean): boolean;
  requeue(itemId: string, hydrationToken: string): boolean;
  retry(itemId: string, hydrationToken: string, attempts: number): boolean;
  finish(itemId: string, hydrationToken: string): boolean;
  discard(itemId: string, expectedToken?: string): boolean;
  schedule(
    itemId: string,
    hydrationToken: string,
    callback: () => void,
    delayMs?: number,
  ): boolean;
  clearItem(itemId: string): void;
  clear(): void;
}

interface MutablePreviewRestoreEntry extends SubtitleOcrPreviewRestoreEntry {}

function cloneEntry(entry: MutablePreviewRestoreEntry): SubtitleOcrPreviewRestoreEntry {
  return { ...entry };
}

export function createSubtitleOcrPreviewRestoreState(
  scheduleTimeout: SchedulePreviewRestoreTimeout = (callback, delayMs) => (
    setTimeout(callback, delayMs)
  ),
  clearTimeoutHandle: ClearPreviewRestoreTimeout = (handle) => clearTimeout(handle),
): SubtitleOcrPreviewRestoreState {
  const entriesByItemId = new Map<string, Map<string, MutablePreviewRestoreEntry>>();
  const currentTokenByItemId = new Map<string, string>();
  const timersByItemId = new Map<string, Map<string, PreviewRestoreTimerHandle>>();

  function getEntries(itemId: string): Map<string, MutablePreviewRestoreEntry> | undefined {
    return entriesByItemId.get(itemId);
  }

  function getEntry(itemId: string, hydrationToken: string): MutablePreviewRestoreEntry | undefined {
    return getEntries(itemId)?.get(hydrationToken);
  }

  function clearTimer(itemId: string, hydrationToken: string): void {
    const timers = timersByItemId.get(itemId);
    const handle = timers?.get(hydrationToken);
    if (handle === undefined) {
      return;
    }

    clearTimeoutHandle(handle);
    timers?.delete(hydrationToken);
    if (timers?.size === 0) {
      timersByItemId.delete(itemId);
    }
  }

  function removeEntry(itemId: string, hydrationToken: string): boolean {
    const entries = getEntries(itemId);
    const removed = entries?.delete(hydrationToken) ?? false;
    clearTimer(itemId, hydrationToken);

    if (currentTokenByItemId.get(itemId) === hydrationToken) {
      currentTokenByItemId.delete(itemId);
    }

    if (entries?.size === 0) {
      entriesByItemId.delete(itemId);
    }

    return removed;
  }

  function setCurrentEntry(entry: MutablePreviewRestoreEntry): void {
    let entries = entriesByItemId.get(entry.itemId);
    if (!entries) {
      entries = new Map();
      entriesByItemId.set(entry.itemId, entries);
    }

    entries.set(entry.hydrationToken, entry);
    currentTokenByItemId.set(entry.itemId, entry.hydrationToken);
  }

  function isCurrent(itemId: string, hydrationToken: string): boolean {
    return currentTokenByItemId.get(itemId) === hydrationToken;
  }

  function getCurrent(itemId: string): SubtitleOcrPreviewRestoreEntry | undefined {
    const hydrationToken = currentTokenByItemId.get(itemId);
    const entry = hydrationToken ? getEntry(itemId, hydrationToken) : undefined;
    return entry ? cloneEntry(entry) : undefined;
  }

  function get(itemId: string, hydrationToken: string): SubtitleOcrPreviewRestoreEntry | undefined {
    const entry = getEntry(itemId, hydrationToken);
    return entry ? cloneEntry(entry) : undefined;
  }

  function queue(
    itemId: string,
    hydrationToken: string,
    tokenValid: boolean,
    attempts = 0,
  ): boolean {
    if (!tokenValid) {
      return false;
    }

    const existing = getEntry(itemId, hydrationToken);
    if (existing && !isCurrent(itemId, hydrationToken)) {
      return false;
    }

    const currentToken = currentTokenByItemId.get(itemId);
    const currentEntry = currentToken ? getEntry(itemId, currentToken) : undefined;
    if (currentToken && currentToken !== hydrationToken && currentEntry?.phase === 'queued') {
      removeEntry(itemId, currentToken);
    }

    if (existing?.phase === 'in_flight') {
      return false;
    }

    const entry: MutablePreviewRestoreEntry = existing ?? {
      itemId,
      hydrationToken,
      attempts: 0,
      phase: 'queued',
    };
    entry.attempts = attempts;
    entry.phase = 'queued';
    setCurrentEntry(entry);
    return true;
  }

  function begin(itemId: string, hydrationToken: string, tokenValid: boolean): boolean {
    if (!tokenValid) {
      return false;
    }

    const currentToken = currentTokenByItemId.get(itemId);
    if (currentToken !== undefined && currentToken !== hydrationToken) {
      return false;
    }

    const entry = getEntry(itemId, hydrationToken);
    if (entry?.phase === 'in_flight') {
      return false;
    }

    if (!entry) {
      setCurrentEntry({
        itemId,
        hydrationToken,
        attempts: 0,
        phase: 'in_flight',
      });
      return true;
    }

    clearTimer(itemId, hydrationToken);
    entry.phase = 'in_flight';
    return true;
  }

  function requeue(itemId: string, hydrationToken: string): boolean {
    if (!isCurrent(itemId, hydrationToken)) {
      return false;
    }

    const entry = getEntry(itemId, hydrationToken);
    if (!entry || entry.phase !== 'in_flight') {
      return false;
    }

    entry.phase = 'queued';
    return true;
  }

  function retry(itemId: string, hydrationToken: string, attempts: number): boolean {
    if (!Number.isInteger(attempts) || attempts < 0 || !isCurrent(itemId, hydrationToken)) {
      return false;
    }

    const entry = getEntry(itemId, hydrationToken);
    if (!entry || entry.phase !== 'in_flight') {
      return false;
    }

    entry.attempts = attempts;
    entry.phase = 'queued';
    return true;
  }

  function finish(itemId: string, hydrationToken: string): boolean {
    return removeEntry(itemId, hydrationToken);
  }

  function discard(itemId: string, expectedToken?: string): boolean {
    if (expectedToken === undefined) {
      clearItem(itemId);
      return true;
    }

    if (!isCurrent(itemId, expectedToken)) {
      // A stale completion may still own an in-flight entry. Remove only that
      // generation; never let it clear the newer current generation.
      removeEntry(itemId, expectedToken);
      return false;
    }

    return removeEntry(itemId, expectedToken);
  }

  function listCurrent(): SubtitleOcrPreviewRestoreEntry[] {
    const currentEntries: SubtitleOcrPreviewRestoreEntry[] = [];
    for (const [itemId, hydrationToken] of currentTokenByItemId) {
      const entry = getEntry(itemId, hydrationToken);
      if (entry) {
        currentEntries.push(cloneEntry(entry));
      }
    }

    return currentEntries;
  }

  function hasQueued(): boolean {
    return listCurrent().some((entry) => entry.phase === 'queued');
  }

  function schedule(
    itemId: string,
    hydrationToken: string,
    callback: () => void,
    delayMs = 0,
  ): boolean {
    if (!isCurrent(itemId, hydrationToken)) {
      return false;
    }

    const entry = getEntry(itemId, hydrationToken);
    if (!entry || entry.phase !== 'queued') {
      return false;
    }

    let timers = timersByItemId.get(itemId);
    if (!timers) {
      timers = new Map();
      timersByItemId.set(itemId, timers);
    }

    if (timers.has(hydrationToken)) {
      return true;
    }

    let handle: PreviewRestoreTimerHandle;
    handle = scheduleTimeout(() => {
      if (timersByItemId.get(itemId)?.get(hydrationToken) !== handle) {
        return;
      }

      timersByItemId.get(itemId)?.delete(hydrationToken);
      if (timersByItemId.get(itemId)?.size === 0) {
        timersByItemId.delete(itemId);
      }

      const currentEntry = getEntry(itemId, hydrationToken);
      if (!isCurrent(itemId, hydrationToken) || currentEntry?.phase !== 'queued') {
        return;
      }

      callback();
    }, delayMs);
    timers.set(hydrationToken, handle);
    return true;
  }

  function clearItem(itemId: string): void {
    const entries = getEntries(itemId);
    if (entries) {
      for (const hydrationToken of entries.keys()) {
        clearTimer(itemId, hydrationToken);
      }
    }

    entriesByItemId.delete(itemId);
    currentTokenByItemId.delete(itemId);
    timersByItemId.delete(itemId);
  }

  function clear(): void {
    for (const itemId of entriesByItemId.keys()) {
      clearItem(itemId);
    }
    for (const itemId of timersByItemId.keys()) {
      timersByItemId.delete(itemId);
    }
  }

  return {
    getCurrent,
    get,
    listCurrent,
    hasQueued,
    queue,
    begin,
    requeue,
    retry,
    finish,
    discard,
    schedule,
    clearItem,
    clear,
  };
}
