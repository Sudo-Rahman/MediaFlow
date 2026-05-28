<p align="center">
  <img src="src-tauri/icons/icon.png" alt="MediaFlow logo" width="96" />
</p>

<h1 align="center">MediaFlow</h1>

<p align="center">
  <strong>Local-first desktop app for FFmpeg-powered media workflows.</strong>
</p>

<p align="center">
  Extract tracks, mux subtitles and audio, transcode media, generate subtitles from speech,
  recover burned-in subtitles with OCR, translate subtitle files, batch rename files,
  and inspect media metadata in one reviewable workflow.
</p>

<p align="center">
  <a href="https://mediaflowtools.com">Website</a>
  ·
  <a href="https://mediaflowtools.com/docs">Documentation</a>
  ·
  <a href="https://apps.microsoft.com/detail/9n0180zrqn56">Microsoft Store</a>
  ·
  <a href="https://github.com/Sudo-Rahman/MediaFlow/releases/latest">GitHub Releases</a>
  ·
  <a href="https://mediaflowtools.com/pricing">Pricing</a>
</p>

<p align="center">
  <a href="https://github.com/Sudo-Rahman/MediaFlow/releases">
    <img src="https://img.shields.io/github/v/release/Sudo-Rahman/MediaFlow?label=release" alt="Latest release" />
  </a>
  <a href="https://github.com/Sudo-Rahman/MediaFlow/releases">
    <img src="https://img.shields.io/github/downloads/Sudo-Rahman/MediaFlow/total?label=downloads" alt="GitHub downloads" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MNCL%201.0-blue" alt="License: MNCL 1.0" />
  </a>
  <a href="https://tauri.app">
    <img src="https://img.shields.io/badge/built%20with-Tauri-24C8DB" alt="Built with Tauri" />
  </a>
  <a href="https://ffmpeg.org">
    <img src="https://img.shields.io/badge/powered%20by-FFmpeg-green" alt="Powered by FFmpeg" />
</p>

---

## What is MediaFlow?

MediaFlow is a desktop media workflow app built for people who work with video files, audio tracks, subtitles and media containers.

Instead of switching between a converter, a subtitle extractor, a muxing tool, a transcription tool, an OCR tool, a file renamer and a metadata inspector, MediaFlow brings the common media tasks into one interface.

Use MediaFlow to:

- extract subtitles from MKV, MP4 and other media containers;
- extract audio, video or subtitle tracks as separate files;
- add SRT, ASS, SSA, VTT or audio tracks to a video;
- transcode video and audio files for playback, editing, sharing, archiving or smaller file size;
- generate subtitles from audio or video speech;
- recover burned-in subtitles from video frames with OCR;
- translate subtitle files while keeping timing and structure;
- batch rename or copy media files with preview;
- inspect codecs, streams, tracks, duration, languages, bitrate and metadata.

MediaFlow is designed around reviewable workflows: you can check tracks, filenames, subtitles, translations, OCR output, transcode settings and exports before writing final files.

---

## Tools

| Tool | What it does |
|---|---|
| **Track Extraction** | Extract audio, video and subtitle tracks from media files and save them separately. |
| **Track Merge** | Add external subtitles or audio tracks to videos and export clean media files. |
| **Transcode** | Convert video and audio for playback, editing, sharing, archiving or smaller file size. |
| **Audio to Subs** | Turn speech from audio or video files into subtitle files you can review and export. |
| **Video OCR** | Recover burned-in subtitles by reading text directly from video frames. |
| **AI Translation** | Translate SRT, ASS, VTT and SSA subtitle files while keeping timing and structure. |
| **Batch Rename** | Rename or copy large batches of files with a live preview before changes are applied. |
| **File Information** | Inspect duration, size, codecs, streams, tracks, languages, bitrate and metadata without modifying files. |

---

## Common workflows

MediaFlow helps with workflows such as:

- extract subtitles from MKV files;
- extract SRT, ASS, SSA, VTT, SUP or audio tracks from a video;
- merge subtitles with video;
- add an audio track to a video file;
- mux video, audio and subtitles into one MKV file;
- convert MKV to MP4, MP4 to MKV, MOV to MP4 or WEBM to MP4;
- generate SRT or VTT subtitles from audio;
- transcribe video speech into subtitles;
- OCR hardcoded or burned-in subtitles;
- translate subtitles without breaking timestamps;
- batch rename TV episodes, clips, exports or subtitle files;
- check video codec, audio tracks, subtitle tracks and metadata;
- inspect MKV or MP4 streams before converting, extracting or muxing.

---

## Supported formats

<details>
<summary>Track Extraction</summary>

**Imports**

`MKV`, `MP4`, `AVI`, `MOV`, `WEBM`, `M4V`, `MKS`, `MKA`

**Exports**

`ASS`, `SSA`, `SRT`, `VTT`, `SUB`, `SUP`, `AAC`, `AC3`, `EAC3`, `DTS`, `MP3`, `FLAC`, `OPUS`, `OGG`, `WAV`, `M4A`, `WMA`, `MP4`, `WEBM`, `MPG`

</details>

<details>
<summary>Track Merge</summary>

**Imports**

`MKV`, `MP4`, `AVI`, `MOV`, `WEBM`, `M4V`, `MKS`, `MKA`, `ASS`, `SSA`, `SRT`, `SUB`, `IDX`, `VTT`, `SUP`, `AAC`, `AC3`, `DTS`, `FLAC`, `MP3`, `OGG`, `WAV`, `EAC3`, `OPUS`

**Exports**

`MKV`

</details>

<details>
<summary>Transcode</summary>

**Imports**

`MKV`, `MP4`, `MOV`, `WEBM`, `M4V`, `AVI`, `MXF`, `M4A`, `AAC`, `MP3`, `FLAC`, `OPUS`, `WAV`, `OGG`, `AC3`, `EAC3`, `MKA`

**Exports**

`MP4`, `MKV`, `MOV`, `WEBM`, `AAC`, `MP3`, `FLAC`, `OPUS`, `OGG`, `WAV`

</details>

<details>
<summary>Audio to Subs</summary>

**Imports**

`MP3`, `WAV`, `FLAC`, `AAC`, `OGG`, `M4A`, `OPUS`, `WMA`, `AC3`, `DTS`, `MKA`, `WEBM`, `MP4`, `MKV`

**Exports**

`SRT`, `VTT`, `JSON`

</details>

<details>
<summary>Video OCR</summary>

**Imports**

`MP4`, `MKV`, `AVI`, `MOV`, `WEBM`

**Exports**

`SRT`, `VTT`, `TXT`

</details>

<details>
<summary>AI Translation</summary>

**Imports**

`SRT`, `ASS`, `VTT`, `SSA`

**Exports**

The translated file keeps the matching subtitle format from the source file.

</details>

<details>
<summary>File Information</summary>

**Imports**

`MKV`, `MP4`, `AVI`, `MOV`, `WEBM`, `M4V`, `MKS`, `MKA`

**Output**

Read-only media information. The tool does not modify files.

</details>

---

## Local tools and AI-assisted features

MediaFlow includes local media tools for extraction, merge, transcode, batch rename and file information.

AI-assisted features are used for repetitive or time-consuming work such as:

- subtitle translation;
- audio-to-subtitles transcription;
- video OCR;
- track matching;
- transcode recommendations.

AI features require credits. Local tools remain available without AI credits.

---

## Download

Download MediaFlow from:

- Microsoft Store: https://apps.microsoft.com/detail/9n0180zrqn56
- Website: https://mediaflowtools.com
- GitHub Releases: https://github.com/Sudo-Rahman/MediaFlow/releases/latest
