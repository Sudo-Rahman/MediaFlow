import { readFile } from '@tauri-apps/plugin-fs';

import { settingsStore } from '$lib/stores';
import type {
  Track,
  TranscodeAdditionalArg,
  TranscodeAiIntent,
  TranscodeAiErrorResponse,
  TranscodeAiRecommendation,
  TranscodeAiSizePreference,
  TranscodeAiSuccessResponse,
  TranscodeAudioMode,
  TranscodeAudioTrackOverride,
  TranscodeCapabilities,
  TranscodeEncoderOption,
  TranscodeFile,
  TranscodeProfile,
} from '$lib/types';
import type { LLMProvider } from '$lib/types';
import { callLlm, type LlmContentPart } from './llm-client';
import {
  applySourceAwareRecommendation,
  buildReadableProbeSummary,
  clampTranscodeProfile,
  cloneAdditionalArgs,
  cloneTranscodeProfile,
  createTranscodeId,
  getAudioEncoderCapability,
  getEffectiveAudioSettingsForTrack,
  getSubtitleEncoderCapability,
  getTracksByType,
  getVideoEncoderCapability,
  getVideoPresetOptions,
  getVideoResolutionPresetOptions,
  scoreTranscodeEncoderOption,
} from './transcode';

const BLOCKED_AI_OVERRIDE_FLAGS = [
  '-i',
  '-map',
  '-progress',
  '-f',
  '-y',
  '-n',
  '-filter_complex',
  '-filter_script',
  '-vf',
  '-af',
] as const;

const BLOCKED_AI_OVERRIDE_FLAG_SET = new Set<string>(BLOCKED_AI_OVERRIDE_FLAGS);

const MAX_DETAILED_OPTIONS_PER_ENCODER = 48;
const MAX_OPTION_CHOICES = 12;

interface CompactEncoderOptionPayload {
  flag: string;
  valueKind: TranscodeEncoderOption['valueKind'];
  description?: string;
  defaultValue?: string;
  min?: number;
  max?: number;
  choices?: Array<{ value: string; description?: string }>;
}

interface CompactVideoEncoderPayload {
  id: string;
  codec: string;
  label: string;
  isHardware: boolean;
  supportedPixelFormats: string[];
  supportedProfiles: string[];
  supportedLevels: string[];
  supportedBitDepths: number[];
  rateControl: {
    supportsCrf: boolean;
    supportsQp: boolean;
    supportsBitrate: boolean;
  };
  presetControl?: {
    profileField: 'video.preset';
    ffmpegFlag: '-preset' | '-cpu-used';
    values: string[];
  };
  allowedOverrideFlags: string[];
  detailedOverrideOptions: CompactEncoderOptionPayload[];
}

interface CompactAudioEncoderPayload {
  id: string;
  codec: string;
  label: string;
  supportsBitrate: boolean;
  supportsChannels: boolean;
  supportsSampleRate: boolean;
  allowedOverrideFlags: string[];
  detailedOverrideOptions: CompactEncoderOptionPayload[];
}

interface CompactSubtitleEncoderPayload {
  id: string;
  codec: string;
  label: string;
  kind: string;
  allowedOverrideFlags: string[];
  detailedOverrideOptions: CompactEncoderOptionPayload[];
}

interface CompactTrackPayload {
  trackId: number;
  streamIndex: number;
  type: Track['type'];
  codec: string;
  profile?: string;
  language?: string;
  title?: string;
  bitrateKbps?: number;
  channels?: number;
  sampleRate?: number;
  channelLayout?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  pixelFormat?: string;
  bitDepth?: number;
  colorSpace?: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  default?: boolean;
  forced?: boolean;
}

