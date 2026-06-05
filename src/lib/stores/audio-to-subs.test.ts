import { beforeEach, describe, expect, it, vi } from 'vitest';

const mediaflowModelCatalogStoreMock = vi.hoisted(() => ({
  transcriptionModels: [
    { id: 'mf-transcribe-fast', name: 'Fast Transcription' },
    { id: 'mf-transcribe-accurate', name: 'Accurate Transcription' },
  ],
}));

vi.mock('./mediaflow-model-catalog.svelte', () => ({
  mediaflowModelCatalogStore: mediaflowModelCatalogStoreMock,
}));

describe('audioToSubsStore MediaFlow model selection', () => {
  beforeEach(() => {
    vi.resetModules();
    mediaflowModelCatalogStoreMock.transcriptionModels = [
      { id: 'mf-transcribe-fast', name: 'Fast Transcription' },
      { id: 'mf-transcribe-accurate', name: 'Accurate Transcription' },
    ];
  });

  it('uses the first loaded MediaFlow transcription model when switching providers', async () => {
    const { audioToSubsStore } = await import('./audio-to-subs.svelte');

    audioToSubsStore.setModel('nova-2');
    audioToSubsStore.setTranscriptionProvider('mediaflow');

    expect(audioToSubsStore.config.deepgramConfig.model).toBe('mf-transcribe-fast');
  });

  it('keeps the current model when MediaFlow has no loaded transcription models', async () => {
    mediaflowModelCatalogStoreMock.transcriptionModels = [];
    const { audioToSubsStore } = await import('./audio-to-subs.svelte');

    audioToSubsStore.setModel('nova-2');
    audioToSubsStore.setTranscriptionProvider('mediaflow');

    expect(audioToSubsStore.config.deepgramConfig.model).toBe('nova-2');
  });
});
