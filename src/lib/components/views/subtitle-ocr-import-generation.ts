/**
 * A single import/restore generation can own several asynchronous operations.
 * Each operation gets its own lease so a late callback can release itself without
 * affecting another operation (or a newer generation).
 */
export interface SubtitleOcrImportLease {
  readonly generation: number;
  readonly leaseId: number;
}

export interface SubtitleOcrImportGenerationCoordinator {
  readonly activeGeneration: number | null;
  begin(): SubtitleOcrImportLease;
  retain(generation: number): SubtitleOcrImportLease | null;
  release(lease: SubtitleOcrImportLease): boolean;
  cancelAll(): number[];
  /** True only while a cancelled generation still has an outstanding lease. */
  isCancelled(generation: number): boolean;
  isCurrent(generation: number): boolean;
  isUsable(generation: number): boolean;
}

interface GenerationState {
  leases: Set<number>;
  cancelled: boolean;
}

export function createSubtitleOcrImportGenerationCoordinator(): SubtitleOcrImportGenerationCoordinator {
  let nextGeneration = 0;
  let nextLeaseId = 0;
  let currentGeneration: number | null = null;
  const generations = new Map<number, GenerationState>();

  function createLease(generation: number): SubtitleOcrImportLease {
    const state = generations.get(generation);
    if (!state || state.cancelled) {
      throw new Error(`Cannot create a lease for generation ${generation}`);
    }

    const lease = Object.freeze({ generation, leaseId: ++nextLeaseId });
    state.leases.add(lease.leaseId);
    return lease;
  }

  function begin(): SubtitleOcrImportLease {
    const current = currentGeneration === null ? undefined : generations.get(currentGeneration);
    if (currentGeneration !== null && current && !current.cancelled) {
      return createLease(currentGeneration);
    }

    const generation = ++nextGeneration;
    currentGeneration = generation;
    generations.set(generation, { leases: new Set(), cancelled: false });
    return createLease(generation);
  }

  function retain(generation: number): SubtitleOcrImportLease | null {
    const state = generations.get(generation);
    if (!state || state.cancelled) {
      return null;
    }

    return createLease(generation);
  }

  function release(lease: SubtitleOcrImportLease): boolean {
    const state = generations.get(lease.generation);
    if (!state || !state.leases.delete(lease.leaseId)) {
      return false;
    }

    if (state.leases.size > 0) {
      return true;
    }

    generations.delete(lease.generation);
    if (currentGeneration === lease.generation) {
      currentGeneration = null;
    }
    return true;
  }

  function cancelAll(): number[] {
    const cancelledGenerationIds = [...generations.keys()];
    for (const state of generations.values()) {
      state.cancelled = true;
    }
    // A cancelled generation must never remain active. Old leases may still
    // unwind, but they cannot block a subsequent import. Once the final old
    // lease releases, the generation is removed entirely.
    currentGeneration = null;
    return cancelledGenerationIds;
  }

  return {
    get activeGeneration(): number | null {
      return currentGeneration;
    },
    begin,
    retain,
    release,
    cancelAll,
    isCancelled: (generation) => generations.get(generation)?.cancelled === true,
    isCurrent: (generation) => currentGeneration === generation && !generations.get(generation)?.cancelled,
    isUsable: (generation) => {
      const state = generations.get(generation);
      return state !== undefined && !state.cancelled;
    },
  };
}
