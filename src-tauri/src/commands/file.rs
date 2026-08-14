use super::common::{app_data, chrono_stamp, file_result, sanitize_name};
use ab_glyph::{point, Font, FontArc, PxScale, ScaleFont};
use base64::Engine;
use image::metadata::Orientation;
use image::{
    codecs::jpeg::JpegEncoder, imageops, DynamicImage, ExtendedColorType, ImageDecoder,
    ImageFormat, ImageReader, Rgba, RgbaImage,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};
use tauri::AppHandle;

#[tauri::command]
pub fn file_global_asset_root(app: AppHandle) -> Result<Value, String> {
    let root = app_data(&app)?.join("local-asset-library").join("blobs");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(json!(root.to_string_lossy()))
}

#[tauri::command]
pub fn file_trash(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Ok(json!({"ok": true, "missing": true}));
    }
    trash::delete(&path).map_err(|error| error.to_string())?;
    Ok(json!({"ok": true, "path": path.to_string_lossy()}))
}

#[tauri::command]
pub fn file_show_item_in_folder(path: String) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if !path.exists() {
        return Err("要定位的文件不存在".into());
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&path);
        command
    };

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(&path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path.parent().unwrap_or(&path));
        command
    };

    command
        .spawn()
        .map_err(|error| format!("无法在文件夹中定位文件：{error}"))?;
    Ok(json!({"ok": true, "path": path.to_string_lossy()}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourcePackageFile {
    source: String,
    archive_name: String,
}

fn unique_file_path(directory: &Path, name: &str) -> PathBuf {
    let requested = sanitize_name(name, "resource.bin");
    let requested_path = Path::new(&requested);
    let stem = requested_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("resource");
    let extension = requested_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    let mut target = directory.join(&requested);
    for index in 2..10_000 {
        if !target.exists() {
            break;
        }
        target = directory.join(if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        });
    }
    target
}

#[tauri::command]
pub fn file_export_resource_package(
    target: String,
    manifest: Value,
    files: Vec<ResourcePackageFile>,
) -> Result<Value, String> {
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let output = fs::File::create(&target).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipWriter::new(output);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    archive
        .start_file("manifest.json", options)
        .map_err(|error| error.to_string())?;
    archive
        .write_all(
            serde_json::to_string_pretty(&manifest)
                .map_err(|error| error.to_string())?
                .as_bytes(),
        )
        .map_err(|error| error.to_string())?;
    let mut count = 0usize;
    for item in files {
        let source = PathBuf::from(&item.source);
        if !source.is_file() {
            continue;
        }
        let archive_name = item.archive_name.replace('\\', "/");
        if !archive_name.starts_with("files/") || archive_name.contains("../") {
            continue;
        }
        archive
            .start_file(archive_name, options)
            .map_err(|error| error.to_string())?;
        let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
        std::io::copy(&mut input, &mut archive).map_err(|error| error.to_string())?;
        count += 1;
    }
    archive.finish().map_err(|error| error.to_string())?;
    Ok(json!({"ok": true, "count": count, "filePath": target.to_string_lossy(), "direct": true}))
}

#[tauri::command]
pub fn file_import_resource_package(
    source: String,
    target_directory: String,
) -> Result<Value, String> {
    let input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|error| format!("资源包格式无效：{error}"))?;
    let mut manifest_text = String::new();
    archive
        .by_name("manifest.json")
        .map_err(|_| "资源包缺少 manifest.json".to_string())?
        .read_to_string(&mut manifest_text)
        .map_err(|error| error.to_string())?;
    let mut manifest: Value =
        serde_json::from_str(&manifest_text).map_err(|error| error.to_string())?;
    let target_directory = PathBuf::from(target_directory);
    fs::create_dir_all(&target_directory).map_err(|error| error.to_string())?;
    let package_paths: Vec<String> = manifest
        .get("materials")
        .and_then(Value::as_array)
        .map(|materials| {
            materials
                .iter()
                .filter_map(|material| {
                    material
                        .get("packagePath")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default();
    let material_count = manifest
        .get("materials")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    if package_paths.len() != material_count {
        return Err("资源包素材记录缺少 packagePath".into());
    }
    if package_paths.len() > 10_000 {
        return Err("资源包文件数超过上限".into());
    }
    let mut total_size = 0u64;
    for package_path in &package_paths {
        if !package_path.starts_with("files/") || package_path.contains("../") {
            return Err(format!("资源包文件路径无效：{package_path}"));
        }
        let zipped = archive
            .by_name(package_path)
            .map_err(|_| format!("资源包缺少文件：{package_path}"))?;
        total_size = total_size.saturating_add(zipped.size());
    }
    if total_size > 20 * 1024 * 1024 * 1024 {
        return Err("资源包解压后体积超过 20GB 上限".into());
    }
    if let Some(materials) = manifest.get_mut("materials").and_then(Value::as_array_mut) {
        for material in materials {
            let package_path = material
                .get("packagePath")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if !package_path.starts_with("files/") || package_path.contains("../") {
                continue;
            }
            let preferred = material
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("resource.bin");
            let target = unique_file_path(&target_directory, preferred);
            let mut zipped = archive
                .by_name(&package_path)
                .map_err(|_| format!("资源包缺少文件：{package_path}"))?;
            let mut output = fs::File::create(&target).map_err(|error| error.to_string())?;
            std::io::copy(&mut zipped, &mut output).map_err(|error| error.to_string())?;
            material["path"] = json!(target.to_string_lossy());
            material["filePath"] = json!(target.to_string_lossy());
            material["storageScope"] = json!("project");
        }
    }
    Ok(manifest)
}

#[tauri::command]
pub fn file_read_array_buffer(path: String) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(json!(
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn trim_preview_cache(directory: &Path) {
    const MAX_CACHE_BYTES: u64 = 512 * 1024 * 1024;
    const TARGET_CACHE_BYTES: u64 = 384 * 1024 * 1024;
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .flatten()
        .filter_map(|entry| {
            let metadata = entry.metadata().ok()?;
            metadata.is_file().then(|| {
                (
                    entry.path(),
                    metadata.len(),
                    metadata.modified().unwrap_or(UNIX_EPOCH),
                )
            })
        })
        .collect();
    let mut total: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total <= MAX_CACHE_BYTES {
        return;
    }
    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total <= TARGET_CACHE_BYTES {
            break;
        }
        if fs::remove_file(path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

#[tauri::command]
pub fn file_read_image_preview(
    app: AppHandle,
    path: String,
    max_size: u32,
) -> Result<Value, String> {
    let source = PathBuf::from(&path);
    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("图片文件不存在".into());
    }
    let max_size = max_size.clamp(128, 2048);
    let modified = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut digest = Sha256::new();
    digest.update(b"jpeg-preview-v3");
    digest.update(source.to_string_lossy().as_bytes());
    digest.update(metadata.len().to_le_bytes());
    digest.update(modified.to_le_bytes());
    digest.update(max_size.to_le_bytes());

    let cache_directory = app_data(&app)?.join("preview-cache");
    fs::create_dir_all(&cache_directory).map_err(|error| error.to_string())?;
    let cache_path = cache_directory.join(format!("{:x}.jpg", digest.finalize()));
    let bytes = if cache_path.is_file() {
        fs::read(&cache_path).map_err(|error| error.to_string())?
    } else {
        let mut decoder = ImageReader::open(&source)
            .map_err(|error| error.to_string())?
            .with_guessed_format()
            .map_err(|error| error.to_string())?
            .into_decoder()
            .map_err(|error| format!("无法生成图片预览：{error}"))?;
        let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
        let mut decoded = DynamicImage::from_decoder(decoder)
            .map_err(|error| format!("无法生成图片预览：{error}"))?;
        decoded.apply_orientation(orientation);
        let preview = decoded.thumbnail(max_size, max_size).to_rgba8();
        let mut background = RgbaImage::from_pixel(
            preview.width(),
            preview.height(),
            Rgba([248, 250, 252, 255]),
        );
        image::imageops::overlay(&mut background, &preview, 0, 0);
        let preview = DynamicImage::ImageRgba8(background).to_rgb8();
        let mut encoded = Vec::new();
        JpegEncoder::new_with_quality(&mut encoded, 92)
            .encode(
                &preview,
                preview.width(),
                preview.height(),
                ExtendedColorType::Rgb8,
            )
            .map_err(|error| error.to_string())?;
        fs::write(&cache_path, &encoded).map_err(|error| error.to_string())?;
        trim_preview_cache(&cache_directory);
        encoded
    };
    Ok(json!(
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageCropRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn crop_image(source: String, target: String, crop: ImageCropRect) -> Result<Value, String> {
    if !crop.x.is_finite()
        || !crop.y.is_finite()
        || !crop.width.is_finite()
        || !crop.height.is_finite()
        || crop.width <= 0.0
        || crop.height <= 0.0
    {
        return Err("裁剪区域无效".into());
    }
    let source = PathBuf::from(source);
    if !source.is_file() {
        return Err("要裁剪的图片不存在".into());
    }
    let mut decoder = ImageReader::open(&source)
        .map_err(|error| format!("无法读取图片：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("无法识别图片格式：{error}"))?
        .into_decoder()
        .map_err(|error| format!("无法解码图片：{error}"))?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut decoded = DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("无法解码图片：{error}"))?;
    decoded.apply_orientation(orientation);
    let image_width = decoded.width();
    let image_height = decoded.height();
    if image_width == 0 || image_height == 0 {
        return Err("图片尺寸无效".into());
    }
    let x = ((crop.x.clamp(0.0, 1.0) * image_width as f64).floor() as u32)
        .min(image_width - 1);
    let y = ((crop.y.clamp(0.0, 1.0) * image_height as f64).floor() as u32)
        .min(image_height - 1);
    let width = ((crop.width.clamp(0.0, 1.0) * image_width as f64).round() as u32)
        .max(1)
        .min(image_width - x);
    let height = ((crop.height.clamp(0.0, 1.0) * image_height as f64).round() as u32)
        .max(1)
        .min(image_height - y);
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    decoded
        .crop_imm(x, y, width, height)
        .save_with_format(&target, ImageFormat::Png)
        .map_err(|error| format!("无法保存裁剪图片：{error}"))?;
    file_result(&target)
}

#[tauri::command]
pub async fn file_crop_image(
    source: String,
    target: String,
    crop: ImageCropRect,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || crop_image(source, target, crop))
        .await
        .map_err(|error| format!("图片裁剪任务异常：{error}"))?
}

fn colored_pencil_filter(source: &RgbaImage) -> RgbaImage {
    let (width, height) = source.dimensions();
    if width == 0 || height == 0 {
        return source.clone();
    }
    let smoothed = imageops::blur(source, 0.65);
    let tone_smoothed =
        imageops::blur(source, ((width.min(height) as f32) / 520.0).clamp(1.6, 3.8));
    let mut luminance = vec![0.0f32; (width as usize).saturating_mul(height as usize)];
    let mut inverted = RgbaImage::new(width, height);
    for (x, y, pixel) in smoothed.enumerate_pixels() {
        let [red, green, blue, _] = pixel.0;
        let value = 0.299 * red as f32 + 0.587 * green as f32 + 0.114 * blue as f32;
        luminance[(y * width + x) as usize] = value;
        let inverse = (255.0 - value).clamp(0.0, 255.0) as u8;
        inverted.put_pixel(x, y, Rgba([inverse, inverse, inverse, pixel[3]]));
    }
    let sketch_blur = imageops::blur(
        &inverted,
        ((width.min(height) as f32) / 420.0).clamp(1.8, 5.0),
    );
    let mut edges = vec![0.0f32; luminance.len()];
    if width > 2 && height > 2 {
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let sample = |offset_x: i32, offset_y: i32| -> f32 {
                    let px = (x as i32 + offset_x) as u32;
                    let py = (y as i32 + offset_y) as u32;
                    luminance[(py * width + px) as usize]
                };
                let gradient_x = -sample(-1, -1) + sample(1, -1) - 2.0 * sample(-1, 0)
                    + 2.0 * sample(1, 0)
                    - sample(-1, 1)
                    + sample(1, 1);
                let gradient_y = -sample(-1, -1) - 2.0 * sample(0, -1) - sample(1, -1)
                    + sample(-1, 1)
                    + 2.0 * sample(0, 1)
                    + sample(1, 1);
                edges[(y * width + x) as usize] =
                    (gradient_x.mul_add(gradient_x, gradient_y * gradient_y)).sqrt();
            }
        }
    }

    let mut output = RgbaImage::new(width, height);
    for (x, y, original) in source.enumerate_pixels() {
        let smooth = smoothed.get_pixel(x, y);
        let base_luminance = luminance[(y * width + x) as usize];
        let blurred_inverse = sketch_blur.get_pixel(x, y)[0] as f32;
        let sketch =
            (base_luminance * 255.0 / (256.0 - blurred_inverse).max(1.0)).clamp(0.0, 255.0);
        let edge = (edges[(y * width + x) as usize] * 0.1).min(48.0);
        let mut hash = x.wrapping_mul(0x9e37_79b9) ^ y.wrapping_mul(0x85eb_ca6b);
        hash ^= hash >> 16;
        hash = hash.wrapping_mul(0x7feb_352d);
        hash ^= hash >> 15;
        let fine_grain = ((hash & 255) as f32 / 255.0 - 0.5) * 3.2;
        let mut coarse_hash = (x / 3).wrapping_mul(0x27d4_eb2d) ^ (y / 3).wrapping_mul(0x1656_67b1);
        coarse_hash ^= coarse_hash >> 15;
        let coarse_grain = ((coarse_hash & 255) as f32 / 255.0 - 0.5) * 2.2;
        let grain = fine_grain + coarse_grain;
        let darkness = 1.0 - base_luminance / 255.0;
        let tone_pixel = tone_smoothed.get_pixel(x, y);
        let tone_luminance = 0.299 * tone_pixel[0] as f32
            + 0.587 * tone_pixel[1] as f32
            + 0.114 * tone_pixel[2] as f32;
        let local_detail = ((base_luminance - tone_luminance).abs() / 22.0).min(1.0);
        let dark_detail = (tone_luminance - base_luminance).max(0.0).min(32.0);
        let stroke_pressure =
            0.1 + darkness.powf(1.08) * (0.5 + 0.5 * (edge / 48.0).max(local_detail));
        let jitter = (hash >> 8) & 3;
        let alternate_direction = ((x / 56) + (y / 56)) % 2 == 1;
        let primary_index = if alternate_direction {
            (x * 2 + height - (y % height) + jitter) % 11
        } else {
            (x + y * 2 + jitter) % 11
        };
        let cross_index = if alternate_direction {
            (x + y * 2 + jitter) % 17
        } else {
            (x * 2 + height - (y % height) + jitter) % 17
        };
        let primary_hatch = match primary_index {
            0 => 28.0 * stroke_pressure,
            1 => 12.0 * stroke_pressure,
            _ => 0.0,
        };
        let cross_hatch = if darkness > 0.36 {
            match cross_index {
                0 => 20.0 * stroke_pressure,
                1 => 8.0 * stroke_pressure,
                _ => 0.0,
            }
        } else {
            0.0
        };
        let hatch = primary_hatch + cross_hatch;
        let mut result = [0u8; 4];
        for channel in 0..3 {
            let detail = original[channel] as f32 - smooth[channel] as f32;
            let detailed = smooth[channel] as f32 + detail * 0.55;
            let colored = base_luminance + (detailed - base_luminance) * 3.0;
            let paper_lift = 255.0 - (255.0 - colored) * 0.68;
            let sketch_factor = 0.58 + 0.42 * (sketch / 255.0);
            let pencil = (paper_lift * sketch_factor - edge * 0.65 - dark_detail * 0.9 - hatch
                + grain)
                .clamp(0.0, 255.0);
            let effect_mix = 0.78;
            let blended = original[channel] as f32 * (1.0 - effect_mix) + pencil * effect_mix;
            let contrasted = 140.0 + (blended - 140.0) * 1.22;
            let paper_tint = [1.0, 0.0, -1.0][channel];
            result[channel] = (contrasted + paper_tint).clamp(0.0, 255.0) as u8;
        }
        result[3] = original[3];
        output.put_pixel(x, y, Rgba(result));
    }
    output
}

fn apply_colored_pencil(source: String, target: String) -> Result<Value, String> {
    let source = PathBuf::from(source);
    if !source.is_file() {
        return Err("彩铅处理的原图文件不存在".into());
    }
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut decoder = ImageReader::open(&source)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .into_decoder()
        .map_err(|error| format!("无法读取彩铅处理原图：{error}"))?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut decoded = DynamicImage::from_decoder(decoder)
        .map_err(|error| format!("无法解码彩铅处理原图：{error}"))?;
    decoded.apply_orientation(orientation);
    let output = colored_pencil_filter(&decoded.to_rgba8());
    DynamicImage::ImageRgba8(output)
        .save_with_format(&target, ImageFormat::Png)
        .map_err(|error| format!("无法保存彩铅图片：{error}"))?;
    file_result(&target)
}

#[tauri::command]
pub async fn file_apply_colored_pencil(source: String, target: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || apply_colored_pencil(source, target))
        .await
        .map_err(|error| format!("彩铅处理任务异常：{error}"))?
}

#[tauri::command]
pub fn file_write(path: String, data: String, append: bool) -> Result<Value, String> {
    let path = PathBuf::from(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|error| error.to_string())?;
    if append {
        use std::io::Write;
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut file| file.write_all(&bytes))
            .map_err(|error| error.to_string())?;
    } else {
        fs::write(&path, bytes).map_err(|error| error.to_string())?;
    }
    file_result(&path)
}

#[tauri::command]
pub fn file_copy(source: String, target: String) -> Result<Value, String> {
    let target = PathBuf::from(target);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, &target).map_err(|error| error.to_string())?;
    file_result(&target)
}

fn default_playback_speed() -> f64 {
    1.0
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEditorProject {
    settings: VideoEditorSettings,
    #[serde(default)]
    assets: Vec<VideoEditorAsset>,
    #[serde(default)]
    tracks: Vec<VideoEditorTrack>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorSettings {
    width: u32,
    height: u32,
    fps: f64,
    #[serde(default = "default_video_background")]
    background_color: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorAsset {
    id: String,
    #[serde(rename = "type")]
    asset_type: String,
    #[serde(default)]
    source_file: String,
    #[serde(default)]
    source_url: String,
    #[serde(default)]
    duration: f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorTrack {
    #[serde(rename = "type")]
    track_type: String,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    muted: bool,
    #[serde(default)]
    clips: Vec<VideoEditorClip>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorClip {
    id: String,
    #[serde(rename = "type")]
    clip_type: String,
    #[serde(default)]
    asset_id: String,
    #[serde(default)]
    timeline_start: f64,
    #[serde(default)]
    trim_start: f64,
    #[serde(default)]
    trim_end: f64,
    #[serde(default = "default_playback_speed")]
    speed: f64,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    muted: bool,
    #[serde(default = "default_clip_volume")]
    volume: f64,
    #[serde(default)]
    text: String,
    #[serde(default)]
    transform: VideoEditorTransform,
    #[serde(default)]
    style: VideoEditorTextStyle,
    #[serde(default)]
    effect_key: String,
    #[serde(default)]
    transition_key: String,
    #[serde(default)]
    from_clip_id: Option<String>,
    #[serde(default)]
    to_clip_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorTransform {
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default)]
    width: f64,
    #[serde(default)]
    height: f64,
    #[serde(default)]
    angle: f64,
    #[serde(default = "default_clip_opacity")]
    opacity: f64,
}

impl Default for VideoEditorTransform {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
            angle: 0.0,
            opacity: 1.0,
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VideoEditorTextStyle {
    #[serde(default = "default_text_size")]
    font_size: f64,
    #[serde(default = "default_text_color")]
    color: String,
}

impl Default for VideoEditorTextStyle {
    fn default() -> Self {
        Self {
            font_size: default_text_size(),
            color: default_text_color(),
        }
    }
}

fn default_video_background() -> String {
    "#050608".into()
}
fn default_clip_volume() -> f64 {
    1.0
}
fn default_clip_opacity() -> f64 {
    1.0
}
fn default_text_size() -> f64 {
    72.0
}
fn default_text_color() -> String {
    "#ffffff".into()
}

fn editor_clip_duration(clip: &VideoEditorClip) -> f64 {
    if clip.clip_type == "video" || clip.clip_type == "audio" {
        (clip.trim_end - clip.trim_start).max(0.0) / clip.speed.clamp(0.5, 2.0)
    } else {
        clip.duration.max(0.0)
    }
}

fn video_editor_duration(project: &VideoEditorProject) -> f64 {
    project
        .tracks
        .iter()
        .filter(|track| !track.hidden)
        .flat_map(|track| track.clips.iter())
        .map(|clip| clip.timeline_start + editor_clip_duration(clip))
        .fold(0.0, f64::max)
}

fn local_editor_asset(asset: &VideoEditorAsset) -> Result<PathBuf, String> {
    let candidate = if !asset.source_file.trim().is_empty() {
        &asset.source_file
    } else {
        &asset.source_url
    };
    let path = PathBuf::from(candidate);
    if !path.is_file() {
        return Err(format!(
            "剪辑素材尚未落盘或文件不存在：{}（{}）",
            asset.id, candidate
        ));
    }
    Ok(path)
}

fn filter_color(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|item| item.is_ascii_hexdigit())
    {
        format!("0x{}", &value[1..])
    } else {
        fallback.into()
    }
}

fn editor_font() -> Result<FontArc, String> {
    let candidates = [
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\arial.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    for candidate in candidates {
        let Ok(bytes) = fs::read(candidate) else {
            continue;
        };
        if let Ok(font) = FontArc::try_from_vec(bytes) {
            return Ok(font);
        }
    }
    Err("未找到可用于字幕导出的系统字体".into())
}

fn text_rgba(value: &str) -> [u8; 4] {
    let value = value.trim().trim_start_matches('#');
    if value.len() == 6 {
        if let (Ok(r), Ok(g), Ok(b)) = (
            u8::from_str_radix(&value[0..2], 16),
            u8::from_str_radix(&value[2..4], 16),
            u8::from_str_radix(&value[4..6], 16),
        ) {
            return [r, g, b, 255];
        }
    }
    [255, 255, 255, 255]
}

fn render_editor_text(path: &Path, clip: &VideoEditorClip) -> Result<(u32, u32), String> {
    let font = editor_font()?;
    let font_size = clip.style.font_size.clamp(6.0, 600.0) as f32;
    let scale = PxScale::from(font_size);
    let scaled = font.as_scaled(scale);
    let line_height = (scaled.ascent() - scaled.descent() + scaled.line_gap())
        .ceil()
        .max(font_size) as u32;
    let lines: Vec<&str> = clip.text.lines().collect();
    let line_width = |line: &str| -> f32 {
        let mut width = 0.0;
        let mut previous = None;
        for character in line.chars() {
            let id = font.glyph_id(character);
            if let Some(prev) = previous {
                width += scaled.kern(prev, id);
            }
            width += scaled.h_advance(id);
            previous = Some(id);
        }
        width
    };
    let measured_width = lines
        .iter()
        .map(|line| line_width(line))
        .fold(1.0, f32::max)
        .ceil() as u32;
    let requested_width = if clip.transform.width > 0.0 {
        clip.transform.width.round() as u32
    } else {
        measured_width + 8
    };
    let width = requested_width.clamp(1, 8192);
    let height = ((lines.len().max(1) as u32) * line_height + 8).clamp(1, 8192);
    let color = text_rgba(&clip.style.color);
    let mut image = RgbaImage::new(width, height);
    for (line_index, line) in lines.iter().enumerate() {
        let mut cursor = 4.0f32;
        let baseline = 4.0 + scaled.ascent() + line_index as f32 * line_height as f32;
        let mut previous = None;
        for character in line.chars() {
            let id = font.glyph_id(character);
            if let Some(prev) = previous {
                cursor += scaled.kern(prev, id);
            }
            let glyph = id.with_scale_and_position(scale, point(cursor, baseline));
            if let Some(outlined) = font.outline_glyph(glyph) {
                let bounds = outlined.px_bounds();
                outlined.draw(|x, y, coverage| {
                    let px = bounds.min.x.floor() as i32 + x as i32;
                    let py = bounds.min.y.floor() as i32 + y as i32;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        return;
                    }
                    let alpha = (coverage * color[3] as f32).round().clamp(0.0, 255.0) as u8;
                    image.put_pixel(
                        px as u32,
                        py as u32,
                        Rgba([color[0], color[1], color[2], alpha]),
                    );
                });
            }
            cursor += scaled.h_advance(id);
            previous = Some(id);
        }
    }
    DynamicImage::ImageRgba8(image)
        .save(path)
        .map_err(|error| format!("无法生成字幕图层：{error}"))?;
    Ok((width, height))
}

fn validate_video_editor_project(project: &VideoEditorProject) -> Result<(), String> {
    if project.settings.width < 16
        || project.settings.height < 16
        || project.settings.width > 8192
        || project.settings.height > 8192
    {
        return Err("剪辑工程画布尺寸必须在 16 到 8192 像素之间".into());
    }
    if !project.settings.fps.is_finite() || !(1.0..=120.0).contains(&project.settings.fps) {
        return Err("剪辑工程帧率必须在 1 到 120 FPS 之间".into());
    }
    let duration = video_editor_duration(project);
    if !duration.is_finite() || duration < 0.04 || duration > 86_400.0 {
        return Err("剪辑工程时长无效或超过 24 小时".into());
    }
    let clip_count: usize = project.tracks.iter().map(|track| track.clips.len()).sum();
    if clip_count == 0 || clip_count > 2_000 {
        return Err("剪辑工程片段数量必须在 1 到 2000 之间".into());
    }
    for track in &project.tracks {
        if !matches!(
            track.track_type.as_str(),
            "video" | "audio" | "text" | "overlay" | "effect" | "transition"
        ) {
            return Err(format!("不支持的剪辑轨道类型：{}", track.track_type));
        }
        for clip in &track.clips {
            if !clip.timeline_start.is_finite()
                || clip.timeline_start < 0.0
                || editor_clip_duration(clip) < 0.04
            {
                return Err(format!("剪辑片段时间无效：{}", clip.id));
            }
        }
    }
    for asset in &project.assets {
        if !asset.duration.is_finite() || asset.duration < 0.0 {
            return Err(format!("剪辑素材时长无效：{}", asset.id));
        }
    }
    Ok(())
}

fn media_tool(name: &str) -> Result<PathBuf, String> {
    let executable = if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_exe() {
        if let Some(directory) = current.parent() {
            candidates.push(directory.join(&executable));
            candidates.push(directory.join("resources").join(&executable));
            if let Some(contents) = directory.parent() {
                candidates.push(contents.join("Resources").join(&executable));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(format!("/opt/homebrew/bin/{name}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
    }
    #[cfg(target_os = "windows")]
    candidates.push(PathBuf::from(&executable));
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        candidates.push(PathBuf::from(format!("/usr/bin/{name}")));
        candidates.push(PathBuf::from(format!("/usr/local/bin/{name}")));
    }
    candidates.push(PathBuf::from(&executable));

    candidates
        .into_iter()
        .find(|candidate| {
            Command::new(candidate)
                .arg("-version")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
        .ok_or_else(|| format!("未找到 {name}。请安装 FFmpeg，或将 {executable} 放入应用资源目录"))
}

fn source_has_audio(ffmpeg: &Path, source: &Path) -> bool {
    Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(source)
        .args(["-map", "0:a:0", "-frames:a", "1", "-f", "null", "-"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn file_has_audio(source: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || probe_audio(source))
        .await
        .map_err(|error| format!("音轨检测任务异常：{error}"))?
}

fn probe_audio(source: String) -> Result<bool, String> {
    let source = PathBuf::from(source);
    if !source.is_file() {
        return Err("视频文件不存在".into());
    }
    let ffmpeg = media_tool("ffmpeg")?;
    Ok(source_has_audio(&ffmpeg, &source))
}

fn separate_audio(
    source: String,
    audio_target: String,
    silent_video_target: String,
) -> Result<Value, String> {
    let source = PathBuf::from(source);
    if !source.is_file() {
        return Err("视频文件不存在".into());
    }
    let ffmpeg = media_tool("ffmpeg")?;
    if !source_has_audio(&ffmpeg, &source) {
        return Err("当前视频不包含可分离的音轨".into());
    }
    let audio_target = PathBuf::from(audio_target);
    let silent_video_target = PathBuf::from(silent_video_target);
    for target in [&audio_target, &silent_video_target] {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建拆分目录：{error}"))?;
        }
    }
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&source)
        .args(["-map", "0:a:0", "-vn", "-c:a", "aac", "-b:a", "192k"])
        .arg(&audio_target)
        .args(["-map", "0:v:0", "-an", "-c:v", "copy", "-movflags", "+faststart"])
        .arg(&silent_video_target)
        .output()
        .map_err(|error| format!("无法启动音频分离：{error}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&audio_target);
        let _ = fs::remove_file(&silent_video_target);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "音频分离失败".into()
        } else {
            detail
        });
    }
    Ok(json!({
        "audio": file_result(&audio_target)?,
        "video": file_result(&silent_video_target)?,
    }))
}

#[tauri::command]
pub async fn file_separate_audio(
    source: String,
    audio_target: String,
    silent_video_target: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        separate_audio(source, audio_target, silent_video_target)
    })
    .await
    .map_err(|error| format!("音视频拆分任务异常：{error}"))?
}

fn export_video_editor_project(
    target: String,
    project: VideoEditorProject,
) -> Result<Value, String> {
    validate_video_editor_project(&project)?;
    let target = PathBuf::from(target);
    let parent = target.parent().ok_or("导出路径无效")?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建导出目录：{error}"))?;
    if !target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("mp4")
    {
        return Err("剪辑当前只支持导出 MP4".into());
    }

    let duration = video_editor_duration(&project);
    let mut referenced_assets = Vec::<(&VideoEditorAsset, PathBuf)>::new();
    for track in project.tracks.iter().filter(|track| !track.hidden) {
        for clip in &track.clips {
            if !matches!(clip.clip_type.as_str(), "video" | "audio" | "image") {
                continue;
            }
            if referenced_assets
                .iter()
                .any(|(asset, _)| asset.id == clip.asset_id)
            {
                continue;
            }
            let asset = project
                .assets
                .iter()
                .find(|asset| asset.id == clip.asset_id)
                .ok_or_else(|| format!("剪辑片段引用了不存在的素材：{}", clip.asset_id))?;
            referenced_assets.push((asset, local_editor_asset(asset)?));
        }
    }
    let asset_input_index = |asset_id: &str| -> Option<usize> {
        referenced_assets
            .iter()
            .position(|(asset, _)| asset.id == asset_id)
            .map(|index| index + 1)
    };

    let visible_clips = project
        .tracks
        .iter()
        .filter(|track| !track.hidden)
        .flat_map(|track| track.clips.iter().map(move |clip| (track, clip)))
        .collect::<Vec<_>>();
    if let [(track, clip)] = visible_clips.as_slice() {
        if clip.clip_type == "video" && !track.muted && !clip.muted {
            if let Some((asset, source)) = referenced_assets
                .iter()
                .find(|(asset, _)| asset.id == clip.asset_id)
            {
                let source_is_mp4 = source
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("mp4"));
                let unchanged = clip.timeline_start.abs() < 0.000_001
                    && clip.trim_start.abs() < 0.000_001
                    && (clip.trim_end - asset.duration).abs() < 0.002
                    && (clip.speed - 1.0).abs() < 0.000_001
                    && clip.transform.x.abs() < 0.001
                    && clip.transform.y.abs() < 0.001
                    && clip.transform.angle.abs() < 0.001
                    && (clip.transform.opacity - 1.0).abs() < 0.001
                    && (clip.transform.width - project.settings.width as f64).abs() < 0.5
                    && (clip.transform.height - project.settings.height as f64).abs() < 0.5;
                if source_is_mp4 && unchanged {
                    if source != &target {
                        fs::copy(source, &target)
                            .map_err(|error| format!("无法复制原视频：{error}"))?;
                    }
                    let mut result = file_result(&target)?;
                    if let Some(object) = result.as_object_mut() {
                        object.insert("duration".into(), json!(duration));
                        object.insert("trackCount".into(), json!(project.tracks.len()));
                        object.insert("assetCount".into(), json!(project.assets.len()));
                        object.insert("engine".into(), json!("direct-mp4-copy"));
                    }
                    return Ok(result);
                }
            }
        }
    }

    let ffmpeg = media_tool("ffmpeg")?;

    let mut command = Command::new(&ffmpeg);
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
        ])
        .arg(format!(
            "color=c={}:s={}x{}:r={:.3}:d={:.6}",
            filter_color(&project.settings.background_color, "0x050608"),
            project.settings.width,
            project.settings.height,
            project.settings.fps,
            duration
        ));
    for (asset, path) in &referenced_assets {
        if asset.asset_type == "image" {
            command
                .args(["-loop", "1", "-framerate"])
                .arg(format!("{:.3}", project.settings.fps));
        }
        command.arg("-i").arg(path);
    }

    let mut filters = vec!["[0:v]format=rgba[canvas0]".to_string()];
    let mut canvas_label = "canvas0".to_string();
    let mut audio_labels = Vec::new();
    let mut visual_index = 0usize;
    let mut audio_index = 0usize;
    let mut text_files = Vec::new();
    let transition_clips: Vec<&VideoEditorClip> = project
        .tracks
        .iter()
        .filter(|track| !track.hidden)
        .flat_map(|track| track.clips.iter())
        .filter(|clip| clip.clip_type == "transition")
        .collect();

    for track in project.tracks.iter().filter(|track| !track.hidden) {
        for clip in &track.clips {
            let clip_duration = editor_clip_duration(clip);
            let clip_end = clip.timeline_start + clip_duration;
            if clip.clip_type == "video" || clip.clip_type == "image" {
                let input = asset_input_index(&clip.asset_id)
                    .ok_or_else(|| format!("找不到片段素材输入：{}", clip.id))?;
                let width = if clip.transform.width > 0.0 {
                    clip.transform.width.round() as u32
                } else {
                    project.settings.width
                };
                let height = if clip.transform.height > 0.0 {
                    clip.transform.height.round() as u32
                } else {
                    project.settings.height
                };
                let source_filter = if clip.clip_type == "video" {
                    let mut value = format!(
                        "trim=start={:.6}:end={:.6},setpts=(PTS-STARTPTS)/{:.6}",
                        clip.trim_start, clip.trim_end, clip.speed
                    );
                    if let Some(transition) = transition_clips
                        .iter()
                        .find(|item| item.to_clip_id.as_deref() == Some(clip.id.as_str()))
                    {
                        let transition_duration = editor_clip_duration(transition)
                            .min(clip_duration / 2.0)
                            .max(0.04);
                        value.push_str(&format!(
                            ",fade=t=in:st=0:d={transition_duration:.6}:alpha=1"
                        ));
                    }
                    if let Some(transition) = transition_clips
                        .iter()
                        .find(|item| item.from_clip_id.as_deref() == Some(clip.id.as_str()))
                    {
                        let transition_duration = editor_clip_duration(transition)
                            .min(clip_duration / 2.0)
                            .max(0.04);
                        value.push_str(&format!(
                            ",fade=t=out:st={:.6}:d={transition_duration:.6}:alpha=1",
                            (clip_duration - transition_duration).max(0.0)
                        ));
                    }
                    value
                } else {
                    format!("trim=duration={clip_duration:.6},setpts=PTS-STARTPTS")
                };
                let angle = clip.transform.angle.to_radians();
                let opacity = clip.transform.opacity.clamp(0.0, 1.0);
                let rotation_filter = if angle.abs() < 0.000_001 {
                    String::new()
                } else {
                    format!(",rotate={angle:.8}:ow=rotw(iw):oh=roth(ih):c=none")
                };
                filters.push(format!(
                    "[{input}:v]{source_filter},scale={width}:{height}:force_original_aspect_ratio=decrease,setsar=1,format=rgba{rotation_filter},colorchannelmixer=aa={opacity:.5},setpts=PTS+{:.6}/TB[visual{visual_index}]",
                    clip.timeline_start
                ));
                let next_canvas = format!("canvas{}", visual_index + 1);
                filters.push(format!(
                    "[{canvas_label}][visual{visual_index}]overlay=x={:.3}:y={:.3}:eof_action=pass:shortest=0:enable='between(t,{:.6},{:.6})'[{next_canvas}]",
                    clip.transform.x, clip.transform.y, clip.timeline_start, clip_end
                ));
                canvas_label = next_canvas;
                visual_index += 1;
            }

            if clip.clip_type == "text" {
                let text_path = parent.join(format!(
                    ".shotloom-text-{}-{text_files_len}.png",
                    chrono_stamp(),
                    text_files_len = text_files.len()
                ));
                let (text_width, text_height) = render_editor_text(&text_path, clip)?;
                let input = referenced_assets.len() + text_files.len() + 1;
                command
                    .args(["-loop", "1", "-framerate"])
                    .arg(format!("{:.3}", project.settings.fps))
                    .arg("-i")
                    .arg(&text_path);
                filters.push(format!(
                    "[{input}:v]trim=duration={clip_duration:.6},format=rgba,colorchannelmixer=aa={:.5},setpts=PTS-STARTPTS+{:.6}/TB[text-layer-{}]",
                    clip.transform.opacity.clamp(0.0, 1.0), clip.timeline_start, text_files.len()
                ));
                let next_canvas = format!("canvas-text-{}", text_files.len());
                filters.push(format!(
                    "[{canvas_label}][text-layer-{}]overlay=x={:.3}:y={:.3}:eof_action=pass:shortest=0:enable='between(t,{:.6},{:.6})'[{next_canvas}]",
                    text_files.len(), clip.transform.x, clip.transform.y, clip.timeline_start, clip_end
                ));
                let _ = (text_width, text_height);
                text_files.push(text_path);
                canvas_label = next_canvas;
            }

            if clip.clip_type == "effect" {
                let effect = match clip.effect_key.as_str() {
                    "vignette" => Some("vignette=PI/5"),
                    "filmGrain" => Some("noise=alls=10:allf=t+u"),
                    "pixelate" => Some("boxblur=4:2"),
                    "glitch" => Some("lagfun=decay=0.92"),
                    "chromaticAberration" => Some("rgbashift=rh=3:bh=-3"),
                    _ => None,
                };
                if let Some(effect) = effect {
                    let next_canvas = format!("canvas-effect-{visual_index}");
                    filters.push(format!(
                        "[{canvas_label}]{effect}:enable='between(t,{:.6},{:.6})'[{next_canvas}]",
                        clip.timeline_start, clip_end
                    ));
                    canvas_label = next_canvas;
                    visual_index += 1;
                }
            }

            if (clip.clip_type == "video" || clip.clip_type == "audio")
                && !clip.muted
                && !track.muted
            {
                let input = asset_input_index(&clip.asset_id)
                    .ok_or_else(|| format!("找不到音频素材输入：{}", clip.id))?;
                let asset = referenced_assets
                    .iter()
                    .find(|(asset, _)| asset.id == clip.asset_id)
                    .unwrap();
                if source_has_audio(&ffmpeg, &asset.1) {
                    let delay = (clip.timeline_start * 1000.0).round().max(0.0) as u64;
                    filters.push(format!(
                        "[{input}:a]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,atempo={:.6},volume={:.5},adelay={delay}:all=1[audio{audio_index}]",
                        clip.trim_start, clip.trim_end, clip.speed, clip.volume.clamp(0.0, 2.0)
                    ));
                    audio_labels.push(format!("[audio{audio_index}]"));
                    audio_index += 1;
                }
            }
        }
    }
    filters.push(format!("[{canvas_label}]format=yuv420p[outv]"));
    if !audio_labels.is_empty() {
        filters.push(format!("{}amix=inputs={}:normalize=0:dropout_transition=0,atrim=duration={duration:.6},asetpts=N/SR/TB[outa]", audio_labels.join(""), audio_labels.len()));
    }

    let temp = parent.join(format!(".shotloom-project-export-{}.mp4", chrono_stamp()));
    command
        .arg("-filter_complex")
        .arg(filters.join(";"))
        .args(["-map", "[outv]"]);
    if audio_labels.is_empty() {
        command.arg("-an");
    } else {
        command.args(["-map", "[outa]", "-c:a", "aac", "-b:a", "192k"]);
    }
    let output = command
        .args(["-t"])
        .arg(format!("{duration:.6}"))
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
        ])
        .arg(&temp)
        .output()
        .map_err(|error| format!("无法启动 FFmpeg：{error}"))?;
    for path in text_files {
        let _ = fs::remove_file(path);
    }
    if !output.status.success() {
        let _ = fs::remove_file(&temp);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail = stderr
            .chars()
            .rev()
            .take(4000)
            .collect::<String>()
            .chars()
            .rev()
            .collect::<String>();
        return Err(format!("多轨视频导出失败：{}", detail.trim()));
    }
    if target.exists() {
        fs::remove_file(&target).map_err(|error| format!("无法替换导出文件：{error}"))?;
    }
    fs::rename(&temp, &target).map_err(|error| format!("无法完成导出文件：{error}"))?;
    let mut result = file_result(&target)?;
    if let Some(object) = result.as_object_mut() {
        object.insert("duration".into(), json!(duration));
        object.insert("trackCount".into(), json!(project.tracks.len()));
        object.insert("assetCount".into(), json!(project.assets.len()));
        object.insert("engine".into(), json!("rust-ffmpeg-v2"));
        object.insert("transitionCount".into(), json!(transition_clips.len()));
        object.insert(
            "transitionTypes".into(),
            json!(transition_clips
                .iter()
                .map(|clip| clip.transition_key.as_str())
                .collect::<Vec<_>>()),
        );
    }
    Ok(result)
}

#[tauri::command]
pub async fn file_export_video_project(
    target: String,
    project: VideoEditorProject,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || export_video_editor_project(target, project))
        .await
        .map_err(|error| format!("多轨视频导出任务异常：{error}"))?
}

#[cfg(test)]
mod video_edit_tests {
    use super::*;

    #[test]
    fn unchanged_single_mp4_exports_without_ffmpeg() {
        let root = std::env::temp_dir().join(format!("shotloom-direct-video-{}", chrono_stamp()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let target = root.join("export.mp4");
        fs::write(&source, b"shotloom-mp4-passthrough").unwrap();
        let project: VideoEditorProject = serde_json::from_value(json!({
            "settings": { "width": 1248, "height": 704, "fps": 30, "backgroundColor": "#050608" },
            "assets": [{ "id": "source", "type": "video", "sourceFile": source, "duration": 15.084 }],
            "tracks": [{ "type": "video", "clips": [{
                "id": "v1", "type": "video", "assetId": "source", "timelineStart": 0,
                "trimStart": 0, "trimEnd": 15.084, "speed": 1,
                "transform": { "x": 0, "y": 0, "width": 1248, "height": 704, "angle": 0, "opacity": 1 }
            }]}]
        })).unwrap();
        let result =
            export_video_editor_project(target.to_string_lossy().into_owned(), project).unwrap();
        assert_eq!(result["engine"], "direct-mp4-copy");
        assert_eq!(fs::read(&target).unwrap(), b"shotloom-mp4-passthrough");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ffmpeg_export_preserves_full_frame_when_source_sar_is_unspecified() {
        let Ok(ffmpeg) = media_tool("ffmpeg") else {
            return;
        };
        let root = std::env::temp_dir().join(format!("shotloom-video-sar-{}", chrono_stamp()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let target = root.join("export.mp4");
        let frame = root.join("frame.png");
        let generated = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "color=c=0x147ad6:s=320x180:r=24:d=1",
                "-vf",
                "setsar=0",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(generated.success());
        let project: VideoEditorProject = serde_json::from_value(json!({
            "settings": { "width": 320, "height": 180, "fps": 24, "backgroundColor": "#050608" },
            "assets": [{ "id": "source", "type": "video", "sourceFile": source, "duration": 1 }],
            "tracks": [{ "type": "video", "clips": [{
                "id": "v1", "type": "video", "assetId": "source", "timelineStart": 0,
                "trimStart": 0.1, "trimEnd": 0.9, "speed": 1,
                "transform": { "x": 0, "y": 0, "width": 320, "height": 180, "angle": 0, "opacity": 1 }
            }]}]
        })).unwrap();
        export_video_editor_project(target.to_string_lossy().into_owned(), project).unwrap();
        let extracted = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                "0.2",
                "-i",
            ])
            .arg(&target)
            .args(["-frames:v", "1"])
            .arg(&frame)
            .status()
            .unwrap();
        assert!(extracted.success());
        let pixels = image::open(&frame).unwrap().to_rgb8();
        let top_left = pixels.get_pixel(8, 8);
        assert!(top_left[2] > 150, "top-left pixel was {top_left:?}");
        assert!(top_left[0] < 80, "top-left pixel was {top_left:?}");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ffmpeg_exports_v2_project_with_overlay_text_audio_and_effect() {
        let Ok(ffmpeg) = media_tool("ffmpeg") else {
            return;
        };
        let root = std::env::temp_dir().join(format!("shotloom-video-project-{}", chrono_stamp()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("source.mp4");
        let sticker = root.join("sticker.png");
        let target = root.join("project.mp4");
        let generated = Command::new(&ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=320x180:rate=25",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=44100",
                "-t",
                "3",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
            ])
            .arg(&source)
            .status()
            .unwrap();
        assert!(generated.success());
        let mut image = RgbaImage::new(48, 48);
        for pixel in image.pixels_mut() {
            *pixel = Rgba([214, 255, 73, 230]);
        }
        DynamicImage::ImageRgba8(image).save(&sticker).unwrap();
        let project: VideoEditorProject = serde_json::from_value(json!({
            "settings": { "width": 320, "height": 180, "fps": 25, "backgroundColor": "#050608" },
            "assets": [
                { "id": "source", "type": "video", "sourceFile": source, "duration": 3 },
                { "id": "sticker", "type": "image", "sourceFile": sticker, "duration": 0 }
            ],
            "tracks": [
                { "type": "video", "clips": [
                    { "id": "v1", "type": "video", "assetId": "source", "timelineStart": 0, "trimStart": 0, "trimEnd": 1.2, "speed": 1, "transform": { "width": 320, "height": 180 } },
                    { "id": "v2", "type": "video", "assetId": "source", "timelineStart": 1.2, "trimStart": 1.2, "trimEnd": 2.5, "speed": 1, "transform": { "width": 320, "height": 180 } }
                ]},
                { "type": "overlay", "clips": [{ "id": "o1", "type": "image", "assetId": "sticker", "timelineStart": 0.4, "duration": 1.2, "transform": { "x": 240, "y": 20, "width": 48, "height": 48, "opacity": 0.9 } }]},
                { "type": "text", "clips": [{ "id": "t1", "type": "text", "timelineStart": 0.2, "duration": 1.8, "text": "Shotloom", "transform": { "x": 20, "y": 140 }, "style": { "fontSize": 18, "color": "#ffffff" } }]},
                { "type": "transition", "clips": [{ "id": "tr1", "type": "transition", "timelineStart": 0.9, "duration": 0.6, "transitionKey": "fade", "fromClipId": "v1", "toClipId": "v2" }]},
                { "type": "effect", "clips": [{ "id": "fx1", "type": "effect", "timelineStart": 0, "duration": 2.5, "effectKey": "vignette" }]}
            ]
        })).unwrap();
        let result =
            export_video_editor_project(target.to_string_lossy().into_owned(), project).unwrap();
        assert!(target.is_file());
        assert!(fs::metadata(&target).unwrap().len() > 2_000);
        assert_eq!(result["engine"], "rust-ffmpeg-v2");
        assert_eq!(result["transitionCount"], 1);
        let _ = fs::remove_dir_all(root);
    }
}

#[tauri::command]
pub fn file_path_exists(path: String) -> Value {
    json!(Path::new(&path).exists())
}

#[tauri::command]
pub fn file_checksum(path: String) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(
        json!({"checksum":format!("{:x}", Sha256::digest(&bytes)),"checksumAlgorithm":"sha256","size":bytes.len()}),
    )
}

#[tauri::command]
pub fn file_resolve_unique_path(directory: String, name: String) -> Value {
    let directory = PathBuf::from(directory);
    let requested = sanitize_name(&name, "resource.bin");
    let requested_path = Path::new(&requested);
    let stem = requested_path
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("resource");
    let extension = requested_path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("");
    let mut target = directory.join(&requested);
    for index in 2..10_000 {
        if !target.exists() {
            break;
        }
        target = directory.join(if extension.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{extension}")
        });
    }
    json!(target.to_string_lossy())
}

#[cfg(test)]
mod colored_pencil_tests {
    use super::*;

    #[test]
    fn local_filter_preserves_size_and_alpha_while_transforming_pixels() {
        let mut source = RgbaImage::from_pixel(64, 32, Rgba([230, 150, 120, 255]));
        for y in 0..32 {
            for x in 32..64 {
                source.put_pixel(x, y, Rgba([40, 120, 220, 180]));
            }
        }
        let output = colored_pencil_filter(&source);
        assert_eq!(output.dimensions(), source.dimensions());
        assert_eq!(output.get_pixel(60, 16)[3], 180);
        assert_ne!(output.get_pixel(12, 16), source.get_pixel(12, 16));
        assert_ne!(output.get_pixel(60, 16), source.get_pixel(60, 16));
        let total_difference: u32 = output
            .pixels()
            .zip(source.pixels())
            .map(|(after, before)| {
                (0..3)
                    .map(|channel| after[channel].abs_diff(before[channel]) as u32)
                    .sum::<u32>()
            })
            .sum();
        assert!(total_difference > 50_000);
        assert!(
            total_difference < 300_000,
            "彩铅效果不应压过原图，当前 RGB 总偏差为 {total_difference}"
        );

        if let (Ok(sample), Ok(target)) = (
            std::env::var("SHOTLOOM_PENCIL_SAMPLE"),
            std::env::var("SHOTLOOM_PENCIL_TARGET"),
        ) {
            let image = image::open(sample).unwrap().to_rgba8();
            DynamicImage::ImageRgba8(colored_pencil_filter(&image))
                .save_with_format(target, ImageFormat::Png)
                .unwrap();
        }
    }

    #[test]
    fn local_filter_handles_tiny_images_without_changing_alpha() {
        for (width, height) in [(0, 0), (1, 1), (2, 2)] {
            let source = RgbaImage::from_pixel(width, height, Rgba([210, 140, 105, 96]));
            let output = colored_pencil_filter(&source);
            assert_eq!(output.dimensions(), source.dimensions());
            assert!(output.pixels().all(|pixel| pixel[3] == 96));
        }
    }
}
