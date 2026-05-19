import type { Track, TrackType, VideoFile } from '$lib/types';

type LanguageTrackType = Extract<TrackType, 'audio' | 'subtitle'>;

function isLanguageTrack(track: Track): track is Track & { type: LanguageTrackType; language: string } {
  return (track.type === 'audio' || track.type === 'subtitle') && Boolean(track.language);
}

function getLanguageToken(track: Track & { type: LanguageTrackType; language: string }): string {
  return `${track.type}:${track.language}`;
}

function isLanguageFullySelected(
  files: VideoFile[],
  selectedTracks: Map<string, number[]>,
  type: LanguageTrackType,
  language: string,
): boolean {
  for (const file of files) {
    const selected = selectedTracks.get(file.path) ?? [];
    for (const track of file.tracks) {
      if (track.type === type && track.language === language && !selected.includes(track.id)) {
        return false;
      }
    }
  }

  return true;
}

export function getSelectedLanguageTokens(
  files: VideoFile[],
  selectedTracks: Map<string, number[]>,
): string[] {
  const subtitleLanguages = new Set<string>();
  const audioLanguages = new Set<string>();

  for (const file of files) {
    for (const track of file.tracks) {
      if (track.type === 'subtitle' && track.language) {
        subtitleLanguages.add(track.language);
      } else if (track.type === 'audio' && track.language) {
        audioLanguages.add(track.language);
      }
    }
  }

  const tokens: string[] = [];

  for (const language of subtitleLanguages) {
    if (isLanguageFullySelected(files, selectedTracks, 'subtitle', language)) {
      tokens.push(`subtitle:${language}`);
    }
  }

  for (const language of audioLanguages) {
    if (isLanguageFullySelected(files, selectedTracks, 'audio', language)) {
      tokens.push(`audio:${language}`);
    }
  }

  return tokens;
}

export function applyLanguageTokenSelection(
  files: VideoFile[],
  selectedTracks: Map<string, number[]>,
  nextTokens: string[],
): Map<string, number[]> {
  const previousTokens = new Set(getSelectedLanguageTokens(files, selectedTracks));
  const nextTokenSet = new Set(nextTokens);
  const addedTokens = new Set(nextTokens.filter((token) => !previousTokens.has(token)));
  const removedTokens = new Set([...previousTokens].filter((token) => !nextTokenSet.has(token)));
  const nextSelection = new Map<string, number[]>(
    [...selectedTracks].map(([filePath, trackIds]) => [filePath, [...trackIds]]),
  );

  for (const file of files) {
    const selected = new Set(selectedTracks.get(file.path) ?? []);

    for (const track of file.tracks) {
      if (!isLanguageTrack(track)) {
        continue;
      }

      const token = getLanguageToken(track);

      if (addedTokens.has(token)) {
        selected.add(track.id);
      } else if (removedTokens.has(token)) {
        selected.delete(track.id);
      }
    }

    if (selected.size > 0) {
      nextSelection.set(file.path, Array.from(selected));
    } else {
      nextSelection.delete(file.path);
    }
  }

  return nextSelection;
}
