use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

const MEDIAFLOW_SIDECAR_SUFFIX: &str = ".mediaflow.json";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ImportRootKind {
    File,
    Folder,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportSourceGroup {
    pub(crate) group_key: String,
    pub(crate) selected_root: String,
    pub(crate) selected_root_kind: ImportRootKind,
    pub(crate) relative_path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExpandedImportFile {
    pub(crate) path: String,
    pub(crate) source_group: ImportSourceGroup,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportWarning {
    pub(crate) code: String,
    pub(crate) path: String,
    pub(crate) related_path: Option<String>,
    pub(crate) count: usize,
    pub(crate) message: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportExpansion {
    pub(crate) files: Vec<ExpandedImportFile>,
    pub(crate) warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug)]
struct ImportOptions {
    extensions: Option<HashSet<String>>,
    exclude_mediaflow_sidecars: bool,
}

#[tauri::command]
pub(crate) async fn expand_import_roots(
    roots: Vec<String>,
    extensions: Option<Vec<String>>,
    exclude_mediaflow_sidecars: bool,
) -> Result<ImportExpansion, String> {
    tokio::task::spawn_blocking(move || {
        expand_import_roots_blocking(&roots, extensions.as_deref(), exclude_mediaflow_sidecars)
    })
    .await
    .map_err(|error| format!("Import expansion task failed: {error}"))?
}

fn expand_import_roots_blocking(
    roots: &[String],
    extensions: Option<&[String]>,
    exclude_mediaflow_sidecars: bool,
) -> Result<ImportExpansion, String> {
    let options = ImportOptions {
        extensions: extensions.map(normalize_extensions),
        exclude_mediaflow_sidecars,
    };
    let mut files = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut warnings = Vec::new();

    for root in roots {
        let root_path = Path::new(root);
        let metadata = match fs::symlink_metadata(root_path) {
            Ok(metadata) => metadata,
            Err(_) => {
                record_warning(
                    &mut warnings,
                    "non-regular-root",
                    root.clone(),
                    None,
                    "Import root could not be inspected",
                );
                continue;
            }
        };

        if metadata.file_type().is_symlink() {
            record_warning(
                &mut warnings,
                "symlink-root",
                root.clone(),
                None,
                "Symlink import root was skipped",
            );
            continue;
        }

        if metadata.is_file() {
            if path_is_allowed(root_path, &options) {
                push_file(
                    &mut files,
                    &mut seen_paths,
                    &mut warnings,
                    root.clone(),
                    ImportSourceGroup {
                        group_key: root_path
                            .parent()
                            .unwrap_or_else(|| Path::new("."))
                            .to_string_lossy()
                            .into_owned(),
                        selected_root: root.clone(),
                        selected_root_kind: ImportRootKind::File,
                        relative_path: root_path
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                    },
                );
            }
            continue;
        }

        if !metadata.is_dir() {
            record_warning(
                &mut warnings,
                "non-regular-root",
                root.clone(),
                None,
                "Non-regular import root was skipped",
            );
            continue;
        }

        let mut folder_files = Vec::new();
        for entry in WalkDir::new(root_path).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    record_warning(
                        &mut warnings,
                        "non-regular-entry",
                        error
                            .path()
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or_else(|| root.clone()),
                        None,
                        "Import entry could not be inspected",
                    );
                    continue;
                }
            };

            if entry.path() == root_path {
                continue;
            }

            if entry.file_type().is_symlink() {
                record_warning(
                    &mut warnings,
                    "symlink-entry",
                    entry.path().to_string_lossy().into_owned(),
                    None,
                    "Symlink import entry was skipped",
                );
                continue;
            }

            if !entry.file_type().is_file() || !path_is_allowed(entry.path(), &options) {
                continue;
            }

            let relative_path = entry
                .path()
                .strip_prefix(root_path)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            folder_files.push((entry.path().to_string_lossy().into_owned(), relative_path));
        }

        folder_files.sort_by(|left, right| left.1.cmp(&right.1).then_with(|| left.0.cmp(&right.0)));
        for (path, relative_path) in folder_files {
            push_file(
                &mut files,
                &mut seen_paths,
                &mut warnings,
                path,
                ImportSourceGroup {
                    group_key: root.clone(),
                    selected_root: root.clone(),
                    selected_root_kind: ImportRootKind::Folder,
                    relative_path,
                },
            );
        }
    }

    Ok(ImportExpansion { files, warnings })
}

