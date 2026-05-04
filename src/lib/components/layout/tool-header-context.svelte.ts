import { getContext, setContext, type Snippet } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import type { ToolId } from '$lib/types/tool-import';

export interface ToolHeaderConfig {
  title?: string;
  description?: string;
  actions?: Snippet;
}

class ToolHeaderContext {
  #headers = new SvelteMap<ToolId, ToolHeaderConfig>();

  setHeader(toolId: ToolId, config: ToolHeaderConfig): void {
    this.#headers.set(toolId, config);
  }

  clearHeader(toolId: ToolId, expectedConfig?: ToolHeaderConfig): void {
    if (expectedConfig && this.#headers.get(toolId) !== expectedConfig) {
      return;
    }

    this.#headers.delete(toolId);
  }

  getHeader(toolId: ToolId): ToolHeaderConfig | undefined {
    return this.#headers.get(toolId);
  }
}

const TOOL_HEADER_CONTEXT_KEY = Symbol('tool-header');

export function setToolHeader(): ToolHeaderContext {
  return setContext(TOOL_HEADER_CONTEXT_KEY, new ToolHeaderContext());
}

export function useToolHeader(): ToolHeaderContext {
  return getContext<ToolHeaderContext>(TOOL_HEADER_CONTEXT_KEY);
}
