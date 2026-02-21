export interface MediaTrackCount {
  video: number;
  audio: number;
  subtitle: number;
}

type TrackLike = { type: string };

export function countTracksByType(tracks: TrackLike[]): MediaTrackCount {
  const counts: MediaTrackCount = { video: 0, audio: 0, subtitle: 0 };

  for (const track of tracks) {
    if (track.type === 'video') {
      counts.video += 1;
    } else if (track.type === 'audio') {
      counts.audio += 1;
    } else if (track.type === 'subtitle') {
      counts.subtitle += 1;
    }
  }

  return counts;
}