export interface TranscodeAiCapabilityPayload {
  ffmpegVersion: string;
  hwaccels: string[];
  videoResolution: {
    supportsFit: true;
    allowsUpscale: true;
    behavior: 'fit_with_aspect_ratio_no_crop_no_pad';
    presets: Array<{
      value: string;
      label: string;
      maxWidth?: number;
      maxHeight?: number;
    }>;
  };
  overridePolicy: {
    allowedFlagsMustExistInSelectedEncoderOptions: true;
    overrideFlagsAreRuntimeDiscoveredFromEncoderOptions: true;
    detailedOptionsAreRankedFromEncoderOptionMetadata: true;
    manualOverridesArePreserved: true;
    responseAdditionalArgsNeedOnlyFlagValueEnabledReason: true;
    blockedFlags: string[];
  };
  containers: Array<{
    id: string;
    label: string;
    extension: string;
    kind: string;
    defaultVideoEncoderId?: string;
    defaultAudioEncoderId?: string;
    defaultSubtitleEncoderId?: string;
    supportedVideoEncoderIds: string[];
    supportedAudioEncoderIds: string[];
    supportedSubtitleEncoderIds: string[];
    supportedSubtitleModes: string[];
  }>;
  videoEncoders: CompactVideoEncoderPayload[];
  audioEncoders: CompactAudioEncoderPayload[];
  subtitleEncoders: CompactSubtitleEncoderPayload[];
  sourceTracks: {
    video: CompactTrackPayload[];
    audio: CompactTrackPayload[];
    subtitles: CompactTrackPayload[];
  };
}

export interface TranscodeAiProfileBuildResult {
  profile: TranscodeProfile;
  warnings: string[];
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function mimeTypeFromPath(path: string): string {
  if (path.toLowerCase().endsWith('.png')) {
    return 'image/png';
  }
  return 'image/jpeg';
}

async function buildImageContentParts(paths: string[]): Promise<LlmContentPart[]> {
  const parts: LlmContentPart[] = [];

  for (const path of paths) {
    const bytes = await readFile(path);
    parts.push({
      type: 'image',
      mimeType: mimeTypeFromPath(path),
      data: uint8ArrayToBase64(new Uint8Array(bytes)),
    });
  }

  return parts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function positiveIntValue(value: unknown): number | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function normalizeAdditionalArgValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : undefined;
  }
  if (typeof value === 'string') {
    return value.trim() ? value.trim() : undefined;
  }
  return undefined;
}

function normalizeAudioMode(value: unknown, fallback: TranscodeAudioMode): TranscodeAudioMode {
  return value === 'copy' || value === 'transcode' || value === 'disable'
    ? value
    : fallback;
}

function isBlockedOverrideFlag(flag: string): boolean {
  return BLOCKED_AI_OVERRIDE_FLAGS.some((blockedFlag) =>
    flag === blockedFlag || flag.startsWith(`${blockedFlag}:`),
  );
}

function optionChoicesPayload(option: TranscodeEncoderOption): CompactEncoderOptionPayload['choices'] {
  if (option.choices.length === 0) {
    return undefined;
  }

  return option.choices.slice(0, MAX_OPTION_CHOICES).map((choice) => ({
    value: choice.value,
    description: choice.description || undefined,
  }));
}

function compactEncoderOption(option: TranscodeEncoderOption): CompactEncoderOptionPayload {
  return {
    flag: option.flag,
    valueKind: option.valueKind,
    description: option.description || undefined,
    defaultValue: option.defaultValue,
    min: option.min,
    max: option.max,
    choices: optionChoicesPayload(option),
  };
}

function compactDetailedOptions(options: TranscodeEncoderOption[]): CompactEncoderOptionPayload[] {
  return options
    .filter((option) => !isBlockedOverrideFlag(option.flag))
    .map((option) => ({
      option,
      score: scoreTranscodeEncoderOption(option),
    }))
    .sort((left, right) =>
      right.score - left.score
      || left.option.flag.localeCompare(right.option.flag),
    )
    .slice(0, MAX_DETAILED_OPTIONS_PER_ENCODER)
    .map(({ option }) => compactEncoderOption(option));
}

