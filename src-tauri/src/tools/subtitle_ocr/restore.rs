use std::{
    cell::Cell,
    path::{Component, Path, PathBuf},
};

use crate::shared::sleep_inhibit::SleepInhibitGuard;
use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;
use crate::tools::subtitle_ocr::assets::write_decoded_bitmap_assets;
use crate::tools::subtitle_ocr::decode::{
    DecodedBitmapCue, decode_bitmap_subtitle_source_with_handler_and_stop,
    validate_bitmap_subtitle_source,
};
use crate::tools::subtitle_ocr::progress::SubtitleOcrProgressEmitter;

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubtitleOcrRestoreBitmap {
    pub(crate) cue_id: String,
    pub(crate) start_time_ms: u64,
    pub(crate) end_time_ms: u64,
    pub(crate) width: u32,
    pub(crate) height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cache_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) thumbnail_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) preview_path: Option<String>,
}

#[tauri::command]
pub(crate) async fn restore_subtitle_ocr_bitmap_assets(
    app: tauri::AppHandle,
    item_id: String,
    run_id: String,
    source_path: String,
    idx_path: Option<String>,
    sub_path: Option<String>,
    bitmaps: Vec<SubtitleOcrRestoreBitmap>,
) -> Result<Vec<SubtitleOcrRestoreBitmap>, String> {
    if item_id.trim().is_empty() {
        return Err("Subtitle OCR item id is required".to_string());
    }
    if run_id.trim().is_empty() {
        return Err("Subtitle OCR run id is required".to_string());
    }

    let _sleep_guard = SleepInhibitGuard::try_acquire("Restoring Subtitle OCR previews").ok();
    let source =
        validate_bitmap_subtitle_source(&source_path, idx_path.as_deref(), sub_path.as_deref())?;
    super::state::begin_operation(&item_id, &run_id)?;

    let item_id_for_task = item_id.clone();
    let run_id_for_task = run_id.clone();
    let join_result = tokio::task::spawn_blocking(move || {
        restore_subtitle_ocr_bitmap_assets_blocking(
            app,
            &item_id_for_task,
            &run_id_for_task,
            &source,
            bitmaps,
        )
    })
    .await;

    let _ = super::state::clear_registered_operation(&item_id, &run_id);
    let result = join_result.map_err(|e| format!("Subtitle OCR restore task failed: {}", e))?;
    if result.is_ok() {
        let _ = super::state::clear_cancelled(&item_id, &run_id);
    }

    result
}

#[tauri::command]
pub(crate) async fn collect_missing_subtitle_ocr_bitmap_assets(
    bitmaps: Vec<SubtitleOcrRestoreBitmap>,
) -> Result<Vec<SubtitleOcrRestoreBitmap>, String> {
    tokio::task::spawn_blocking(move || collect_missing_bitmap_assets(bitmaps))
        .await
        .map_err(|e| format!("Subtitle OCR bitmap asset scan failed: {}", e))
}

fn collect_missing_bitmap_assets(
    bitmaps: Vec<SubtitleOcrRestoreBitmap>,
) -> Vec<SubtitleOcrRestoreBitmap> {
    let mut missing = Vec::new();
    let mut seen_keys = std::collections::HashSet::new();

    for bitmap in bitmaps {
        if bitmap_asset_is_missing(&bitmap) {
            let key = bitmap_restore_key(&bitmap);
            if !seen_keys.insert(key) {
                continue;
            }
            missing.push(bitmap);
        }
    }

    missing
}

fn bitmap_restore_key(bitmap: &SubtitleOcrRestoreBitmap) -> String {
    if let Some(cache_key) = bitmap
        .cache_key
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        return format!("cache:{cache_key}");
    }

    if !bitmap.cue_id.is_empty() {
        return format!("cue:{}", bitmap.cue_id);
    }

    format!(
        "time:{}:{}:{}:{}",
        bitmap.start_time_ms, bitmap.end_time_ms, bitmap.width, bitmap.height
    )
}

fn bitmap_asset_is_missing(bitmap: &SubtitleOcrRestoreBitmap) -> bool {
    let Some(thumbnail_path) = bitmap.thumbnail_path.as_deref() else {
        return true;
    };
    let Some(preview_path) = bitmap.preview_path.as_deref() else {
        return true;
    };

    !subtitle_ocr_asset_path_exists(thumbnail_path) || !subtitle_ocr_asset_path_exists(preview_path)
}

