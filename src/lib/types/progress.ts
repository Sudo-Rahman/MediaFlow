export interface ExtractProgressEvent {
  inputPath: string;
  outputPath: string;
  trackIndex: number;
  progress: number;
  speedBytesPerSec?: number;
}

export interface MergeProgressEvent {
  videoPath: string;
  outputPath: string;
  progress: number;
  speedBytesPerSec?: number;
}
