use super::common::{app_data, file_result};
use base64::Engine;
use image::metadata::Orientation;
use image::{
    codecs::jpeg::JpegEncoder, imageops, DynamicImage, ExtendedColorType, ImageDecoder,
    ImageFormat, ImageReader, Rgba, RgbaImage,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs, path::{Path, PathBuf}, time::UNIX_EPOCH};
use tauri::AppHandle;

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
