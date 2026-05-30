use std::path::PathBuf;

use image::{DynamicImage, RgbaImage, imageops::FilterType};

use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;

const THUMBNAIL_MAX_WIDTH: u32 = 360;
const THUMBNAIL_MAX_HEIGHT: u32 = 180;
const PREVIEW_MAX_WIDTH: u32 = 1920;
const PREVIEW_MAX_HEIGHT: u32 = 1080;

pub(super) struct DecodedBitmapAssetPaths {
    pub(super) thumbnail_path: String,
    pub(super) preview_path: String,
}

pub(super) fn write_decoded_bitmap_assets(
    item_id: &str,
    run_id: &str,
    metadata: &SubtitleOcrDecodedCue,
    rgba: &[u8],
) -> Result<DecodedBitmapAssetPaths, String> {
    let image =
        RgbaImage::from_raw(metadata.width, metadata.height, rgba.to_vec()).ok_or_else(|| {
            "Decoded Subtitle OCR bitmap dimensions did not match RGBA data".to_string()
        })?;
    let image = DynamicImage::ImageRgba8(image);

    let thumbnail_path = write_resized_bitmap_asset(
        item_id,
        run_id,
        metadata,
        &image,
        THUMBNAIL_MAX_WIDTH,
        THUMBNAIL_MAX_HEIGHT,
        "thumbnails",
    )?;
    let preview_path = write_resized_bitmap_asset(
        item_id,
        run_id,
        metadata,
        &image,
        PREVIEW_MAX_WIDTH,
        PREVIEW_MAX_HEIGHT,
        "previews",
    )?;

    Ok(DecodedBitmapAssetPaths {
        thumbnail_path,
        preview_path,
    })
}

fn write_resized_bitmap_asset(
    item_id: &str,
    run_id: &str,
    metadata: &SubtitleOcrDecodedCue,
    image: &DynamicImage,
    max_width: u32,
    max_height: u32,
    variant: &str,
) -> Result<String, String> {
    let resized = if image.width() > max_width || image.height() > max_height {
        image.resize(max_width, max_height, FilterType::Triangle)
    } else {
        image.clone()
    };
    let output_dir = subtitle_ocr_bitmap_asset_dir(item_id, run_id, variant);
    std::fs::create_dir_all(&output_dir).map_err(|e| {
        format!(
            "Failed to create Subtitle OCR bitmap asset directory: {}",
            e
        )
    })?;
    let output_path = output_dir.join(format!(
        "{}.png",
        safe_thumbnail_path_component(&metadata.cache_key)
    ));
    resized
        .save(&output_path)
        .map_err(|e| format!("Failed to write Subtitle OCR bitmap asset: {}", e))?;

    Ok(output_path.to_string_lossy().to_string())
}

fn subtitle_ocr_bitmap_asset_dir(item_id: &str, run_id: &str, variant: &str) -> PathBuf {
    std::env::temp_dir()
        .join("MediaFlow")
        .join("subtitle-ocr")
        .join(safe_thumbnail_path_component(item_id))
        .join(safe_thumbnail_path_component(run_id))
        .join(safe_thumbnail_path_component(variant))
}

fn safe_thumbnail_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() {
        "subtitle-ocr".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::{
        THUMBNAIL_MAX_HEIGHT, THUMBNAIL_MAX_WIDTH, safe_thumbnail_path_component,
        subtitle_ocr_bitmap_asset_dir, write_decoded_bitmap_assets,
    };
    use crate::tools::subtitle_ocr::SubtitleOcrDecodedCue;

    #[test]
    fn safe_thumbnail_path_component_removes_path_separators_and_empty_segments() {
        assert_eq!(
            safe_thumbnail_path_component("subtitle-ocr:item/../cache:key"),
            "subtitle-ocr_item____cache_key"
        );
        assert_eq!(safe_thumbnail_path_component(":::"), "subtitle-ocr");
    }

    #[test]
    fn subtitle_ocr_bitmap_asset_dir_stays_under_mediaflow_temp_namespace() {
        let dir = subtitle_ocr_bitmap_asset_dir("../item", "run/id", "previews");
        let path = dir.to_string_lossy();

        assert!(path.contains("MediaFlow"));
        assert!(path.contains("subtitle-ocr"));
        assert!(path.contains("item"));
        assert!(path.contains("run_id"));
        assert!(path.contains("previews"));
        assert!(!path.contains("../"));
    }

    #[test]
    fn write_decoded_bitmap_assets_populates_timeline_and_preview_pngs_under_temp_dir() {
        let metadata = SubtitleOcrDecodedCue {
            cue_id: "cue-1".to_string(),
            start_time_ms: 0,
            end_time_ms: 1_000,
            width: 720,
            height: 360,
            cache_key: "subtitle-ocr:test/cache".to_string(),
            thumbnail_path: None,
            preview_path: None,
        };
        let rgba = vec![255; (metadata.width * metadata.height * 4) as usize];

        let assets = write_decoded_bitmap_assets("item/1", "run:1", &metadata, &rgba)
            .expect("bitmap assets should be written");
        let path = assets.thumbnail_path;
        let thumbnail = image::open(&path).expect("thumbnail should be readable");
        let preview = image::open(&assets.preview_path).expect("preview should be readable");

        assert!(path.contains("MediaFlow"));
        assert!(path.contains("subtitle-ocr"));
        assert!(std::path::Path::new(&path).is_file());
        assert!(std::path::Path::new(&assets.preview_path).is_file());
        assert!(thumbnail.width() <= THUMBNAIL_MAX_WIDTH);
        assert!(thumbnail.height() <= THUMBNAIL_MAX_HEIGHT);
        assert_eq!(preview.width(), metadata.width);
        assert_eq!(preview.height(), metadata.height);

        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_file(assets.preview_path);
    }
}
