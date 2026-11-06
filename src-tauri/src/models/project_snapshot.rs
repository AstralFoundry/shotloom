use sea_orm::entity::prelude::*;

/// 画布快照：只存作品结构与媒体引用，不复制媒体文件。
///
/// `degraded` 表示这份快照超过单份体积上限，只留下元数据而没有 `payload`；
/// 列表照常展示，但不可恢复，避免为了「有记录」把整个数据库写爆。
#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "project_snapshots")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub created_at: String,
    pub reason: String,
    pub content_hash: String,
    pub payload_bytes: i64,
    /// 该版本引用的素材 id 列表（JSON 字符串数组）。删除素材前只看这一列。
    pub media_refs: Json,
    pub degraded: bool,
    pub payload: Option<Json>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl ActiveModel {
    pub fn record(
        id: String,
        created_at: String,
        reason: String,
        content_hash: String,
        payload_bytes: i64,
        media_refs: Json,
        degraded: bool,
        payload: Option<Json>,
    ) -> Self {
        Self {
            id: sea_orm::Set(id),
            created_at: sea_orm::Set(created_at),
            reason: sea_orm::Set(reason),
            content_hash: sea_orm::Set(content_hash),
            payload_bytes: sea_orm::Set(payload_bytes),
            media_refs: sea_orm::Set(media_refs),
            degraded: sea_orm::Set(degraded),
            payload: sea_orm::Set(payload),
        }
    }
}