function allowedOverrideFlags(options: TranscodeEncoderOption[]): string[] {
  return options
    .map((option) => option.flag)
    .filter((flag) => !BLOCKED_AI_OVERRIDE_FLAG_SET.has(flag) && !isBlockedOverrideFlag(flag))
    .sort((left, right) => left.localeCompare(right));
}

function videoPresetFlagForEncoder(encoderId: string): '-preset' | '-cpu-used' {
  return encoderId === 'libaom-av1' || encoderId === 'libvpx' || encoderId === 'libvpx-vp9'
    ? '-cpu-used'
    : '-preset';
}

function compactTrack(track: Track): CompactTrackPayload {
  return {
    trackId: track.id,
    streamIndex: track.index,
    type: track.type,
    codec: track.codec,
    profile: track.profile,
    language: track.language,
    title: track.title,
    bitrateKbps: track.bitrate ? Math.max(1, Math.round(track.bitrate / 1000)) : undefined,
    channels: track.channels,
    sampleRate: track.sampleRate,
    channelLayout: track.channelLayout,
    width: track.width,
    height: track.height,
    frameRate: track.frameRate,
    pixelFormat: track.pixelFormat,
    bitDepth: track.derivedBitDepth,
    colorSpace: track.colorSpace,
    colorTransfer: track.colorTransfer,
    colorPrimaries: track.colorPrimaries,
    default: track.default,
    forced: track.forced,
  };
}

function collectSupportedEncoderIds(
  containers: TranscodeCapabilities['containers'],
  key: 'supportedVideoEncoderIds' | 'supportedAudioEncoderIds' | 'supportedSubtitleEncoderIds',
): Set<string> {
  const ids = new Set<string>();
  for (const container of containers) {
    for (const id of container[key]) {
      ids.add(id);
    }
  }
  return ids;
}