fn subtitle_ocr_asset_path_exists(path: &str) -> bool {
    let path = Path::new(path);
    if !path_is_in_subtitle_ocr_temp_root(path) {
        return false;
    }

    path.exists()
}

fn path_is_in_subtitle_ocr_temp_root(path: &Path) -> bool {
    let root = subtitle_ocr_temp_asset_root();
    path.is_absolute()
        && path.starts_with(&root)
        && path
            .components()
            .all(|component| !matches!(component, Component::ParentDir | Component::CurDir))
}

fn subtitle_ocr_temp_asset_root() -> PathBuf {
    std::env::temp_dir().join("MediaFlow").join("subtitle-ocr")
}

fn restore_subtitle_ocr_bitmap_assets_blocking(
    app: tauri::AppHandle,
    item_id: &str,
    run_id: &str,
    source: &super::decode::BitmapSubtitleSource,
    bitmaps: Vec<SubtitleOcrRestoreBitmap>,
) -> Result<Vec<SubtitleOcrRestoreBitmap>, String> {
    ensure_not_cancelled(item_id, run_id)?;
    let total = u32::try_from(bitmaps.len()).unwrap_or(u32::MAX);
    let progress = SubtitleOcrProgressEmitter::new(
        app,
        item_id.to_string(),
        run_id.to_string(),
        "decoding",
        total,
    );
    progress.emit_force(0);

    if bitmaps.is_empty() {
        return Ok(Vec::new());
    }

    let mut matcher = RestoreBitmapMatcher::new(bitmaps);
    let restore_complete = Cell::new(false);
    let mut restored = Vec::new();
    let mut restored_count = 0u32;

    decode_bitmap_subtitle_source_with_handler_and_stop(
        source,
        item_id,
        run_id,
        |decoded| {
            ensure_not_cancelled(item_id, run_id)?;
            if let Some(target) = matcher.take_match(&decoded.metadata) {
                let restored_bitmap = restore_bitmap_paths(item_id, run_id, target, &decoded)?;
                restored.push(restored_bitmap);
                restored_count = restored_count.saturating_add(1);
                progress.emit(restored_count);
                restore_complete.set(matcher.is_complete());
            }
            Ok(())
        },
        || restore_complete.get(),
    )?;

    progress.emit_force_with_total(restored_count, total);
    Ok(restored)
}

fn restore_bitmap_paths(
    item_id: &str,
    run_id: &str,
    mut target: SubtitleOcrRestoreBitmap,
    decoded: &DecodedBitmapCue,
) -> Result<SubtitleOcrRestoreBitmap, String> {
    let assets = write_decoded_bitmap_assets(item_id, run_id, &decoded.metadata, &decoded.rgba)?;
    target.thumbnail_path = Some(assets.thumbnail_path);
    target.preview_path = Some(assets.preview_path);
    if target.cache_key.is_none() {
        target.cache_key = Some(decoded.metadata.cache_key.clone());
    }
    Ok(target)
}

fn ensure_not_cancelled(item_id: &str, run_id: &str) -> Result<(), String> {
    if super::state::is_operation_cancelled(item_id, run_id) {
        Err("Subtitle OCR operation cancelled".to_string())
    } else {
        Ok(())
    }
}

struct RestoreBitmapMatcher {
    targets: Vec<SubtitleOcrRestoreBitmap>,
    matched: Vec<bool>,
}

impl RestoreBitmapMatcher {
    fn new(targets: Vec<SubtitleOcrRestoreBitmap>) -> Self {
        let matched = vec![false; targets.len()];
        Self { targets, matched }
    }

    fn take_match(&mut self, decoded: &SubtitleOcrDecodedCue) -> Option<SubtitleOcrRestoreBitmap> {
        let index = self
            .find_by_cache_key(decoded)
            .or_else(|| self.find_by_cue_id(decoded))
            .or_else(|| self.find_by_timing_and_dimensions(decoded))?;
        self.matched[index] = true;
        Some(self.targets[index].clone())
    }

    fn is_complete(&self) -> bool {
        self.matched.iter().all(|matched| *matched)
    }

    fn find_by_cache_key(&self, decoded: &SubtitleOcrDecodedCue) -> Option<usize> {
        self.targets.iter().enumerate().position(|(index, target)| {
            !self.matched[index]
                && target
                    .cache_key
                    .as_deref()
                    .is_some_and(|cache_key| cache_key == decoded.cache_key)
        })
    }

