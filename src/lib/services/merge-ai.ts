import { settingsStore } from '$lib/stores';
import { LLM_PROVIDERS } from '$lib/types';
import type {
  ImportedTrack,
  MergeAiSuggestion,
  MergeTrack,
  MergeVideoFile,
  LLMProvider,
} from '$lib/types';

import { type ScannedFile, scanFiles } from './ffprobe';
import { callLlm } from './llm-client';
import {
  buildMergeAiPromptPayload,
  createMergeAiPromptIdMaps,
  mapMergeAiPromptMatchesToRealIds,
  normalizeMergeAiName,
  parseAndValidateMergeAiResponse,
  validateMergeAiSemanticMatches,
  type MergeAiCandidateTrack,
  type MergeAiCandidateVideo,
  type MergeAiPromptIdMaps,
  type MergeAiProbeSummary,
  type MergeAiTrackSummary,
  type MergeAiValidatedMatch,
} from './merge-ai-core';

function summarizeTrack(track: {
  type: string;
  codec?: string;
  language?: string;
  title?: string;
  default?: boolean;
  forced?: boolean;
}): MergeAiTrackSummary {
  return {
    type: track.type,
    codec: track.codec,
    language: track.language || undefined,
    title: track.title || undefined,
    default: track.default || undefined,
    forced: track.forced || undefined,
  };
}

function buildVideoCandidate(video: MergeVideoFile): MergeAiCandidateVideo {
  return {
    id: video.id,
    filename: video.name,
    normalizedBasename: normalizeMergeAiName(video.name),
    seasonNumber: video.seasonNumber,
    episodeNumber: video.episodeNumber,
    duration: video.duration,
    size: video.size,
    sourceTrackSummary: video.tracks.map((track: MergeTrack) => summarizeTrack(track)),
  };
}

function buildProbeSummary(scanned?: ScannedFile): MergeAiProbeSummary {
  if (!scanned) {
    return {
      status: 'unavailable',
      tracks: [],
    };
  }

  if (scanned.status === 'error') {
    return {
      status: 'error',
      tracks: [],
      error: scanned.error,
    };
  }

  return {
    status: 'ready',
    format: scanned.format,
    duration: scanned.duration,
    size: scanned.size,
    tracks: scanned.tracks.map(track => summarizeTrack(track)),
  };
}

function buildTrackCandidate(track: ImportedTrack, scanned?: ScannedFile): MergeAiCandidateTrack {
  const language = track.config.language ?? track.language;
  const title = track.config.title ?? track.title;
  const defaultValue = track.config.default;
  const forcedValue = track.config.forced;

  return {
    id: track.id,
    filename: track.name,
    normalizedBasename: normalizeMergeAiName(track.name),
    type: track.type,
    codec: track.codec,
    language: language || undefined,
    title: title || undefined,
    default: defaultValue || undefined,
    forced: forcedValue || undefined,
    seasonNumber: track.seasonNumber,
    episodeNumber: track.episodeNumber,
    probe: buildProbeSummary(scanned),
  };
}

function buildMergeAiSystemPrompt(): string {
  return [
    'You are MediaFlow, an assistant for matching imported external tracks to source video files in the Merge tool.',
    'Your job is only to decide which imported track should attach to which source video.',
    'Return valid JSON only.',
    'Each imported track must appear at most once in the output.',
    'A source video may receive multiple tracks.',
    'If you are unsure, return videoId as null instead of guessing.',
    'Prefer exact season/episode matches first, then normalized filename similarity, then language/title/codec and probe metadata clues.',
    'Never invent or alter ids.',
    'Expected JSON schema:',
    '{"matches":[{"trackId":string,"videoId":string|null,"confidence":"high"|"medium"|"low","reason":string}]}',
  ].join('\n');
}

function buildMergeAiUserPrompt(
  videos: MergeAiCandidateVideo[],
  tracks: MergeAiCandidateTrack[],
  idMaps: MergeAiPromptIdMaps,
): string {
  const payload = buildMergeAiPromptPayload(videos, tracks, idMaps);

  return [
    'Match each imported track to the best source video, if any.',
    'Return every imported track exactly once in the matches array.',
    'Use videoId: null when the match is ambiguous or unsupported.',
    'Use only the short ids present in the payload, such as v001 and t001.',
    'Do not include commentary outside the JSON response.',
    '',
    'Payload JSON:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

async function probeImportedTracks(tracks: ImportedTrack[]): Promise<Map<string, ScannedFile>> {
  if (tracks.length === 0) {
    return new Map();
  }

  const scannedFiles = await scanFiles(
    tracks.map(track => track.path),
    2,
  );

  return new Map(scannedFiles.map(scanned => [scanned.path, scanned]));
}

export interface AnalyzeMergeAiMatchesOptions {
  videos: MergeVideoFile[];
  tracks: ImportedTrack[];
  provider: LLMProvider;
  model: string;
  signal?: AbortSignal;
}

export interface AnalyzeMergeAiMatchesResult {
  suggestions: MergeAiSuggestion[];
  warnings: string[];
}

function buildSuggestionsFromMatches(
  tracks: ImportedTrack[],
  matches: MergeAiValidatedMatch[],
): MergeAiSuggestion[] {
  const matchByTrackId = new Map(matches.map(match => [match.trackId, match]));

  return tracks.map(track => {
    const match = matchByTrackId.get(track.id);
    return {
      trackId: track.id,
      videoId: match?.videoId ?? null,
      confidence: match?.confidence ?? 'low',
      reason: match?.reason ?? 'The AI did not return a match for this track.',
      selected: match?.videoId !== null,
    };
  });
}

export async function analyzeMergeAiMatches(
  options: AnalyzeMergeAiMatchesOptions,
): Promise<AnalyzeMergeAiMatchesResult> {
  const warnings: string[] = [];

  const providerName = LLM_PROVIDERS[options.provider]?.name || options.provider;
  const apiKey = settingsStore.getLLMApiKey(options.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${providerName}`);
  }

  if (!options.model.trim()) {
    throw new Error('Select an AI model before running Auto-match AI');
  }

  const probeByPath = await probeImportedTracks(options.tracks);
  const videoCandidates = options.videos.map(buildVideoCandidate);
  const trackCandidates = options.tracks.map(track => buildTrackCandidate(track, probeByPath.get(track.path)));
  const idMaps = createMergeAiPromptIdMaps(videoCandidates, trackCandidates);

  const llmResponse = await callLlm({
    provider: options.provider,
    apiKey,
    model: options.model,
    systemPrompt: buildMergeAiSystemPrompt(),
    userPrompt: buildMergeAiUserPrompt(videoCandidates, trackCandidates, idMaps),
    responseMode: 'json',
    temperature: 0,
    signal: options.signal,
    logSource: 'merge',
  });

  if (llmResponse.cancelled) {
    throw new Error('AI auto-match cancelled');
  }

  if (llmResponse.error) {
    throw new Error(llmResponse.error);
  }

  const parsedMatches = parseAndValidateMergeAiResponse(
    llmResponse.content,
    idMaps.realTrackIdByPromptId.keys(),
    idMaps.realVideoIdByPromptId.keys(),
  );
  warnings.push(...parsedMatches.warnings);

  const realAiMatches = mapMergeAiPromptMatchesToRealIds(parsedMatches.matches, idMaps);
  const semanticResult = validateMergeAiSemanticMatches(realAiMatches, options.tracks, options.videos);
  warnings.push(...semanticResult.warnings);

  return {
    suggestions: buildSuggestionsFromMatches(
      options.tracks,
      semanticResult.matches,
    ),
    warnings,
  };
}