export function buildTranscodeAiCapabilityPayload(
  file: Pick<TranscodeFile, 'hasVideo' | 'tracks'>,
  capabilities: TranscodeCapabilities,
): TranscodeAiCapabilityPayload {
  const containers = capabilities.containers.filter((container) =>
    file.hasVideo ? container.kind === 'video' : container.kind === 'audio',
  );
  const supportedVideoEncoderIds = collectSupportedEncoderIds(containers, 'supportedVideoEncoderIds');
  const supportedAudioEncoderIds = collectSupportedEncoderIds(containers, 'supportedAudioEncoderIds');
  const supportedSubtitleEncoderIds = collectSupportedEncoderIds(containers, 'supportedSubtitleEncoderIds');

  return {
    ffmpegVersion: capabilities.ffmpegVersion,
    hwaccels: capabilities.hwaccels,
    videoResolution: {
      supportsFit: true,
      allowsUpscale: true,
      behavior: 'fit_with_aspect_ratio_no_crop_no_pad',
      presets: getVideoResolutionPresetOptions()
        .filter((option) => option.value !== 'custom')
        .map((option) => ({
          value: option.value,
          label: option.label,
          maxWidth: option.resolution?.maxWidth,
          maxHeight: option.resolution?.maxHeight,
        })),
    },
    overridePolicy: {
      allowedFlagsMustExistInSelectedEncoderOptions: true,
      overrideFlagsAreRuntimeDiscoveredFromEncoderOptions: true,
      detailedOptionsAreRankedFromEncoderOptionMetadata: true,
      manualOverridesArePreserved: true,
      responseAdditionalArgsNeedOnlyFlagValueEnabledReason: true,
      blockedFlags: [...BLOCKED_AI_OVERRIDE_FLAGS],
    },
    containers: containers.map((container) => ({
      id: container.id,
      label: container.label,
      extension: container.extension,
      kind: container.kind,
      defaultVideoEncoderId: container.defaultVideoEncoderId,
      defaultAudioEncoderId: container.defaultAudioEncoderId,
      defaultSubtitleEncoderId: container.defaultSubtitleEncoderId,
      supportedVideoEncoderIds: container.supportedVideoEncoderIds,
      supportedAudioEncoderIds: container.supportedAudioEncoderIds,
      supportedSubtitleEncoderIds: container.supportedSubtitleEncoderIds,
      supportedSubtitleModes: container.supportedSubtitleModes,
    })),
    videoEncoders: capabilities.videoEncoders
      .filter((encoder) => supportedVideoEncoderIds.has(encoder.id))
      .map((encoder) => {
        const presetValues = getVideoPresetOptions(encoder.id).map((option) => option.value);
        return {
          id: encoder.id,
          codec: encoder.codec,
          label: encoder.label,
          isHardware: encoder.isHardware,
          supportedPixelFormats: encoder.supportedPixelFormats,
          supportedProfiles: encoder.supportedProfiles,
          supportedLevels: encoder.supportedLevels,
          supportedBitDepths: encoder.supportedBitDepths,
          rateControl: {
            supportsCrf: encoder.supportsCrf,
            supportsQp: encoder.supportsQp,
            supportsBitrate: encoder.supportsBitrate,
          },
          presetControl: presetValues.length > 0
            ? {
              profileField: 'video.preset' as const,
              ffmpegFlag: videoPresetFlagForEncoder(encoder.id),
              values: presetValues,
            }
            : undefined,
          allowedOverrideFlags: allowedOverrideFlags(encoder.options),
          detailedOverrideOptions: compactDetailedOptions(encoder.options),
        };
      }),
    audioEncoders: capabilities.audioEncoders
      .filter((encoder) => supportedAudioEncoderIds.has(encoder.id))
      .map((encoder) => ({
        id: encoder.id,
        codec: encoder.codec,
        label: encoder.label,
        supportsBitrate: encoder.supportsBitrate,
        supportsChannels: encoder.supportsChannels,
        supportsSampleRate: encoder.supportsSampleRate,
        allowedOverrideFlags: allowedOverrideFlags(encoder.options),
        detailedOverrideOptions: compactDetailedOptions(encoder.options),
      })),
    subtitleEncoders: capabilities.subtitleEncoders
      .filter((encoder) => supportedSubtitleEncoderIds.has(encoder.id))
      .map((encoder) => ({
        id: encoder.id,
        codec: encoder.codec,
        label: encoder.label,
        kind: encoder.kind,
        allowedOverrideFlags: allowedOverrideFlags(encoder.options),
        detailedOverrideOptions: compactDetailedOptions(encoder.options),
      })),
    sourceTracks: {
      video: getTracksByType(file, 'video').map(compactTrack),
      audio: getTracksByType(file, 'audio').map(compactTrack),
      subtitles: getTracksByType(file, 'subtitle').map(compactTrack),
    },
  };
}

