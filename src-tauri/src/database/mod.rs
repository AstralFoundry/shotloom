//! Database lifecycle only. Domain queries live in CRUD modules.
use serde_json::json;
use crate::localized_error::{is_localized_error, localized_error};
use sea_orm::{ConnectionTrait, ConnectOptions, Database, DatabaseConnection, DbErr, Schema, TransactionTrait};
use std::{future::Future, path::Path, sync::{mpsc, OnceLock}, time::Duration};

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("database runtime"))
}

/// Sync IPC/file-operation boundary; ORM work always runs on its own async runtime.
/// Never nest block_on inside Tauri's runtime or block a database worker on itself.
pub fn run<T: Send + 'static>(work: impl Future<Output = Result<T, DbErr>> + Send + 'static) -> Result<T, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    runtime().spawn(async move { let _ = sender.send(work.await); });
    receiver.recv().map_err(|error| error.to_string())?.map_err(|error| match error {
        DbErr::Custom(message) if is_localized_error(&message) => message,
        other => other.to_string(),
    })
}

pub async fn open(path: &Path) -> Result<DatabaseConnection, DbErr> {
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| DbErr::Custom(e.to_string()))?; }
    // Pass filenames as filesystem paths, so '?' and '#' cannot become URI options.
    let filename = path.to_path_buf();
    let mut options = ConnectOptions::new("sqlite://shotloom.sqlite?mode=rwc");
    options.max_connections(1).min_connections(1).connect_timeout(Duration::from_secs(10)).sqlx_logging(false);
    options.map_sqlx_sqlite_opts(move |opts| opts.filename(&filename)
        .foreign_keys(true)
        .journal_mode(sea_orm::sqlx::sqlite::SqliteJournalMode::Wal)
        .synchronous(sea_orm::sqlx::sqlite::SqliteSynchronous::Full)
        .busy_timeout(Duration::from_secs(10)));
    let db = Database::connect(options).await?;
    static INITIALIZE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    let _guard = INITIALIZE.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    migrations::initialize(&db).await?;
    Ok(db)
}

mod migrations {
    use super::*;
    use crate::models::*;
    use sea_orm::{ActiveModelTrait, EntityName};
    use sea_orm::sea_query::{Alias, Index, Query, Table};

