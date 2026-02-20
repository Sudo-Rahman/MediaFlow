import type { TranscriptionData } from './deepgram';
import type { TranslationPersistenceData } from './translation';
import type { VideoOcrPersistenceData } from './video-ocr';

export interface RsextData {
  version: 1;
  audioToSubs?: TranscriptionData;
  videoOcr?: VideoOcrPersistenceData;
  translation?: TranslationPersistenceData;
}
