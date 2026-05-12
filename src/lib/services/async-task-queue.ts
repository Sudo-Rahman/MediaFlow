export interface AsyncTaskQueue {
  readonly activeCount: number;
  readonly pendingCount: number;
  enqueue(task: () => Promise<void>): void;
  clear(): void;
}

export function createAsyncTaskQueue(concurrency: number): AsyncTaskQueue {
  const maxActive = Math.max(1, Math.floor(concurrency));
  const pending: Array<() => Promise<void>> = [];
  let activeCount = 0;

  function runNext(): void {
    while (activeCount < maxActive && pending.length > 0) {
      const task = pending.shift();
      if (!task) {
        return;
      }

      activeCount += 1;
      let taskPromise: Promise<void>;
      try {
        taskPromise = task();
      } catch {
        taskPromise = Promise.resolve();
      }

      void taskPromise
        .catch(() => {
          // Tasks are fire-and-forget; callers cannot observe failures from enqueue().
        })
        .finally(() => {
          activeCount -= 1;
          runNext();
        });
    }
  }

  return {
    get activeCount() {
      return activeCount;
    },

    get pendingCount() {
      return pending.length;
    },

    enqueue(task: () => Promise<void>): void {
      pending.push(task);
      runNext();
    },

    clear(): void {
      pending.length = 0;
    },
  };
}
