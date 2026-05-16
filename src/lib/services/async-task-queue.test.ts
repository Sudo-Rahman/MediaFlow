import { describe, expect, it } from 'vitest';

import { createAsyncTaskQueue } from './async-task-queue';

declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

function tick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('async task queue', () => {
  it('limits active tasks', async () => {
    const queue = createAsyncTaskQueue(2);
    const first = deferred();
    const second = deferred();
    const third = deferred();
    let maxActive = 0;
    let active = 0;

    for (const task of [first, second, third]) {
      queue.enqueue(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await task.promise;
        active -= 1;
      });
    }

    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);
    expect(maxActive).toBe(2);

    first.resolve();
    await tick();

    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(0);
    expect(maxActive).toBe(2);

    second.resolve();
    third.resolve();
    await tick();

    expect(queue.activeCount).toBe(0);
  });

  it('clears pending tasks without cancelling active tasks', async () => {
    const queue = createAsyncTaskQueue(1);
    const first = deferred();
    let secondRan = false;

    queue.enqueue(async () => {
      await first.promise;
    });
    queue.enqueue(async () => {
      secondRan = true;
    });

    expect(queue.activeCount).toBe(1);
    expect(queue.pendingCount).toBe(1);

    queue.clear();
    first.resolve();
    await tick();

    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
    expect(secondRan).toBe(false);
  });

  it('recovers from a rejected task without an unhandled rejection', async () => {
    const queue = createAsyncTaskQueue(1);
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown): void => {
      unhandledRejections.push(reason);
    };
    let secondRan = false;

    process.on('unhandledRejection', onUnhandledRejection);
    try {
      queue.enqueue(async () => {
        throw new Error('task failed');
      });
      queue.enqueue(async () => {
        secondRan = true;
      });

      await tick();
      await tick();

      expect(secondRan).toBe(true);
      expect(queue.activeCount).toBe(0);
      expect(queue.pendingCount).toBe(0);
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
