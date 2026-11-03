//! Native menus use the same JSON catalogs as the renderer.
#[cfg(any(target_os = "macos", test))]
use serde_json::Value;
#[cfg(any(target_os = "macos", test))]
use std::sync::LazyLock;

#[cfg(any(target_os = "macos", test))]
fn catalog(locale: &str) -> &'static Value {
    static ZH: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("../../renderer/src/i18n/locales/zh-CN.json")).expect("valid Chinese catalog"));
    static EN: LazyLock<Value> = LazyLock::new(|| serde_json::from_str(include_str!("../../renderer/src/i18n/locales/en-US.json")).expect("valid English catalog"));
    if locale == "en-US" { &EN } else { &ZH }
}

#[cfg(any(target_os = "macos", test))]
fn menu_text<'a>(catalog: &'a Value, key: &str) -> &'a str {
    catalog[key].as_str().expect("native menu translation exists")
}

/// Settings are saved before calling this; repeated non-language saves skip menu work.
pub(crate) fn sync(app: &tauri::AppHandle, settings: &serde_json::Value) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::Mutex;
        static CURRENT: Mutex<Option<String>> = Mutex::new(None);
        let locale = if settings["locale"] == "en-US" { "en-US" } else { "zh-CN" };
        if CURRENT.lock().unwrap().as_deref() == Some(locale) { return Ok(()); }
        // Remove the app-specific forced Chinese preference written by earlier builds.
        // System-owned panels then follow macOS; product menu titles use our catalog.
        let language_key = objc2_foundation::NSString::from_str("AppleLanguages");
        objc2_foundation::NSUserDefaults::standardUserDefaults().removeObjectForKey(&language_key);
        app.set_menu(macos_menu(app, locale).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        *CURRENT.lock().unwrap() = Some(locale.into());
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, settings);
    Ok(())
}

#[cfg(target_os = "macos")]
fn macos_menu(app: &tauri::AppHandle, locale: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

    let catalog = catalog(locale);
    let text = |key| menu_text(catalog, key);
    let separator = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Shotloom",
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(text("native.menu.about")), None)?,
                    &separator()?,
                    &PredefinedMenuItem::services(app, Some(text("native.menu.services")))?,
                    &separator()?,
                    &PredefinedMenuItem::hide(app, Some(text("native.menu.hide")))?,
                    &PredefinedMenuItem::hide_others(app, Some(text("native.menu.hideOthers")))?,
                    &PredefinedMenuItem::show_all(app, Some(text("native.menu.showAll")))?,
                    &separator()?,
                    &PredefinedMenuItem::quit(app, Some(text("native.menu.quit")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("native.menu.file"),
                true,
                &[&PredefinedMenuItem::close_window(app, Some(text("native.menu.closeWindow")))?],
            )?,
            &Submenu::with_items(
                app,
                text("native.menu.edit"),
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some(text("native.menu.undo")))?,
                    &PredefinedMenuItem::redo(app, Some(text("native.menu.redo")))?,
                    &separator()?,
                    &PredefinedMenuItem::cut(app, Some(text("native.menu.cut")))?,
                    &PredefinedMenuItem::copy(app, Some(text("native.menu.copy")))?,
                    &PredefinedMenuItem::paste(app, Some(text("native.menu.paste")))?,
                    &PredefinedMenuItem::select_all(app, Some(text("native.menu.selectAll")))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                text("native.menu.view"),
                true,
                &[&PredefinedMenuItem::fullscreen(app, Some(text("native.menu.fullscreen")))?],
            )?,
            &Submenu::with_items(
                app,
                text("native.menu.window"),
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some(text("native.menu.minimize")))?,
                    &PredefinedMenuItem::maximize(app, Some(text("native.menu.maximize")))?,
                    &separator()?,
                    &PredefinedMenuItem::close_window(app, Some(text("native.menu.closeWindow")))?,
                ],
            )?,
            &Submenu::with_items(app, text("native.menu.help"), true, &[])?,
        ],
    )
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_native_menu_label_has_both_translations() {
        let zh = catalog("zh-CN");
        let en = catalog("en-US");
        let keys: Vec<_> = zh.as_object().unwrap().keys().filter(|key| key.starts_with("native.menu.")).collect();
        assert_eq!(keys.len(), 21);
        for key in keys {
            assert!(!menu_text(zh, key).is_empty());
            assert!(!menu_text(en, key).is_empty());
        }
        assert_eq!(menu_text(en, "native.menu.file"), "File");
        assert_eq!(menu_text(catalog("unknown"), "native.menu.file"), "文件");
    }
}