fn push_file(
    files: &mut Vec<ExpandedImportFile>,
    seen_paths: &mut HashSet<String>,
    warnings: &mut Vec<ImportWarning>,
    path: String,
    source_group: ImportSourceGroup,
) {
    if !seen_paths.insert(path.clone()) {
        let related_path = files
            .iter()
            .find(|file| file.path == path)
            .map(|file| file.path.clone());
        record_warning(
            warnings,
            "duplicate",
            path,
            related_path,
            "Duplicate import was skipped",
        );
        return;
    }

    files.push(ExpandedImportFile { path, source_group });
}

fn path_is_allowed(path: &Path, options: &ImportOptions) -> bool {
    if options.exclude_mediaflow_sidecars
        && path
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase())
            .is_some_and(|name| name.ends_with(MEDIAFLOW_SIDECAR_SUFFIX))
    {
        return false;
    }

    let Some(extensions) = &options.extensions else {
        return true;
    };
    path.extension()
        .map(|extension| format!(".{}", extension.to_string_lossy().to_ascii_lowercase()))
        .is_some_and(|extension| extensions.contains(&extension))
}

fn normalize_extensions(extensions: &[String]) -> HashSet<String> {
    extensions
        .iter()
        .map(|extension| {
            let extension = extension.trim().to_ascii_lowercase();
            if extension.starts_with('.') {
                extension
            } else {
                format!(".{extension}")
            }
        })
        .collect()
}

fn record_warning(
    warnings: &mut Vec<ImportWarning>,
    code: &str,
    path: String,
    related_path: Option<String>,
    message: &str,
) {
    if let Some(existing) = warnings.iter_mut().find(|warning| {
        warning.code == code
            && warning.path == path
            && warning.related_path == related_path
            && warning.message == message
    }) {
        existing.count += 1;
        return;
    }

    warnings.push(ImportWarning {
        code: code.to_string(),
        path,
        related_path,
        count: 1,
        message: message.to_string(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_file(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("test parent should be created");
        }
        fs::write(path, b"test").expect("test file should be written");
    }

    fn paths(result: &ImportExpansion) -> Vec<String> {
        result.files.iter().map(|file| file.path.clone()).collect()
    }

    #[tokio::test]
    async fn expands_multiple_roots_in_deterministic_folder_order_and_filters_case_insensitively() {
        let directory = tempfile::tempdir().expect("tempdir should be created");
        let first = directory.path().join("first");
        let second = directory.path().join("second");
        create_file(&first.join("z.MKV"));
        create_file(&first.join("a").join("b.mkv"));
        create_file(&first.join("ignore.txt"));
        create_file(&second.join("episode.mkv"));

        let result = expand_import_roots(
            vec![
                first.to_string_lossy().into_owned(),
                second.join("episode.mkv").to_string_lossy().into_owned(),
            ],
            Some(vec![".mKv".to_string()]),
            false,
        )
        .await
        .expect("expansion should succeed");

        assert_eq!(result.files[0].source_group.relative_path, "a/b.mkv");
        assert_eq!(result.files.len(), 3);
        assert!(
            paths(&result)
                .iter()
                .all(|path| path.to_ascii_lowercase().ends_with(".mkv"))
        );
    }

    #[tokio::test]
    async fn deduplicates_exact_paths_and_excludes_sidecars() {
        let directory = tempfile::tempdir().expect("tempdir should be created");
        let file = directory.path().join("movie.mkv");
        create_file(&file);
        create_file(&directory.path().join("movie.MEDIAFLOW.JSON"));

        let path = file.to_string_lossy().into_owned();
        let result = expand_import_roots(vec![path.clone(), path], None, true)
            .await
            .expect("expansion should succeed");

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.warnings[0].code, "duplicate");
        assert_eq!(result.warnings[0].count, 1);
        assert!(result.files[0].path.ends_with("movie.mkv"));
    }

    #[tokio::test]
    async fn skips_empty_folders_without_native_warning() {
        let directory = tempfile::tempdir().expect("tempdir should be created");
        let result = expand_import_roots(
            vec![directory.path().to_string_lossy().into_owned()],
            Some(vec!["mkv".to_string()]),
            false,
        )
        .await
        .expect("expansion should succeed");

        assert!(result.files.is_empty());
        assert!(result.warnings.is_empty());
    }
}
