# MediaFlow

[![CI Build](https://github.com/Sudo-Rahman/RsExtractor/actions/workflows/ci.yml/badge.svg)](https://github.com/Sudo-Rahman/RsExtractor/actions/workflows/ci.yml)

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MediaFlow Logo" width="120" height="120">
</p>

<p align="center">
  <strong>Desktop multimedia toolbox for extraction, merge, OCR, transcription, translation, renaming, and analysis.</strong>
</p>

## Why MediaFlow

MediaFlow is a local-first desktop app built for high-volume subtitle and track workflows.
It combines FFmpeg-powered media processing with AI-assisted tools in one interface.

## Tools

### 1. Extraction
- Scan media containers and inspect tracks.
- Select audio/video/subtitle tracks per file or in batch.
- Export tracks with preserved metadata.

### 2. Merge
- Build batch merge pipelines for episodes or full seasons.
- Attach external subtitle/audio tracks.
- Auto-match by episode naming patterns.
- Configure language/title/default/forced/delay per track.

### 3. Audio to Subs
- Transcribe audio/video to subtitles with Deepgram.
- Manage multiple transcription versions.
- Batch process and export SRT/VTT/TXT.

### 4. Video OCR
- Extract burned-in subtitles from video frames.
- Use a global OCR region for all files with per-file override when needed.
- Review OCR versions and export subtitles.

### 5. AI Translation
- Translate subtitle files with OpenAI, Anthropic, Google, or OpenRouter.
- Multi-file queue with progress and batch splitting.
- Keep formatting and subtitle timing structure.

### 6. Rename
- Rule-based bulk rename/copy workflows.
- Preview results, detect conflicts, then execute safely.

### 7. Info
- Quick media inspection for container, tracks, codecs, bitrate, and metadata.

## Core Features

- Drag and drop import across all tools.
- Unified file cards and consistent actions across views.
- Persistent settings via Tauri Store.
- Light/Dark/System themes.
- Native desktop app with Tauri 2.0 + Rust backend.

## Requirements

- FFmpeg and FFprobe available on system PATH, or configured in Settings.

### Install FFmpeg

- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt install ffmpeg`
- Windows: use the official build from [ffmpeg.org](https://ffmpeg.org/download.html)

## Development

```bash
# Clone
git clone https://github.com/Sudo-Rahman/MediaFlow.git
cd MediaFlow

# Install deps (pnpm only)
pnpm install

# Frontend + Tauri
pnpm tauri dev

# Frontend only
pnpm dev

# Type check
pnpm check

# Production build
pnpm tauri build
```

## Release Pipeline

- GitHub Actions builds macOS, Linux, and Windows on every tag push.
- Workflow: `.github/workflows/release-tauri.yml`
- Assets are published directly to GitHub Releases.

## Tech Stack

- [Tauri 2.0](https://tauri.app/)
- [Svelte 5 + SvelteKit](https://svelte.dev/)
- [Rust](https://www.rust-lang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [shadcn-svelte](https://www.shadcn-svelte.com/)
- [FFmpeg](https://ffmpeg.org/)

## License

MediaFlow Non-Commercial License (MNCL) v1.0. See `LICENSE`.
