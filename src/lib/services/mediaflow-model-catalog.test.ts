import { describe, expect, it } from 'vitest';

import {
  parseMediaFlowModelCatalogResponse,
  splitMediaFlowModelCatalog,
} from './mediaflow-model-catalog';

const validCatalog = {
  object: 'list',
  provider: 'MediaFlow',
  data: [
    { id: 'Lite', label: 'Lite', type: 'chat', capabilities: ['text', 'image'] },
    { id: 'Medium', label: 'Medium', type: 'chat', capabilities: ['text', 'image'] },
    { id: 'High', label: 'High', type: 'chat', capabilities: ['text', 'image'] },
    { id: 'nova-3', label: 'Nova 3', type: 'transcription', capabilities: ['audio'] },
  ],
};

describe('MediaFlow model catalog parsing', () => {
  it('accepts the public MediaFlow model catalog shape', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify(validCatalog),
    });

    expect(parsed).toEqual(validCatalog);
  });

  it('splits chat and transcription models for UI selectors', () => {
    const parsed = parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify(validCatalog),
    });

    expect(splitMediaFlowModelCatalog(parsed)).toEqual({
      chatModels: [
        { id: 'Lite', name: 'Lite' },
        { id: 'Medium', name: 'Medium' },
        { id: 'High', name: 'High' },
      ],
      transcriptionModels: [
        { id: 'nova-3', name: 'Nova 3' },
      ],
    });
  });

  it('rejects non-success HTTP responses', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 503,
      body: JSON.stringify({ error: { message: 'Service unavailable.' } }),
    })).toThrow('MediaFlow model catalog request failed');
  });

  it('rejects catalogs from an unexpected provider', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({ ...validCatalog, provider: 'Other' }),
    })).toThrow('Invalid MediaFlow model catalog');
  });

  it('rejects entries without a public model id', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ label: 'Lite', type: 'chat', capabilities: ['text'] }],
      }),
    })).toThrow('Invalid MediaFlow model id');
  });

  it('rejects entries with an unknown model type', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ id: 'Lite', label: 'Lite', type: 'embedding', capabilities: ['text'] }],
      }),
    })).toThrow('Invalid MediaFlow model type');
  });

  it('rejects entries with unknown capabilities', () => {
    expect(() => parseMediaFlowModelCatalogResponse({
      status: 200,
      body: JSON.stringify({
        ...validCatalog,
        data: [{ id: 'Lite', label: 'Lite', type: 'chat', capabilities: ['video'] }],
      }),
    })).toThrow('Invalid MediaFlow model capability');
  });
});
