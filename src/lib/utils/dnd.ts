import { dndzone as originalDndzone, type Options, type DndEvent } from 'svelte-dnd-action';
import type { Action } from 'svelte/action';

export type { DndEvent };

interface DndOptions<T> extends Omit<Options, 'items'> {
  items: T[];
  onConsider?: (items: T[]) => void;
  onFinalize?: (items: T[]) => void;
}

/**
 * Wrapper around svelte-dnd-action that works with Svelte 5
 * Handles events internally and calls callbacks instead of dispatching events
 */
export function dndzone<T extends { id: string | number }>(
  node: HTMLElement,
  options: DndOptions<T>
): ReturnType<Action<HTMLElement, DndOptions<T>>> {
  const { onConsider, onFinalize, ...dndOptions } = options;
  let currentOnConsider = onConsider;
  let currentOnFinalize = onFinalize;

  // Apply the original dndzone action
  const dndAction = originalDndzone(node, dndOptions);

  // Listen for consider and finalize events
  function handleConsider(e: CustomEvent<DndEvent<T>>) {
    currentOnConsider?.(e.detail.items);
  }

  function handleFinalize(e: CustomEvent<DndEvent<T>>) {
    currentOnFinalize?.(e.detail.items);
  }

  node.addEventListener('consider', handleConsider as EventListener);
  node.addEventListener('finalize', handleFinalize as EventListener);

  return {
    update(newOptions: DndOptions<T>) {
      const { onConsider: newOnConsider, onFinalize: newOnFinalize, ...newDndOptions } = newOptions;
      currentOnConsider = newOnConsider;
      currentOnFinalize = newOnFinalize;
      dndAction.update?.(newDndOptions);
    },
    destroy() {
      node.removeEventListener('consider', handleConsider as EventListener);
      node.removeEventListener('finalize', handleFinalize as EventListener);
      dndAction.destroy?.();
    }
  };
}
