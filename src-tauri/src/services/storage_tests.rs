#[cfg(test)]
mod tests {
    use crate::services::storage_service::*;
    use serde_json::json;
    fn root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("shotloom-sqlite-{}",uuid::Uuid::new_v4()))
    }
    #[test]
    fn database_boundary_preserves_explicit_envelopes_and_unrecognized_error_details() {
        use sea_orm::DbErr;
        let envelope = crate::localized_error::localized_error("test.key", json!({"id": "actual"}), "fallback".into());
        let expected = envelope.clone();
        let error = crate::database::run(async move { Err::<(), _>(DbErr::Custom(envelope)) }).unwrap_err();
        assert_eq!(error, expected);
        for detail in ["raw database detail", r#"{"type":"shotloom:localized-error","key":"test.key"}"#] {
            let expected = DbErr::Custom(detail.to_owned()).to_string();
            let detail = detail.to_owned();
            let error = crate::database::run(async move { Err::<(), _>(DbErr::Custom(detail)) }).unwrap_err();
            assert_eq!(error, expected);
        }
    }

    #[test]
    fn invalid_catalog_record_is_localizable_and_rolls_back_the_catalog() {
        let root = root();
        let path = root.join(APP_DATABASE);
        let original = json!({"storageVersion": 1, "skills": [{"id": "kept", "name": "User skill"}]});
        save_catalog(&path, "skills", &original).unwrap();
        let error = save_catalog(&path, "skills", &json!({"skills": [{"name": "missing id"}]})).unwrap_err();
        let envelope: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(envelope["type"], "shotloom:localized-error");
        assert_eq!(envelope["params"]["collection"], "skills");
        assert_eq!(catalog(&path, "skills", json!({})).unwrap(), original);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn database_paths_keep_unicode_and_uri_punctuation_literal() {
        let root = root().join(if cfg!(windows) { "工程 # percent%" } else { "工程 # percent% question?" });
        let path = root.join(PROJECT_DATABASE);
        save_project(&path, &json!({"id":"unicode","nodes":[{"id":"n"}]})).unwrap();
        assert!(path.is_file());
        assert_eq!(load_project(&path).unwrap()["id"], "unicode");
        std::fs::remove_dir_all(root.parent().unwrap()).unwrap();
    }
    #[test]
    fn project_rows_restart_conflicts_and_failed_transaction() {
        let root=root();let path=root.join(PROJECT_DATABASE);
        let project=json!({"schema":"shotloom-project","schemaVersion":2,"id":"p","name":"test","nodes":[{"id":"n1","type":"text","content":"first"}],"edges":[],"tasks":[],"harnessSessions":[]});
        let saved=save_project(&path,&project).unwrap();
        assert_eq!(saved["storageRevision"],1);
        let loaded=load_project(&path).unwrap();assert_eq!(loaded["nodes"],project["nodes"]);
        let mut changed=loaded.clone();changed["nodes"][0]["content"]=json!("second");
        save_project(&path,&changed).unwrap();
        let conflict = save_project(&path,&loaded).expect_err("stale revision must not overwrite newer data");
        let envelope: serde_json::Value = serde_json::from_str(&conflict).unwrap();
        assert_eq!(envelope["type"], "shotloom:localized-error");
        assert_eq!(envelope["fallback"], "工程已被另一窗口修改，请重新打开后再保存");
        let mut broken=load_project(&path).unwrap();broken["nodes"]=json!([{"id":"n2"},{"id":"n2"}]);
        let duplicate = save_project(&path,&broken).unwrap_err();
        let envelope: serde_json::Value = serde_json::from_str(&duplicate).unwrap();
        assert_eq!(envelope["params"]["collection"], "nodes");
        assert_eq!(envelope["params"]["id"], "n2");
        assert_eq!(load_project(&path).unwrap()["nodes"][0]["content"],"second");
        assert_eq!(&std::fs::read(&path).unwrap()[..16],b"SQLite format 3\0");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn graph_foreign_keys_rollback_the_entire_save_and_history_survives_reopen() {
        let root = root();
        let path = root.join(PROJECT_DATABASE);
        let original = json!({"id":"graph","name":"before","nodes":[{"id":"a"},{"id":"b"}],
            "edges":[{"id":"link","source":"a","target":"b"}],
            "canvasHistory":[{"nodes":[{"id":"old"}]}],"canvasRedoStack":[]});
        save_project(&path, &original).unwrap();
        let loaded = load_project(&path).unwrap();
        assert_eq!(loaded["canvasHistory"], original["canvasHistory"]);
        let mut broken = loaded.clone();
        broken["name"] = json!("must roll back");
        broken["nodes"][0]["content"] = json!("must roll back");
        broken["edges"][0]["target"] = json!("missing-node");
        assert!(save_project(&path, &broken).is_err());
        assert_eq!(load_project(&path).unwrap(), loaded);
        let mut removed = loaded;
        removed["nodes"] = json!([{"id":"a"}]);
        removed["edges"] = json!([]);
        save_project(&path, &removed).unwrap();
        let reopened = load_project(&path).unwrap();
        assert_eq!(reopened["nodes"], removed["nodes"]);
        assert_eq!(reopened["edges"], json!([]));
        assert_eq!(reopened["canvasHistory"], original["canvasHistory"]);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn online_backup_includes_committed_rows_and_rejects_overwrite() {
        let root = root();
        let source = root.join(PROJECT_DATABASE);
        let copy = root.join("copy.sqlite");
        let held_path = source.clone();
        let connection = crate::database::run(async move { crate::database::open(&held_path).await }).unwrap();
        let saved = save_project(&source, &json!({"id":"backup","nodes":[{"id":"n","content":"durable"}]})).unwrap();
        save_snapshot(&source, "clip", &json!({"tracks":[{"id":"track"}]})).unwrap();
        assert!(std::fs::metadata(source.with_extension("sqlite-wal")).unwrap().len() > 0);
        crate::database::backup(&source, &copy).unwrap();
        assert_eq!(load_project(&copy).unwrap()["nodes"], saved["nodes"]);
        assert_eq!(load_snapshot(&copy, "clip").unwrap()["tracks"][0]["id"], "track");
        assert!(crate::database::backup(&source, &copy).is_err());
        assert_eq!(load_project(&copy).unwrap()["nodes"], saved["nodes"]);
        crate::database::run(async move { connection.close().await }).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn catalogs_snapshots_settings_and_recent_survive_reopen() {
        let root=root();let app=root.join(APP_DATABASE);let project=root.join(PROJECT_DATABASE);
        save_settings(&app,&json!({"storageVersion":7,"agentCanRunNodes":false})).unwrap();
        assert_eq!(settings(&app,&json!({})).unwrap()["agentCanRunNodes"],false);
        let skills=json!({"storageVersion":1,"skills":[{"id":"one","instructions":"test"}]});
        save_catalog(&app,"skills",&skills).unwrap();assert_eq!(catalog(&app,"skills",json!({})).unwrap(),skills);
        save_snapshot(&project,"clip-1",&json!({"timeline":{"tracks":[]}})).unwrap();
        assert_eq!(load_snapshot(&project,"clip-1").unwrap()["timeline"],json!({"tracks":[]}));
        set_editor_record(&project,"clip-1".into(),"agent-project-refs".into(),Some(json!([{"id":"saved"}]))).unwrap();
        set_editor_record(&project,"clip-2".into(),"agent-project-refs".into(),Some(json!([]))).unwrap();
        assert_eq!(editor_record(&project,"clip-1".into(),"agent-project-refs".into()).unwrap()[0]["id"],"saved");
        set_editor_record(&project,"clip-1".into(),"agent-project-refs".into(),None).unwrap();
        assert_eq!(editor_record(&project,"clip-1".into(),"agent-project-refs".into()).unwrap(),json!(null));
        assert_eq!(editor_record(&project,"clip-2".into(),"agent-project-refs".into()).unwrap(),json!([]));
        add_recent(&app,json!({"filePath":"/p/project.sqlite","name":"p"})).unwrap();
        add_recent(&app,json!({"filePath":"/p/project.sqlite","name":"renamed"})).unwrap();
        assert_eq!(recent(&app).unwrap().as_array().unwrap().len(),1);
        assert_eq!(recent(&app).unwrap()[0]["name"],"renamed");
        bind_window_project(&app,"main",Some("/workspace/工程".into())).unwrap();
        assert_eq!(window_project(&app,"main").unwrap().as_deref(),Some("/workspace/工程"));
        bind_window_project(&app,"main",None).unwrap();
        assert_eq!(window_project(&app,"main").unwrap(),None);
        set_download_directory(&app,"/downloads".into()).unwrap();
        save_settings(&app,&json!({"storageVersion":7,"downloadDirectory":"stale"})).unwrap();
        assert_eq!(download_directory(&app).unwrap(),json!("/downloads"));
        save_recovery(&app,"runtime",&json!({"cleanExit":false})).unwrap();
        assert_eq!(recovery(&app,"runtime").unwrap()["cleanExit"],false);
        save_clipboard(&app,"copy",&json!({"nodes":[{"id":"copied"}]})).unwrap();
        assert_eq!(clipboard(&app,"copy").unwrap()["nodes"][0]["id"],"copied");
        std::fs::remove_dir_all(root).unwrap();
    }
}
