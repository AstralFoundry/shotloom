mod commands;

pub fn run() {
    let app = tauri::Builder::default()
        .manage(commands::AgentRuntimeState::new())
        .manage(commands::GenerationGatewayState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|_app| {
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
            commands::agent_runtime_request,
            commands::agent_runtime_subscribe,
            commands::agent_runtime_unsubscribe,
            commands::agent_runtime_register_tools,
            commands::agent_tool_reply,
            commands::agent_runtime_stop,
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
        }
    });
}