function buildAiSystemPrompt(capabilityPayload: TranscodeAiCapabilityPayload): string {
  return [
    'You are MediaFlow, an expert FFmpeg transcoding assistant.',
    'Your scope is strictly limited to the Transcode tool in MediaFlow.',
    'Return valid JSON only.',
    '',
    'Use the requested optimization target as a decision framework:',
    '- speed: prefer available hardware encoders, copy compatible streams when that is faster and acceptable, and choose fast encoder presets.',
    '- quality: preserve visible detail, grain, bit depth, color metadata, and audio quality while staying practical.',
    '- archive: prefer durable containers and settings, avoid unnecessary generation loss, copy already-good streams when compatible, and avoid lossy-to-lossless upgrades.',
    '',
    'Also apply the requested size preference as a second independent axis:',
    '- minimum: pursue the smallest practical output while still respecting the optimization target; consider the most efficient current codecs, encoders, presets, and codec-specific options present in the payload, even when encoding is slower.',
    '- balanced: reduce size when there is a clear efficiency win, but avoid aggressive settings that create visible/audible compromises or disproportionate encode time.',
    '- no_compromise: do not optimize primarily for smaller files; prioritize source fidelity, compatibility, durability, and the optimization target over output size.',
    'Do not hard-code codec preferences. Decide from the actual containers, encoders, hardware support, encoder options, source properties, and selected target/size combination.',
    'For video resolution, use video.resolution.mode="source" to keep the original source size, or mode="fit" with maxWidth and/or maxHeight to scale inside a target size.',
    'Video resolution fit always preserves aspect ratio, never crops, and never pads. Upscaling is allowed only when the user explicitly requests a larger output resolution.',
    '',
    'Choose only containers, encoders, presets, modes, pixel formats, profiles, levels, and override flags present in the capability payload.',
    'Override flags in the payload are runtime-discovered from this machine FFmpeg encoder metadata; do not assume a flag exists if it is absent.',
    'Additional FFmpeg flags may be recommended only through additionalArgs, and each flag must exist in the selected encoder option list for that stream.',
    'Never emit blocked global controls such as -i, -map, -progress, -f, -y, -n, -filter_complex, -filter_script, -vf, or -af.',
    'For audio, treat each source audio track independently. Use audio.trackOverrides when tracks need different modes, encoders, bitrates, channels, sample rates, or override flags.',
    'Never recommend a lossless or higher-fidelity audio target when the source audio track is already lossy.',
    'Do not increase audio bitrate, channels, or sample rate beyond each source audio track unless required for compatibility.',
    'Subtitle strategy rules: use "copy", "convert_text", or "disable". Image subtitles must remain copy or disable.',
    'If the optional user instruction is unrelated to transcoding or output configuration, return the out_of_scope JSON error instead of a profile.',
    '',
    'Machine capability payload JSON:',
    JSON.stringify(capabilityPayload, null, 2),
    '',
    'JSON schema:',
    '{"status":"ok","containerId":string,"video":{"mode":"copy|transcode|disable","encoderId"?:string,"profile"?:string,"level"?:string,"pixelFormat"?:string,"qualityMode":"crf|bitrate|qp","crf"?:number,"qp"?:number,"bitrateKbps"?:number,"preset"?:string,"resolution"?:{"mode":"source|fit","maxWidth"?:number,"maxHeight"?:number},"additionalArgs"?:Array<{"flag":string,"value"?:string|number|boolean,"enabled"?:boolean,"reason"?:string}>},"audio":{"mode":"copy|transcode|disable","encoderId"?:string,"bitrateKbps"?:number,"channels"?:number,"sampleRate"?:number,"additionalArgs"?:Array<{"flag":string,"value"?:string|number|boolean,"enabled"?:boolean,"reason"?:string}>,"trackOverrides"?:Array<{"trackId":number,"mode":"copy|transcode|disable","encoderId"?:string,"bitrateKbps"?:number,"channels"?:number,"sampleRate"?:number,"additionalArgs"?:Array<{"flag":string,"value"?:string|number|boolean,"enabled"?:boolean,"reason"?:string}>,"reason"?:string}>},"subtitles":{"mode":"copy|convert_text|disable","encoderId"?:string,"additionalArgs"?:Array<{"flag":string,"value"?:string|number|boolean,"enabled"?:boolean,"reason"?:string}>},"rationale":string,"warnings"?:string[]}',
    '{"status":"error","errorCode":"out_of_scope","errorMessage":string}',
  ].join('\n');
}

