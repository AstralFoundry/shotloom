//! 诊断包导出：把前端整理好的文本文件按固定清单压成 ZIP，返回 base64。
//!
//! 只接受白名单字符的扁平文件名，拒绝路径穿越；总量超过 10 MiB 直接失败，
//! 不在磁盘上留下半成品。

use base64::Engine;
use serde_json::Value;
use std::io::{Cursor, Write};

const MAX_BUNDLE_BYTES: usize = 10 * 1024 * 1024;

fn safe_entry_name(name: &str) -> Option<&str> {
    if name.is_empty() || name.len() > 120 {
        return None;
    }
    if name.starts_with('/') || name.contains("..") || name.contains('\\') {
        return None;
    }
    name.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-' | '/'))
        .then_some(name)
}

/// 纯构建函数：命令与单元测试共用，避免测试只能覆盖参数校验。
pub(crate) fn build_zip(files: &Value) -> Result<Vec<u8>, String> {
    let map = files
        .as_object()
        .ok_or_else(|| "diagnostics files must be an object".to_string())?;
    let mut total = 0usize;
    let mut buffer = Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut buffer);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, content) in map {
            let entry = safe_entry_name(name)
                .ok_or_else(|| format!("invalid diagnostics entry: {name}"))?;
            let text = content.as_str().unwrap_or_default();
            total += text.len();
            if total > MAX_BUNDLE_BYTES {
                return Err("diagnostics bundle exceeds 10 MiB".to_string());
            }
            zip.start_file(entry, options).map_err(|error| error.to_string())?;
            zip.write_all(text.as_bytes()).map_err(|error| error.to_string())?;
        }
        zip.finish().map_err(|error| error.to_string())?;
    }
    Ok(buffer.into_inner())
}

#[tauri::command]
pub fn diagnostics_build(files: Value) -> Result<String, String> {
    Ok(base64::engine::general_purpose::STANDARD.encode(build_zip(&files)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn read_entry(archive: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>, name: &str) -> String {
        let mut entry = archive.by_name(name).expect("entry");
        let mut text = String::new();
        entry.read_to_string(&mut text).expect("read entry");
        text
    }

    #[test]
    fn builds_zip_with_expected_entries() {
        let files = serde_json::json!({
            "README.txt": "hello",
            "manifest.json": "{\"formatVersion\":1}",
            "events.jsonl": "{\"name\":\"a\"}\n{\"name\":\"b\"}"
        });
        let bytes = build_zip(&files).expect("zip");
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("open");
        let mut names = (0..archive.len()).map(|index| archive.by_index(index).unwrap().name().to_owned()).collect::<Vec<_>>();
        names.sort();
        assert_eq!(names, vec!["README.txt", "events.jsonl", "manifest.json"]);
        assert_eq!(read_entry(&mut archive, "README.txt"), "hello");
        assert_eq!(read_entry(&mut archive, "events.jsonl").lines().count(), 2);
    }

    #[test]
    fn rejects_path_traversal_and_oversized_bundles() {
        assert!(build_zip(&serde_json::json!({ "../escape.txt": "x" })).is_err());
        assert!(build_zip(&serde_json::json!({ "/etc/passwd": "x" })).is_err());
        let huge = "x".repeat(MAX_BUNDLE_BYTES + 1);
        assert!(build_zip(&serde_json::json!({ "events.jsonl": huge })).is_err());
    }
}
