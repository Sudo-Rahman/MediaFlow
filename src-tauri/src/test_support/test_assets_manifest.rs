#![allow(dead_code)]

pub(crate) struct TestAsset {
    pub(crate) file_name: &'static str,
    pub(crate) sha256: &'static str,
    pub(crate) max_size_bytes: u64,
}

pub(crate) const SAMPLE_VIDEO_MP4: TestAsset = TestAsset {
    file_name: "sample_video.mp4",
    sha256: "543a4ad9fef4c9e0004ec9482cb7225c2574b0f889291e8270b1c4d61dbc1ab8",
    max_size_bytes: 8 * 1024 * 1024,
};

pub(crate) const SAMPLE_OCR_VIDEO_MP4: TestAsset = TestAsset {
    file_name: "sample_ocr_video.mp4",
    sha256: "cece08b33826af4b42b4cd849dc93022d95706c397ac0c5d83853b983adf3606",
    max_size_bytes: 64 * 1024,
};