function buildAiTextPrompt(
  file: TranscodeFile,
  intent: TranscodeAiIntent,
  sizePreference: TranscodeAiSizePreference,
  userInstruction?: string,
): string {
  return [
    `Optimization target: ${intent}`,
    `Size preference: ${sizePreference}`,
    '',
    'Analysis frames:',
    '- 6 full-resolution, lossless PNG screenshots are attached below this prompt.',
    '- Use them to judge grain/noise, animation vs live action, dark scenes, gradients, compression artifacts, and texture complexity.',
    '',
    'Optional user instruction:',
    userInstruction?.trim() ? userInstruction.trim() : 'None provided.',
    '',
    'FFprobe summary:',
    buildReadableProbeSummary(file),
    '',
    'Current MediaFlow profile JSON:',
    JSON.stringify(file.profile, null, 2),
    '',
    'Instructions:',
    '- Recommend one complete practical profile for this source file.',
    '- Treat optimization target and size preference as separate requirements; explain the tradeoff briefly in the rationale.',
    '- Keep video.resolution.mode as "source" unless resizing is useful for the target; if resizing, use "fit" with maxWidth and/or maxHeight.',
    '- Keep user/manual overrides conceptually separate from AI overrides; the app will preserve manual overrides automatically.',
    '- For additionalArgs, return only flag/value/enabled/reason. Do not invent ids or source fields.',
    '- Use audio.trackOverrides only for specific audio tracks that should differ from the global audio setting.',
    '- If the source is audio-only, disable video and use an audio container.',
    '- If the optional user instruction is unrelated to transcoding or output configuration, return the out_of_scope JSON error instead of a profile.',
  ].join('\n');
}

function normalizeAiWarnings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0)
    : [];
}

function sanitizeAiAdditionalArgs(
  existingArgs: TranscodeAdditionalArg[],
  aiArgsValue: unknown,
  encoderOptions: TranscodeEncoderOption[],
  scopeLabel: string,
  warnings: string[],
): TranscodeAdditionalArg[] {
  const manualArgs = cloneAdditionalArgs(existingArgs).filter((arg) => arg.source !== 'ai');
  if (!Array.isArray(aiArgsValue)) {
    return manualArgs;
  }

  const allowedFlags = new Set(encoderOptions.map((option) => option.flag));
  const aiArgs: TranscodeAdditionalArg[] = [];

  for (const [index, rawArg] of aiArgsValue.entries()) {
    const arg = getRecord(rawArg);
    const flag = stringValue(arg.flag);
    if (!flag) {
      warnings.push(`Ignored ${scopeLabel} AI override ${index + 1}: missing flag.`);
      continue;
    }

    if (isBlockedOverrideFlag(flag)) {
      warnings.push(`Ignored ${scopeLabel} AI override ${flag}: blocked FFmpeg control flag.`);
      continue;
    }

    if (!allowedFlags.has(flag)) {
      warnings.push(`Ignored ${scopeLabel} AI override ${flag}: flag is not exposed by the selected encoder.`);
      continue;
    }

    aiArgs.push({
      id: createTranscodeId('transcode-arg-ai'),
      flag,
      value: normalizeAdditionalArgValue(arg.value),
      enabled: arg.enabled !== false,
      source: 'ai',
      reason: stringValue(arg.reason),
    });
  }

  return [...manualArgs, ...aiArgs];
}

