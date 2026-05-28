import type { TranscriptionData } from './deepgram';
import type { SubtitleOcrPersistenceData } from './subtitle-ocr';
import type { TranslationPersistenceData } from './translation';
import type { VideoOcrPersistenceData } from './video-ocr';

export interface MediaflowData {
  version: 1;
  audioToSubs?: TranscriptionData;
  videoOcr?: VideoOcrPersistenceData;
  translation?: TranslationPersistenceData;
  subtitleOcr?: SubtitleOcrPersistenceData;
}
