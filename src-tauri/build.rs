mod build_support;
mod ffmpeg_bundle;

fn main() {
    if let Err(error) = ffmpeg_bundle::prepare_external_binaries() {
        panic!("failed to prepare FFmpeg external binaries: {error}");
    }

    tauri_build::build()
}
