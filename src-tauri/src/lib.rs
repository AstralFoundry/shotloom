mod commands;

#[cfg(target_os = "macos")]
fn prefer_simplified_chinese() {
    use objc2_foundation::{NSArray, NSString, NSUserDefaults};

    let language = NSString::from_str("zh-Hans");
    let languages = NSArray::from_retained_slice(&[language]);
    let key = NSString::from_str("AppleLanguages");
    unsafe {
        NSUserDefaults::standardUserDefaults().setObject_forKey(Some(&languages), &key);
    }
}

#[cfg(target_os = "macos")]
fn macos_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

    let separator = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "Shotloom",
                true,
                &[
                    &PredefinedMenuItem::about(app, Some("关于 Shotloom"), None)?,
                    &separator()?,
                    &PredefinedMenuItem::services(app, Some("服务"))?,
                    &separator()?,
                    &PredefinedMenuItem::hide(app, Some("隐藏 Shotloom"))?,
                    &PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?,
                    &PredefinedMenuItem::show_all(app, Some("全部显示"))?,
                    &separator()?,
                    &PredefinedMenuItem::quit(app, Some("退出 Shotloom"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "文件",
                true,
                &[&PredefinedMenuItem::close_window(app, Some("关闭窗口"))?],
            )?,
            &Submenu::with_items(
                app,
                "编辑",
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some("撤销"))?,
                    &PredefinedMenuItem::redo(app, Some("重做"))?,
                    &separator()?,
                    &PredefinedMenuItem::cut(app, Some("剪切"))?,
                    &PredefinedMenuItem::copy(app, Some("复制"))?,
                    &PredefinedMenuItem::paste(app, Some("粘贴"))?,
                    &PredefinedMenuItem::select_all(app, Some("全选"))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "显示",
                true,
                &[&PredefinedMenuItem::fullscreen(app, Some("进入全屏幕"))?],
            )?,
            &Submenu::with_items(
                app,
                "窗口",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some("最小化"))?,
                    &PredefinedMenuItem::maximize(app, Some("缩放"))?,
                    &separator()?,
                    &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
                ],
            )?,
            &Submenu::with_items(app, "帮助", true, &[])?,
        ],
    )
}

pub fn run() {
    #[cfg(target_os = "macos")]
    prefer_simplified_chinese();

    let builder = tauri::Builder::default()
        .manage(commands::AgentRuntimeState::new())
        .manage(commands::GenerationGatewayState::new())
        .manage(commands::RecoveryState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
    #[cfg(target_os = "macos")]
    let builder = builder.menu(macos_menu);

    let app = builder
        .setup(|_app| {
            commands::initialize(_app.handle())
                .map_err(|error| {
                    let boxed: Box<dyn std::error::Error> = Box::new(std::io::Error::other(error));
                    tauri::Error::Setup(boxed.into())
                })?;
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = _app.get_webview_window("main") {
                    window.set_decorations(false)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent_runtime_start,
            commands::agent_runtime_status,
            commands::agent_runtime_diagnostics,
            commands::agent_runtime_note_activity,
            commands::agent_runtime_request,
            commands::agent_runtime_subscribe,
            commands::agent_runtime_unsubscribe,
            commands::agent_runtime_register_tools,
            commands::agent_tool_reply,
            commands::agent_runtime_stop,
            commands::recovery_status,
            commands::recovery_update_activity,
            commands::generation_request,
            commands::generation_stream,
            commands::generation_download,
            commands::generation_cancel,
            commands::platform,
            commands::settings_get,
            commands::settings_set,
            commands::settings_set_token_group,
            commands::storage_get,
            commands::storage_set,
            commands::project_get_default_root,
            commands::project_ensure_root,
            commands::project_create_folder,
            commands::project_create_library_folder,
            commands::project_rename_entry,
            commands::project_clone_entry,
            commands::project_list_root,
            commands::project_save,
            commands::project_read_file,
            commands::project_open_folder,
            commands::project_export_package,
            commands::project_import_package,
            commands::project_create_episode_folder,
            commands::project_trash_entry,
            commands::recent_list,
            commands::recent_add,
            commands::recent_remove,
            commands::file_read_array_buffer,
            commands::file_read_image_preview,
            commands::file_apply_colored_pencil,
            commands::file_extract_audio,
            commands::file_global_asset_root,
            commands::file_trash,
            commands::file_show_item_in_folder,
            commands::file_export_resource_package,
            commands::file_import_resource_package,
            commands::file_write,
            commands::file_copy,
            commands::file_export_video_project,
            commands::file_path_exists,
            commands::file_checksum,
            commands::file_resolve_unique_path,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Shotloom");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            use tauri::Manager;
            let state = app_handle.state::<commands::AgentRuntimeState>();
            let _ = tauri::async_runtime::block_on(state.shutdown());
            let _ = commands::mark_clean_exit(app_handle);
        }
    });
}
