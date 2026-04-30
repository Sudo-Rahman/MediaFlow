const MEDIAFLOW_DEVELOPMENT_BASE_URL = 'http://localhost:5173';
const MEDIAFLOW_RELEASE_BASE_URL = 'https://mediaflow.app';

const PROVIDER_BASE_URLS = {
  deepgram: 'https://api.deepgram.com',
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
};

/**
 * @param {{ isDebugBuild: boolean }} options
 */
export function createMediaFlowApiConfig({ isDebugBuild }) {
  const debugBuild = Boolean(isDebugBuild);

  return {
    build: {
      isDebugBuild: debugBuild,
    },
    app: {
      publicBaseUrl: MEDIAFLOW_RELEASE_BASE_URL,
      openRouterTitle: 'MediaFlow',
    },
    mediaflow: {
      baseUrl: debugBuild ? MEDIAFLOW_DEVELOPMENT_BASE_URL : MEDIAFLOW_RELEASE_BASE_URL,
      allowBaseUrlOverride: debugBuild,
    },
    providers: {
      deepgram: {
        baseUrl: PROVIDER_BASE_URLS.deepgram,
      },
      openai: {
        baseUrl: PROVIDER_BASE_URLS.openai,
      },
      anthropic: {
        baseUrl: PROVIDER_BASE_URLS.anthropic,
      },
      google: {
        baseUrl: PROVIDER_BASE_URLS.google,
      },
      openrouter: {
        baseUrl: PROVIDER_BASE_URLS.openrouter,
      },
    },
  };
}
