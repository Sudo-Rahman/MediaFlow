declare global {
  const __MEDIAFLOW_API_CONFIG__: {
    build: {
      isDebugBuild: boolean;
    };
    app: {
      publicBaseUrl: string;
      openRouterTitle: string;
    };
    mediaflow: {
      baseUrl: string;
      allowBaseUrlOverride: boolean;
    };
    providers: {
      deepgram: {
        baseUrl: string;
      };
      openai: {
        baseUrl: string;
      };
      anthropic: {
        baseUrl: string;
      };
      google: {
        baseUrl: string;
      };
      openrouter: {
        baseUrl: string;
      };
    };
  };
}

export {};
