import { invoke } from '@tauri-apps/api/core';

/**
 * Count tokens using tiktoken o200k_base encoding (via Rust backend)
 * This encoding is used by GPT-4o, GPT-5, and other modern OpenAI models
 */
export async function countTokens(text: string): Promise<number> {
  return invoke<number>('count_tokens', { text });
}