    /// Schema evolution is atomic; unsupported future versions are never rewritten.
    pub async fn initialize(db: &DatabaseConnection) -> Result<(), DbErr> {
        let tx = db.begin().await?;
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        macro_rules! table { ($entity:expr) => { {
            let mut statement = schema.create_table_from_entity($entity);
            statement.if_not_exists();
            tx.execute(backend.build(&statement)).await?;
        } }; }
        table!(catalog_metadata::Entity);
        // 版本 3 的库可能已经建过快照表但没有 media_refs 列：补列，已存在时忽略错误。
        // 这条 ALTER 必须早于版本短路，否则旧库永远补不上列。
        let _ = tx
            .execute(sea_orm::Statement::from_string(
                backend,
                "ALTER TABLE project_snapshots ADD COLUMN media_refs TEXT NOT NULL DEFAULT '[]'",
            ))
            .await;
        let version = crate::crud::catalog_crud::metadata(&tx, "database-version").await?;
        if version == Some(serde_json::json!(3)) {
            indexes(&tx).await?;
            tx.commit().await?;
            return Ok(());
        }
        if version.is_some() && version != Some(serde_json::json!(1)) && version != Some(serde_json::json!(2)) {
            return Err(DbErr::Custom(localized_error("native.storage.dc6f57487e", json!({}), "数据库版本不受支持".into())));
        }
        // The first development schema exposed only id/position/payload. Rebuild
        // its collections from those stable columns and derive indexed fields
        // through the same ORM model constructors used by current writes.
        let mut previous = std::collections::HashMap::new();
        if version == Some(serde_json::json!(1)) {
            for name in ["nodes", "edges", "tasks", "assets", "materials", "conversations", "skills", "recipes"] {
                let query = Query::select().columns([Alias::new("id"), Alias::new("position"), Alias::new("payload")]).from(Alias::new(name)).to_owned();
                previous.insert(name, tx.query_all(backend.build(&query)).await?);
            }
            // Drop child tables first, preserving foreign-key enforcement.
            for name in ["edges", "nodes", "tasks", "assets", "materials", "conversations", "skills", "recipes"] {
                tx.execute(backend.build(&Table::drop().table(Alias::new(name)).to_owned())).await?;
            }
        }
        table!(canvas_history::Entity); table!(production_plan::Entity); table!(agent_batch::Entity); table!(agent_evaluation::Entity);
        table!(project::Entity); table!(project_snapshot::Entity); table!(node::Entity); table!(edge::Entity); table!(task::Entity);
        table!(asset::Entity); table!(material::Entity); table!(conversation::Entity);
        table!(workspace_session::Entity);
        table!(editor_snapshot::Entity); table!(setting::Entity); table!(skill::Entity); table!(recipe::Entity);
        table!(editor_record::Entity);
        table!(recent_project::Entity); table!(recovery_record::Entity); table!(clipboard_record::Entity);
        macro_rules! restore { ($model:ident) => {
            if let Some(rows) = previous.remove($model::Entity.table_name()) {
                for row in rows {
                    $model::ActiveModel::record(row.try_get("", "id")?, row.try_get("", "position")?, row.try_get("", "payload")?).insert(&tx).await?;
                }
            }
        }; }
        restore!(node); restore!(edge); restore!(task); restore!(asset);
        restore!(material); restore!(conversation); restore!(skill); restore!(recipe);
        indexes(&tx).await?;
        crate::crud::catalog_crud::set_metadata(&tx, "database-version", serde_json::json!(3)).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn indexes(db: &impl ConnectionTrait) -> Result<(), DbErr> {
        let backend = db.get_database_backend();
        for (table, column) in [("nodes", "kind"), ("edges", "source"), ("edges", "target"),
            ("tasks", "node_id"), ("tasks", "status"), ("assets", "material_id"),
            ("materials", "file_path"), ("conversations", "agent_id"), ("skills", "enabled")] {
            let index = Index::create().name(format!("idx_{table}_{column}"))
                .table(Alias::new(table)).col(Alias::new(column)).if_not_exists().to_owned();
            db.execute(backend.build(&index)).await?;
        }
        Ok(())
    }
}

/// SQLite's consistent online snapshot, including committed WAL pages.
/// Bound path parameters keep database maintenance separate from domain queries.
pub fn backup(source: &Path, destination: &Path) -> Result<(), String> {
    let source = source.to_path_buf(); let destination = destination.to_path_buf();
    run(async move {
        let db = open(&source).await?;
        let result = db.execute(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Sqlite, "VACUUM INTO ?", [destination.to_string_lossy().into_owned().into()],
        )).await;
        db.close().await?;
        result.map(|_| ())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sea_orm::{EntityTrait, sea_query::{Alias, ColumnDef, Table}};

    #[test]
    fn v1_upgrade_preserves_records_and_rolls_back_invalid_relations() {
        run(async {
            for invalid in [false, true] {
                let db = Database::connect("sqlite::memory:").await?;
                db.execute(sea_orm::Statement::from_string(sea_orm::DatabaseBackend::Sqlite, "PRAGMA foreign_keys = ON")).await?;
                migrations::initialize(&db).await?;
                let backend = db.get_database_backend();
                for name in ["edges", "nodes", "tasks", "assets", "materials", "conversations", "skills", "recipes"] {
                    db.execute(backend.build(&Table::drop().table(Alias::new(name)).to_owned())).await?;
                    let table = Table::create().table(Alias::new(name))
                        .col(ColumnDef::new(Alias::new("id")).string().not_null().primary_key())
                        .col(ColumnDef::new(Alias::new("position")).integer().not_null())
                        .col(ColumnDef::new(Alias::new("payload")).json().not_null()).to_owned();
                    db.execute(backend.build(&table)).await?;
                }
                crate::crud::catalog_crud::set_metadata(&db, "database-version", serde_json::json!(1)).await?;
                for (table, id, payload) in [
                    ("nodes", "n", serde_json::json!({"id":"n","type":"text","title":"preserved"})),
                    ("edges", "e", serde_json::json!({"id":"e","source":"n","target":if invalid {"missing"} else {"n"}})),
                    ("skills", "s", serde_json::json!({"id":"s","name":"saved skill","enabled":false})),
                ] {
                    let insert = sea_orm::sea_query::Query::insert().into_table(Alias::new(table))
                        .columns([Alias::new("id"), Alias::new("position"), Alias::new("payload")])
                        .values_panic([id.into(), 0.into(), payload.into()]).to_owned();
                    db.execute(backend.build(&insert)).await?;
                }
                let result = migrations::initialize(&db).await;
                if invalid {
                    assert!(result.is_err());
                    assert_eq!(crate::crud::catalog_crud::metadata(&db, "database-version").await?, Some(serde_json::json!(1)));
                    let rows = db.query_all(backend.build(&sea_orm::sea_query::Query::select().column(Alias::new("payload")).from(Alias::new("edges")).to_owned())).await?;
                    assert_eq!(rows.len(), 1);
                } else {
                    result?;
                    assert_eq!(crate::models::node::Entity::find_by_id("n").one(&db).await?.unwrap().title, "preserved");
                    assert!(!crate::models::skill::Entity::find_by_id("s").one(&db).await?.unwrap().enabled);
                    assert_eq!(crate::crud::catalog_crud::metadata(&db, "database-version").await?, Some(serde_json::json!(3)));
                    migrations::initialize(&db).await?;
                    db.execute(backend.build(&Table::drop().table(Alias::new("editor_records")).to_owned())).await?;
                    crate::crud::catalog_crud::set_metadata(&db, "database-version", serde_json::json!(2)).await?;
                    migrations::initialize(&db).await?;
                    crate::crud::project_crud::set_editor_record(&db, "n", "refs", Some(serde_json::json!(["saved"]))).await?;
                    assert_eq!(crate::crud::project_crud::editor_record(&db, "n", "refs").await?, Some(serde_json::json!(["saved"])));
                    assert_eq!(crate::models::node::Entity::find_by_id("n").one(&db).await?.unwrap().title, "preserved");
                    crate::crud::catalog_crud::set_metadata(&db, "database-version", serde_json::json!(999)).await?;
                    assert!(migrations::initialize(&db).await.is_err());
                }
                db.close().await?;
            }
            Ok(())
        }).unwrap();
    }
}