function buildAiAudioTrackOverrides(
  existingOverrides: TranscodeAudioTrackOverride[],
  aiOverridesValue: unknown,
  globalAudioSettings: TranscodeProfile['audio'],
  capabilities: TranscodeCapabilities,
  file: Pick<TranscodeFile, 'tracks'>,
  warnings: string[],
): TranscodeAudioTrackOverride[] {
  const manualOverrides = existingOverrides
    .filter((trackOverride) => trackOverride.source !== 'ai')
    .map((trackOverride) => ({
      ...trackOverride,
      additionalArgs: cloneAdditionalArgs(trackOverride.additionalArgs ?? []),
    }));

  if (!Array.isArray(aiOverridesValue)) {
    return manualOverrides;
  }

  const audioTracks = getTracksByType(file, 'audio');
  const trackById = new Map(audioTracks.map((track) => [track.id, track]));
  const manualTrackIds = new Set(manualOverrides.map((trackOverride) => trackOverride.trackId));
  const aiOverrides: TranscodeAudioTrackOverride[] = [];

  for (const [index, rawOverride] of aiOverridesValue.entries()) {
    const override = getRecord(rawOverride);
    const trackId = positiveIntValue(override.trackId);
    if (trackId === undefined || !trackById.has(trackId)) {
      warnings.push(`Ignored AI audio track override ${index + 1}: unknown trackId.`);
      continue;
    }

    if (manualTrackIds.has(trackId)) {
      warnings.push(`Ignored AI audio track override for track ${trackId}: a manual override already exists.`);
      continue;
    }

    const inheritedSettings = getEffectiveAudioSettingsForTrack(globalAudioSettings, trackId);
    const mode = normalizeAudioMode(override.mode, inheritedSettings.mode);
    const encoderId = mode === 'transcode'
      ? stringValue(override.encoderId) ?? inheritedSettings.encoderId
      : undefined;
    const encoder = getAudioEncoderCapability(capabilities, encoderId);
    const additionalArgs = mode === 'transcode'
      ? sanitizeAiAdditionalArgs(
        [],
        override.additionalArgs,
        encoder?.options ?? [],
        `audio track ${trackId}`,
        warnings,
      )
      : [];

    aiOverrides.push({
      trackId,
      mode,
      encoderId,
      bitrateKbps: mode === 'transcode' ? positiveIntValue(override.bitrateKbps) ?? inheritedSettings.bitrateKbps : undefined,
      channels: mode === 'transcode' ? positiveIntValue(override.channels) ?? inheritedSettings.channels : undefined,
      sampleRate: mode === 'transcode' ? positiveIntValue(override.sampleRate) ?? inheritedSettings.sampleRate : undefined,
      additionalArgs,
      source: 'ai',
      reason: stringValue(override.reason),
    });
  }

  return [...manualOverrides, ...aiOverrides];
}

export function sanitizeTranscodeAiProfileResponse(
  response: TranscodeAiSuccessResponse,
  file: TranscodeFile,
  capabilities: TranscodeCapabilities,
): TranscodeAiProfileBuildResult {
  const warnings = normalizeAiWarnings(response.warnings);
  const currentProfile = cloneTranscodeProfile(file.profile);
  const videoResponse = getRecord(response.video);
  const audioResponse = getRecord(response.audio);
  const subtitlesResponse = getRecord(response.subtitles);
  const preliminaryAudio: TranscodeProfile['audio'] = {
    ...currentProfile.audio,
    ...(audioResponse as Partial<TranscodeProfile['audio']>),
    additionalArgs: currentProfile.audio.additionalArgs,
    trackOverrides: [],
  };

  preliminaryAudio.trackOverrides = buildAiAudioTrackOverrides(
    currentProfile.audio.trackOverrides,
    audioResponse.trackOverrides,
    preliminaryAudio,
    capabilities,
    file,
    warnings,
  );

  const preliminaryProfile = clampTranscodeProfile({
    ...currentProfile,
    containerId: response.containerId,
    video: {
      ...currentProfile.video,
      ...(videoResponse as Partial<TranscodeProfile['video']>),
      additionalArgs: currentProfile.video.additionalArgs,
    },
    audio: preliminaryAudio,
    subtitles: {
      ...currentProfile.subtitles,
      ...(subtitlesResponse as Partial<TranscodeProfile['subtitles']>),
      additionalArgs: currentProfile.subtitles.additionalArgs,
    },
  }, capabilities, file);

  const sourceAwareProfile = applySourceAwareRecommendation(preliminaryProfile, capabilities, file);
  const mergedProfile = cloneTranscodeProfile(sourceAwareProfile);
  const videoEncoder = getVideoEncoderCapability(capabilities, mergedProfile.video.encoderId);
  const audioEncoder = getAudioEncoderCapability(capabilities, mergedProfile.audio.encoderId);
  const subtitleEncoder = getSubtitleEncoderCapability(capabilities, mergedProfile.subtitles.encoderId);

  mergedProfile.video.additionalArgs = mergedProfile.video.mode === 'transcode'
    ? sanitizeAiAdditionalArgs(
      currentProfile.video.additionalArgs,
      videoResponse.additionalArgs,
      videoEncoder?.options ?? [],
      'video',
      warnings,
    )
    : currentProfile.video.additionalArgs.filter((arg) => arg.source !== 'ai');

  mergedProfile.audio.additionalArgs = mergedProfile.audio.mode === 'transcode'
    ? sanitizeAiAdditionalArgs(
      currentProfile.audio.additionalArgs,
      audioResponse.additionalArgs,
      audioEncoder?.options ?? [],
      'audio',
      warnings,
    )
    : currentProfile.audio.additionalArgs.filter((arg) => arg.source !== 'ai');

  mergedProfile.subtitles.additionalArgs = mergedProfile.subtitles.mode === 'convert_text'
    ? sanitizeAiAdditionalArgs(
      currentProfile.subtitles.additionalArgs,
      subtitlesResponse.additionalArgs,
      subtitleEncoder?.options ?? [],
      'subtitle',
      warnings,
    )
    : currentProfile.subtitles.additionalArgs.filter((arg) => arg.source !== 'ai');

  return {
    profile: clampTranscodeProfile(mergedProfile, capabilities, file),
    warnings,
  };
}

