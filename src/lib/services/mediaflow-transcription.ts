import { invoke } from '@tauri-apps/api/core';
import { logStore } from '$lib/stores/logs.svelte';
import { mediaflowUsageStore } from '$lib/stores/mediaflow-usage.svelte';
import type { DeepgramAPIResponse, DeepgramConfig, DeepgramResult } from '$lib/types';
import { getMediaFlowAccessToken, refreshMediaFlowSession } from './mediaflow-auth';
import {
  attachTranscriptionUploadCancel,
  createTranscriptionRequestId,
  errorToMessage,
  isTranscriptionCancelledError,
  processDeepgramResponse,
  type TranscribeResult,
  type TranscriptionUploadResponse,
} from './deepgram';
import { normalizeMediaFlowError } from './mediaflow-errors';
import { withSleepInhibit } from './sleep-inhibit';

export interface MediaFlowTranscribeOptions {
  audioPath: string;
  config: DeepgramConfig;
  onProgress?: (progress: number, phase: 'uploading' | 'processing') => void;
  signal?: AbortSignal;
}

interface MediaFlowTranscriptionResponse {
  transcript?: string;
  words?: unknown;
  utterances?: unknown;
  metadata?: {
    request_id?: string;
    duration?: number;
  };
}

function normalizedToDeepgramResponse(body: MediaFlowTranscriptionResponse): DeepgramAPIResponse {
  const words = Array.isArray(body.words)
    ? body.words as DeepgramAPIResponse['results']['channels'][number]['alternatives'][number]['words']
    : [];

  return {
    metadata: {
      transaction_key: '',
      request_id: body.metadata?.request_id ?? '',
      sha256: '',
      created: new Date().toISOString(),
      duration: Number(body.metadata?.duration ?? 0),
      channels: 1,
      models: ['Nova 3'],
      model_info: {},
    },
    results: {
      channels: [
        {
          alternatives: [
            {
              transcript: body.transcript ?? '',
              confidence: 0,
              words,
            },
          ],
        },
      ],
      utterances: Array.isArray(body.utterances)
        ? body.utterances as DeepgramAPIResponse['results']['utterances']
        : undefined,
    },
  };
}

export async function transcribeWithMediaFlow(options: MediaFlowTranscribeOptions): Promise<TranscribeResult> {
  const { audioPath, config, onProgress, signal } = options;

  if (signal?.aborted) {
    return { success: false, error: 'Transcription cancelled' };
  }

  return withSleepInhibit('MediaFlow: Transcription', async () => {
    const requestId = createTranscriptionRequestId('mediaflow');
    const detachCancel = attachTranscriptionUploadCancel(signal, requestId);

    try {
      onProgress?.(5, 'uploading');
      onProgress?.(15, 'uploading');

      logStore.addLog({
        level: 'info',
        source: 'mediaflow',
        title: 'MediaFlow transcription started',
        details: `Language: ${config.language}`,
        context: { filePath: audioPath },
      });

      const transcribeWithToken = (accessToken: string) =>
        invoke<TranscriptionUploadResponse>('transcribe_mediaflow_audio_file', {
          requestId,
          audioPath,
          config,
          accessToken,
        });

      let response = await transcribeWithToken(await getMediaFlowAccessToken());
      if (response.status === 401 && !signal?.aborted) {
        const refreshedToken = await refreshMediaFlowSession();
        if (signal?.aborted) {
          return { success: false, error: 'Transcription cancelled' };
        }
        response = await transcribeWithToken(refreshedToken);
      }

      if (signal?.aborted) {
        return { success: false, error: 'Transcription cancelled' };
      }

      onProgress?.(50, 'processing');

      if (response.status < 200 || response.status >= 300) {
        const normalizedError = normalizeMediaFlowError({
          status: response.status,
          error: response.body,
          technicalError: response.body,
        });
        logStore.addLog({
          level: normalizedError.severity,
          source: 'mediaflow',
          title: normalizedError.title,
          details: normalizedError.details,
          context: {
            filePath: audioPath,
            provider: 'mediaflow',
            apiError: response.body,
            ...(normalizedError.status ? { apiStatus: String(normalizedError.status) } : {}),
            ...(normalizedError.code ? { apiCode: normalizedError.code } : {}),
            ...(normalizedError.requestId ? { requestId: normalizedError.requestId } : {}),
            ...(normalizedError.retryAfter ? { retryAfter: String(normalizedError.retryAfter) } : {}),
            userAction: normalizedError.action,
            ...(normalizedError.backendMessage ? { technicalDetails: normalizedError.backendMessage } : {}),
          },
        });
        return { success: false, error: normalizedError.message };
      }

      mediaflowUsageStore.scheduleRefresh();
      const data = JSON.parse(response.body) as MediaFlowTranscriptionResponse;
      const result: DeepgramResult = processDeepgramResponse(normalizedToDeepgramResponse(data));

      if (result.transcript.trim().length === 0 && result.phrases.length === 0) {
        const words = Array.isArray(data.words) ? data.words.length : 0;
        const utterances = Array.isArray(data.utterances) ? data.utterances.length : 0;
        const duration = Math.round(data.metadata?.duration ?? 0);
        logStore.addLog({
          level: 'error',
          source: 'mediaflow',
          title: 'MediaFlow transcription returned no text',
          details: `Request: ${data.metadata?.request_id ?? 'unknown'}, duration: ${duration}s, words: ${words}, utterances: ${utterances}`,
          context: { filePath: audioPath },
        });
        return {
          success: false,
          error: 'MediaFlow returned an empty transcription. Check server Deepgram response logs.',
        };
      }

      onProgress?.(100, 'processing');
      logStore.addLog({
        level: 'success',
        source: 'mediaflow',
        title: 'MediaFlow transcription complete',
        details: `Duration: ${Math.round(result.duration)}s, transcript: ${result.transcript.trim().length} chars, phrases: ${result.phrases.length}`,
        context: { filePath: audioPath },
      });

      return { success: true, result };
    } catch (error) {
      if (isTranscriptionCancelledError(error)) {
        return { success: false, error: 'Transcription cancelled' };
      }

      const errorMessage = errorToMessage(error, 'Transcription failed');
      logStore.addLog({
        level: 'error',
        source: 'mediaflow',
        title: 'MediaFlow transcription failed',
        details: errorMessage,
        context: { filePath: audioPath },
      });
      return { success: false, error: errorMessage };
    } finally {
      detachCancel();
    }
  });
}
