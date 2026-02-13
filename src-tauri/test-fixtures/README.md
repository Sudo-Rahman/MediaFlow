# Rust Test Fixtures

This folder contains local media fixtures used by Rust integration tests.

- `media/sample_video.mp4`: local video+audio sample for ffprobe/ffmpeg/transcode/merge tests.
- `media/sample_ocr_video.mp4`: local video with text for OCR pipeline tests.

Tests must use these local files through `src/test_support/assets.rs`.
No runtime download from internet is allowed in tests.

If a fixture file is replaced, update its checksum in
`src/test_support/test_assets_manifest.rs`.

Regenerate fixtures (from `src-tauri/`) if needed:

```bash
mkdir -p test-fixtures/media
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i testsrc=size=320x180:rate=30 \
  -f lavfi -i sine=frequency=1000:sample_rate=48000:duration=2 \
  -t 2 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 96k -shortest \
  test-fixtures/media/sample_video.mp4

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i color=c=black:s=640x360:d=2 \
  -vf "drawtext=text='HELLO OCR TEST':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=(h-text_h)/2" \
  -c:v libx264 -pix_fmt yuv420p \
  test-fixtures/media/sample_ocr_video.mp4

shasum -a 256 test-fixtures/media/sample_video.mp4 test-fixtures/media/sample_ocr_video.mp4
```
