mod native_ui;
mod localized_error;
mod database;
mod models;
mod crud;
mod services;
mod commands;
use tauri::Manager;


pub fn run() {
    let builder = tauri::Builder::default()
        .manage(commands::GenerationGatewayState::new())
        .manage(commands::MediaTaskState::default())
        .manage(commands::OpenReelExportState::default())
        .manage(commands::HarnessRuntimeState::default())
        .manage(commands::HarnessBridgeState::default())
        .manage(commands::RecoveryState::new())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<commands::OpenReelExportState>().shutdown(Some(window.label()));
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    let app = builder
        .setup(|_app| {
            commands::initialize(_app.handle())
                .map_err(|error| {
                    let boxed: Box<dyn std::error::Error> = Box::new(std::io::Error::other(error));
                    tauri::Error::Setup(boxed.into())
                })?;
            #[cfg(target_os = "macos")]
            {
                // A settings validation error must remain reportable by the UI, not stop launch.
                let settings = commands::settings_get(_app.handle().clone()).unwrap_or_else(|error| {
                    eprintln!("Unable to read menu language: {error}");
                    serde_json::json!({})
                });
                native_ui::sync(_app.handle(), &settings).map_err(std::io::Error::other)?;
            }
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
            commands::recovery_status,
            commands::recovery_update_activity,
            commands::generation_request,
            commands::generation_stream,
            commands::generation_download,
            commands::generation_cancel,
            commands::media_task_cancel,
            commands::harness_runtime_status,
            commands::start_harness_runtime,
            commands::stop_harness_runtime,
            commands::restart_harness_runtime,
            commands::harness_bridge_status,
            commands::harness_bind_session,
            commands::harness_set_sessions_archived,
            commands::harness_transport,
            commands::harness_tool_respond,
            commands::capture_agent_e2e_screen,
            commands::platform,
            commands::clipboard_stage_workflow,
            commands::clipboard_read_staged_sentinel,
            commands::clipboard_load_staged_payload,
            commands::settings_get,
            commands::workspace_project_get,
            commands::workspace_project_set,
            commands::download_directory_get,
            commands::download_directory_set,
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
            commands::project_snapshot_list,
            commands::project_snapshot_create,
            commands::project_snapshot_read,
            commands::diagnostics_build,
            commands::editor_snapshot_get,
            commands::editor_snapshot_set,
            commands::editor_record_get,
            commands::editor_record_set,
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
            commands::file_crop_image,
            commands::file_probe_media,
            commands::file_has_audio,
            commands::file_separate_audio,
            commands::file_capture_video_frame,
            commands::file_concat_videos,
            commands::file_global_asset_root,
            commands::file_trash,
            commands::file_show_item_in_folder,
            commands::file_open_path,
            commands::file_export_resource_package,
            commands::file_import_resource_package,
            commands::file_write,
            commands::file_copy,
            commands::file_export_video_project,
            commands::openreel_export_start,
            commands::openreel_export_write,
            commands::openreel_export_finish,
            commands::openreel_export_cancel,
            commands::file_path_exists,
            commands::file_checksum,
            commands::file_resolve_unique_path,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Shotloom");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<commands::OpenReelExportState>().shutdown(None);
            commands::shutdown_harness_runtime(&app_handle.state::<commands::HarnessRuntimeState>());
            let _ = commands::mark_clean_exit(app_handle);
        }
    });
}
