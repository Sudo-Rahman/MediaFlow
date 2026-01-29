/**
 * Whisper service for audio transcription
 * Interfaces with whisper.cpp via Tauri commands
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { 
  TranscriptionConfig, 
  WhisperModel, 
  AudioFile,
  TranscriptionResult 
} from '$lib/types';

// ============================================================================
// WHISPER INSTALLATION CHECK
// ============================================================================

/**
 * Check if whisper.cpp is installed on the system
 */
export async function checkWhisperInstalled(): Promise<boolean> {
  try {
    return await invoke<boolean>('check_whisper');
  } catch {
    return false;
  }
}

/**
 * Get whisper.cpp version string
 */
export async function getWhisperVersion(): Promise<string | null> {
  try {
    return await invoke<string>('get_whisper_version');
  } catch {
    return null;
  }
}

// ============================================================================
// MODEL MANAGEMENT
// ============================================================================

/**
 * List all downloaded whisper models
 * Returns file names like 'ggml-small.bin'
 */
export async function listDownloadedModels(): Promise<string[]> {
  try {
    return await invoke<string[]>('list_whisper_models');
  } catch {
    return [];
  }
}

/**
 * Get the path where models are stored
 */
export async function getModelsPath(): Promise<string> {
  return invoke<string>('get_whisper_models_path');
}

/**
 * Download a whisper model
 * @param model The model ID to download (e.g., 'small', 'medium', 'large-v3')
 * @param onProgress Callback for download progress (0-100)
 */
export async function downloadModel(
  model: string,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; error?: string }> {
  // Listen for download progress events
  const unlisten = await listen<{ progress: number; model: string }>(
    'whisper-download-progress', 
    (event) => {
      if (event.payload.model === model) {
        onProgress?.(event.payload.progress);
      }
    }
  );

  try {
    await invoke('download_whisper_model', { model });
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  } finally {
    unlisten();
  }
}

/**
 * Cancel an ongoing model download
 */
export async function cancelModelDownload(model: string): Promise<void> {
  try {
    await invoke('cancel_whisper_download', { model });
  } catch {
    // Ignore errors on cancel
  }
}

/**
 * Delete a downloaded model
 * @param modelFile The model filename (e.g., 'ggml-small.bin') or model ID (e.g., 'small')
 */
export async function deleteModel(modelFile: string): Promise<{ success: boolean; error?: string }> {
  // Extract model ID from filename if needed
  const model = modelFile.replace('ggml-', '').replace('.bin', '');
  try {
    await invoke('delete_whisper_model', { model });
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

// ============================================================================
// AUDIO FILE PROBING
// ============================================================================

/**
 * Probe an audio file to get its metadata
 * Uses FFprobe under the hood
 */
export async function probeAudioFile(path: string): Promise<Partial<AudioFile>> {
  try {
    const result = await invoke<string>('probe_file', { path });
    const data = JSON.parse(result);
    
    // Find audio stream
    const audioStream = data.streams?.find((s: any) => s.codec_type === 'audio');
    const format = data.format;
    
    return {
      duration: format?.duration ? parseFloat(format.duration) : undefined,
      format: audioStream?.codec_name,
      sampleRate: audioStream?.sample_rate ? parseInt(audioStream.sample_rate) : undefined,
      channels: audioStream?.channels,
      bitrate: format?.bit_rate ? parseInt(format.bit_rate) : undefined,
      size: format?.size ? parseInt(format.size) : undefined
    };
  } catch (error) {
    console.error('Failed to probe audio file:', error);
    return {};
  }
}

/**
 * Probe multiple audio files
 */
export async function probeAudioFiles(
  paths: string[],
  onFileProbed?: (path: string, data: Partial<AudioFile>) => void
): Promise<Map<string, Partial<AudioFile>>> {
  const results = new Map<string, Partial<AudioFile>>();
  
  for (const path of paths) {
    const data = await probeAudioFile(path);
    results.set(path, data);
    onFileProbed?.(path, data);
  }
  
  return results;
}

// ============================================================================
// TRANSCRIPTION
// ============================================================================

/**
 * Transcribe an audio file to subtitles
 * @param audioPath Path to the audio file
 * @param outputDir Directory to save the subtitle file
 * @param config Transcription configuration
 * @param onProgress Callback for transcription progress (0-100)
 */
export async function transcribeAudio(
  audioPath: string,
  outputDir: string,
  config: TranscriptionConfig,
  onProgress?: (progress: number, segment?: string) => void
): Promise<TranscriptionResult> {
  // Listen for transcription progress events
  const unlisten = await listen<{ 
    progress: number; 
    audioPath: string;
    segment?: string;
  }>(
    'whisper-transcribe-progress', 
    (event) => {
      if (event.payload.audioPath === audioPath) {
        onProgress?.(event.payload.progress, event.payload.segment);
      }
    }
  );

  const startTime = Date.now();

  try {
    const outputPath = await invoke<string>('transcribe_audio', {
      audioPath,
      outputDir,
      model: config.model,
      language: config.language,
      outputFormat: config.outputFormat,
      wordTimestamps: config.wordTimestamps,
      translate: config.translate,
      maxSegmentLength: config.maxSegmentLength
    });

    const duration = (Date.now() - startTime) / 1000;

    return { 
      success: true, 
      outputPath,
      duration 
    };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  } finally {
    unlisten();
  }
}

/**
 * Transcribe multiple audio files
 */
export async function transcribeMultiple(
  files: { id: string; path: string }[],
  outputDir: string,
  config: TranscriptionConfig,
  callbacks?: {
    onFileStart?: (id: string) => void;
    onFileProgress?: (id: string, progress: number) => void;
    onFileComplete?: (id: string, result: TranscriptionResult) => void;
  }
): Promise<Map<string, TranscriptionResult>> {
  const results = new Map<string, TranscriptionResult>();

  for (const file of files) {
    callbacks?.onFileStart?.(file.id);

    const result = await transcribeAudio(
      file.path,
      outputDir,
      config,
      (progress) => callbacks?.onFileProgress?.(file.id, progress)
    );

    results.set(file.id, result);
    callbacks?.onFileComplete?.(file.id, result);
  }

  return results;
}

/**
 * Cancel an ongoing transcription
 */
export async function cancelTranscription(): Promise<void> {
  try {
    await invoke('cancel_transcription');
  } catch {
    // Ignore errors on cancel
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Get the output filename for a transcribed file
 */
export function getOutputFilename(
  audioPath: string, 
  format: TranscriptionConfig['outputFormat']
): string {
  const baseName = audioPath.split('/').pop()?.split('\\').pop() || 'output';
  const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '');
  return `${nameWithoutExt}.${format}`;
}

/**
 * Estimate transcription time based on audio duration and model
 * Returns estimated time in seconds
 */
export function estimateTranscriptionTime(
  durationSeconds: number,
  model: WhisperModel
): number {
  // Rough estimates based on model speed
  // These are approximate and depend on hardware
  const speedFactors: Record<WhisperModel, number> = {
    'tiny': 0.1,
    'tiny.en': 0.1,
    'base': 0.15,
    'base.en': 0.15,
    'small': 0.3,
    'small.en': 0.3,
    'medium': 0.6,
    'medium.en': 0.6,
    'large-v1': 1.0,
    'large-v2': 1.0,
    'large-v3': 1.0,
    'large-v3-turbo': 0.4,
  };

  const factor = speedFactors[model] || 1.0;
  return durationSeconds * factor;
}
