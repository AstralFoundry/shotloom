#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.config().app.windows.first().ok_or("Missing main window")?;
            tauri::WebviewWindowBuilder::from_config(app, window)?
                .initialization_script("window.__SHOTLOOM_MOBILE__ = true;")
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Shotloom mobile");
}