function isAiErrorResponse(value: unknown): value is TranscodeAiErrorResponse {
  return value !== null
    && typeof value === 'object'
    && 'status' in value
    && (value as { status?: unknown }).status === 'error'
    && (value as { errorCode?: unknown }).errorCode === 'out_of_scope'
    && typeof (value as { errorMessage?: unknown }).errorMessage === 'string';
}

function isAiSuccessResponse(value: unknown): value is TranscodeAiSuccessResponse {
  return value !== null
    && typeof value === 'object'
    && 'status' in value
    && (value as { status?: unknown }).status === 'ok'
    && typeof (value as { containerId?: unknown }).containerId === 'string';
}

export interface AnalyzeTranscodeProfileOptions {
  file: TranscodeFile;
  capabilities: TranscodeCapabilities;
  provider: LLMProvider;
  model: string;
  intent: TranscodeAiIntent;
  sizePreference: TranscodeAiSizePreference;
  userInstruction?: string;
  signal?: AbortSignal;
}

export async function analyzeTranscodeProfile(
  options: AnalyzeTranscodeProfileOptions,
): Promise<TranscodeAiRecommendation> {
  const apiKey = settingsStore.getLLMApiKey(options.provider);
  if (!apiKey) {
    throw new Error(`No API key configured for ${options.provider}`);
  }

  const imageParts = await buildImageContentParts(options.file.analysisFrames.slice(0, 6));
  const capabilityPayload = buildTranscodeAiCapabilityPayload(options.file, options.capabilities);
  const textPrompt = buildAiTextPrompt(
    options.file,
    options.intent,
    options.sizePreference,
    options.userInstruction,
  );
  const userContentParts: LlmContentPart[] = [{ type: 'text', text: textPrompt }, ...imageParts];

  const llmResponse = await callLlm({
    provider: options.provider,
    apiKey,
    model: options.model,
    systemPrompt: buildAiSystemPrompt(capabilityPayload),
    userPrompt: textPrompt,
    userContentParts,
    responseMode: 'json',
    signal: options.signal,
    logSource: 'transcode',
  });

  if (llmResponse.cancelled) {
    throw new Error('AI analysis cancelled');
  }

  if (llmResponse.error) {
    throw new Error(llmResponse.error);
  }

  const parsed = JSON.parse(llmResponse.content);
  if (isAiErrorResponse(parsed)) {
    throw new Error(parsed.errorMessage);
  }

  if (!isAiSuccessResponse(parsed)) {
    throw new Error('The AI response did not match the expected profile schema');
  }

  const { profile, warnings } = sanitizeTranscodeAiProfileResponse(
    parsed,
    options.file,
    options.capabilities,
  );

  return {
    provider: options.provider,
    model: options.model,
    intent: options.intent,
    sizePreference: options.sizePreference,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : 'AI-generated recommendation',
    warnings,
    profile,
    createdAt: Date.now(),
  };
}