    fn find_by_cue_id(&self, decoded: &SubtitleOcrDecodedCue) -> Option<usize> {
        self.targets
            .iter()
            .enumerate()
            .position(|(index, target)| !self.matched[index] && target.cue_id == decoded.cue_id)
    }

    fn find_by_timing_and_dimensions(&self, decoded: &SubtitleOcrDecodedCue) -> Option<usize> {
        self.targets.iter().enumerate().position(|(index, target)| {
            !self.matched[index]
                && target.start_time_ms == decoded.start_time_ms
                && target.end_time_ms == decoded.end_time_ms
                && target.width == decoded.width
                && target.height == decoded.height
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{
        RestoreBitmapMatcher, SubtitleOcrRestoreBitmap, collect_missing_bitmap_assets,
        restore_bitmap_paths, subtitle_ocr_temp_asset_root,
    };
    use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;
    use crate::tools::subtitle_ocr::decode::DecodedBitmapCue;

    fn bitmap(
        cue_id: &str,
        cache_key: Option<&str>,
        start_time_ms: u64,
    ) -> SubtitleOcrRestoreBitmap {
        SubtitleOcrRestoreBitmap {
            cue_id: cue_id.to_string(),
            start_time_ms,
            end_time_ms: start_time_ms + 1_000,
            width: 720,
            height: 360,
            cache_key: cache_key.map(ToOwned::to_owned),
            thumbnail_path: Some(format!("/tmp/{cue_id}-old-thumb.png")),
            preview_path: Some(format!("/tmp/{cue_id}-old-preview.png")),
        }
    }

    fn decoded(cue_id: &str, cache_key: &str, start_time_ms: u64) -> SubtitleOcrDecodedCue {
        SubtitleOcrDecodedCue {
            cue_id: cue_id.to_string(),
            start_time_ms,
            end_time_ms: start_time_ms + 1_000,
            width: 720,
            height: 360,
            cache_key: cache_key.to_string(),
            thumbnail_path: None,
            preview_path: None,
        }
    }

    #[test]
    fn restore_matcher_prefers_cache_key_before_cue_id() {
        let mut matcher = RestoreBitmapMatcher::new(vec![
            bitmap("same-cue", Some("cache-miss"), 1_000),
            bitmap("other-cue", Some("cache-hit"), 2_000),
        ]);

        let matched = matcher
            .take_match(&decoded("same-cue", "cache-hit", 1_000))
            .expect("cache key match should win");

        assert_eq!(matched.cue_id, "other-cue");
    }

    #[test]
    fn restore_matcher_uses_cue_id_before_timing() {
        let mut matcher = RestoreBitmapMatcher::new(vec![
            bitmap("timing-match", None, 1_000),
            bitmap("cue-match", None, 2_000),
        ]);

        let matched = matcher
            .take_match(&decoded("cue-match", "cache-new", 1_000))
            .expect("cue id match should win");

        assert_eq!(matched.cue_id, "cue-match");
    }

    #[test]
    fn restore_matcher_falls_back_to_timing_and_dimensions() {
        let mut matcher = RestoreBitmapMatcher::new(vec![bitmap("target", None, 1_000)]);

        let matched = matcher
            .take_match(&decoded("decoded", "cache-new", 1_000))
            .expect("timing and dimensions should match");

        assert_eq!(matched.cue_id, "target");
    }

    #[test]
    fn collect_missing_bitmap_assets_deduplicates_and_checks_paths() {
        let asset_root = subtitle_ocr_temp_asset_root();
        std::fs::create_dir_all(&asset_root).expect("asset root should be created");
        let temp_dir = tempfile::Builder::new()
            .prefix("restore-test")
            .tempdir_in(&asset_root)
            .expect("temp dir should be created");
        let thumbnail_path = temp_dir.path().join("existing-thumb.png");
        let preview_path = temp_dir.path().join("existing-preview.png");
        std::fs::write(&thumbnail_path, b"thumb").expect("thumbnail should be written");
        std::fs::write(&preview_path, b"preview").expect("preview should be written");

        let mut existing = bitmap("existing", Some("existing-cache"), 1_000);
        existing.thumbnail_path = Some(thumbnail_path.to_string_lossy().to_string());
        existing.preview_path = Some(preview_path.to_string_lossy().to_string());

        let mut missing = bitmap("missing", Some("missing-cache"), 2_000);
        missing.thumbnail_path = Some(
            temp_dir
                .path()
                .join("missing-thumb.png")
                .to_string_lossy()
                .to_string(),
        );
        missing.preview_path = Some(preview_path.to_string_lossy().to_string());

        let found = collect_missing_bitmap_assets(vec![
            existing,
            missing.clone(),
            SubtitleOcrRestoreBitmap {
                cue_id: "duplicate".to_string(),
                ..missing.clone()
            },
        ]);

        assert_eq!(found, vec![missing]);
    }

    #[test]
    fn collect_missing_bitmap_assets_detects_later_missing_duplicate() {
        let asset_root = subtitle_ocr_temp_asset_root();
        std::fs::create_dir_all(&asset_root).expect("asset root should be created");
        let temp_dir = tempfile::Builder::new()
            .prefix("restore-duplicate-test")
            .tempdir_in(&asset_root)
            .expect("temp dir should be created");
        let thumbnail_path = temp_dir.path().join("existing-thumb.png");
        let preview_path = temp_dir.path().join("existing-preview.png");
        std::fs::write(&thumbnail_path, b"thumb").expect("thumbnail should be written");
        std::fs::write(&preview_path, b"preview").expect("preview should be written");

        let mut existing = bitmap("existing", Some("shared-cache"), 1_000);
        existing.thumbnail_path = Some(thumbnail_path.to_string_lossy().to_string());
        existing.preview_path = Some(preview_path.to_string_lossy().to_string());

        let mut missing = bitmap("missing", Some("shared-cache"), 2_000);
        missing.thumbnail_path = Some(
            temp_dir
                .path()
                .join("missing-thumb.png")
                .to_string_lossy()
                .to_string(),
        );
        missing.preview_path = Some(preview_path.to_string_lossy().to_string());

        let found = collect_missing_bitmap_assets(vec![existing, missing.clone()]);

        assert_eq!(found, vec![missing]);
    }

    #[test]
    fn collect_missing_bitmap_assets_treats_out_of_scope_paths_as_missing_without_probing() {
        let temp_dir = tempfile::tempdir().expect("temp dir should be created");
        let thumbnail_path = temp_dir.path().join("existing-thumb.png");
        let preview_path = temp_dir.path().join("existing-preview.png");
        std::fs::write(&thumbnail_path, b"thumb").expect("thumbnail should be written");
        std::fs::write(&preview_path, b"preview").expect("preview should be written");

        let mut target = bitmap("target", Some("target-cache"), 1_000);
        target.thumbnail_path = Some(thumbnail_path.to_string_lossy().to_string());
        target.preview_path = Some(preview_path.to_string_lossy().to_string());

        assert_eq!(
            collect_missing_bitmap_assets(vec![target.clone()]),
            vec![target]
        );
    }

    #[test]
    fn collect_missing_bitmap_assets_treats_absent_paths_as_missing() {
        let target = SubtitleOcrRestoreBitmap {
            thumbnail_path: None,
            preview_path: None,
            ..bitmap("target", Some("target-cache"), 1_000)
        };

        assert_eq!(
            collect_missing_bitmap_assets(vec![target.clone()]),
            vec![target]
        );
    }

    #[test]
    fn restore_bitmap_paths_returns_requested_bitmap_with_new_paths() {
        let target = bitmap("target", None, 1_000);
        let metadata = decoded("decoded", "cache-new", 1_000);
        let decoded = DecodedBitmapCue {
            rgba: vec![255; (metadata.width * metadata.height * 4) as usize],
            metadata,
        };

        let restored = restore_bitmap_paths("item", "restore-run", target, &decoded)
            .expect("bitmap paths should restore");

        assert_eq!(restored.cue_id, "target");
        assert_eq!(restored.cache_key.as_deref(), Some("cache-new"));
        assert!(restored.thumbnail_path.as_deref().is_some_and(|path| {
            path.contains("MediaFlow") && std::path::Path::new(path).is_file()
        }));
        assert!(restored.preview_path.as_deref().is_some_and(|path| {
            path.contains("MediaFlow") && std::path::Path::new(path).is_file()
        }));

        if let Some(path) = restored.thumbnail_path {
            let _ = std::fs::remove_file(path);
        }
        if let Some(path) = restored.preview_path {
            let _ = std::fs::remove_file(path);
        }
    }
}
