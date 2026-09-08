use std::time::Duration;

use axum::{
    Json,
    extract::{FromRequestParts, State},
    http::request::Parts,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use utoipa::ToSchema;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppError, AppResult, ErrorResponse},
    store::Store,
};

/// Only this extractor may authorize service-wide operational queries.
pub struct OperationsAdmin;

impl FromRequestParts<AppState> for OperationsAdmin {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> AppResult<Self> {
        let CurrentUser(user_id) = CurrentUser::from_request_parts(parts, state).await?;
        if !state.admin_user_ids.contains(&user_id) {
            return Err(AppError::Forbidden(
                "operations access is restricted to the owner",
            ));
        }
        Ok(Self)
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProbeStatus {
    Ok,
    Unavailable,
}

#[derive(Serialize, ToSchema)]
pub struct OperationsLimits {
    pub max_user_accounts: Option<i64>,
    pub max_total_file_storage_bytes: i64,
    pub max_user_file_storage_bytes: i64,
    pub max_file_size_bytes: usize,
}

#[derive(Serialize, ToSchema, sqlx::FromRow)]
pub struct OperationsMetrics {
    pub accounts: i64,
    /// Database-recorded attachment bytes, not a live object-storage measurement.
    pub file_bytes: i64,
    pub pending: i64,
    pub running: i64,
    pub retryable: i64,
    /// All retained final-failed rows, including failures followed by a later success.
    pub final_failed_all_time: i64,
    pub succeeded_all_time: i64,
    pub oldest_waiting_created_at: Option<DateTime<Utc>>,
    /// updated_at is set by complete_sync_job, not by the HTTP worker trigger.
    pub latest_completed_job_at: Option<DateTime<Utc>>,
}

#[derive(Serialize, ToSchema)]
pub struct OperationsSnapshot {
    pub as_of: DateTime<Utc>,
    pub api: ProbeStatus,
    pub database: ProbeStatus,
    pub metrics: Option<OperationsMetrics>,
    pub limits: OperationsLimits,
}

type PrivateJson<T> = ([(&'static str, &'static str); 1], Json<T>);

#[utoipa::path(
    get, path = "/api/v1/operations/capability",
    responses((status = 200, body = bool), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = [])), tag = "system"
)]
pub async fn capability(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> PrivateJson<bool> {
    (
        [("cache-control", "no-store")],
        Json(state.admin_user_ids.contains(&user_id)),
    )
}

#[utoipa::path(
    get, path = "/api/v1/operations",
    responses((status = 200, body = OperationsSnapshot), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse)),
    security(("session_cookie" = [])), tag = "system"
)]
pub async fn snapshot(
    State(state): State<AppState>,
    _admin: OperationsAdmin,
) -> PrivateJson<OperationsSnapshot> {
    // Authentication itself needs the DB. Never bypass it to serve a degraded snapshot.
    let database = match tokio::time::timeout(Duration::from_secs(5), state.store.ready()).await {
        Ok(Ok(())) => ProbeStatus::Ok,
        _ => ProbeStatus::Unavailable,
    };
    let metrics = if matches!(database, ProbeStatus::Ok) {
        // An aggregate failure is unknown, never a misleading zero. No raw errors leave this route.
        tokio::time::timeout(Duration::from_secs(5), state.store.operations_metrics())
            .await
            .ok()
            .and_then(Result::ok)
    } else {
        None
    };
    (
        [("cache-control", "no-store")],
        Json(OperationsSnapshot {
            as_of: Utc::now(),
            api: ProbeStatus::Ok,
            database,
            metrics,
            limits: OperationsLimits {
                max_user_accounts: state.max_user_accounts,
                max_total_file_storage_bytes: state.max_total_file_storage_bytes,
                max_user_file_storage_bytes: state.max_user_file_storage_bytes,
                max_file_size_bytes: state.max_file_size_bytes,
            },
        }),
    )
}

impl Store {
    // Private to this module: callers must pass OperationsAdmin before reaching this query.
    async fn operations_metrics(&self) -> AppResult<OperationsMetrics> {
        // One statement gives all counters the same PostgreSQL snapshot.
        Ok(sqlx::query_as::<_, OperationsMetrics>(r#"
            SELECT
                (SELECT COUNT(*) FROM users) AS accounts,
                (SELECT COALESCE(SUM(byte_size), 0)::BIGINT FROM files) AS file_bytes,
                COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE status = 'running') AS running,
                COUNT(*) FILTER (WHERE status = 'failed' AND attempt_count < 8) AS retryable,
                COUNT(*) FILTER (WHERE status = 'failed' AND attempt_count >= 8) AS final_failed_all_time,
                COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded_all_time,
                MIN(created_at) FILTER (WHERE status = 'pending' OR (status = 'failed' AND attempt_count < 8)) AS oldest_waiting_created_at,
                MAX(updated_at) FILTER (WHERE status = 'succeeded') AS latest_completed_job_at
            FROM sync_jobs
        "#).fetch_one(&self.pool).await?)
    }
}
