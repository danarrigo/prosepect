use axum::{
    extract::{Path, State},
    response::Json,
};
use chrono::Utc;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppResult, ErrorResponse},
    extract::ApiJson,
    models::{
        ActivityList, CreateSynchronizationRequest, GoogleIntegrationStatus,
        ResolveSyncConflictRequest, SyncConflict, SyncConflictList, Synchronization,
    },
};

#[utoipa::path(
    get,
    path = "/api/v1/integrations/google",
    responses((status = 200, body = GoogleIntegrationStatus), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn google_status(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<GoogleIntegrationStatus>> {
    Ok(Json(state.store.google_integration_status(user_id).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/integrations/google/calendars/discover",
    responses((status = 202, body = Synchronization), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn discover_google_calendars(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<(axum::http::StatusCode, Json<Synchronization>)> {
    state
        .login_rate_limiter
        .check_key(&format!("synchronization:{user_id}"))?;
    let minute = Utc::now().timestamp() / 60;
    let job = state
        .store
        .enqueue_sync(
            user_id,
            None,
            "calendar_discovery",
            &format!("calendar-discovery:{user_id}:{minute}"),
        )
        .await?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(job)))
}

#[utoipa::path(
    delete,
    path = "/api/v1/integrations/google",
    responses((status = 202, body = Synchronization), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn revoke_google(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<(axum::http::StatusCode, Json<Synchronization>)> {
    let job = state
        .store
        .enqueue_sync(
            user_id,
            None,
            "credential_revoke",
            &format!("credential-revoke:{user_id}:{}", Utc::now().timestamp()),
        )
        .await?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(job)))
}

#[utoipa::path(
    post,
    path = "/api/v1/synchronizations",
    request_body = CreateSynchronizationRequest,
    responses((status = 202, body = Synchronization), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn create_synchronization(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<CreateSynchronizationRequest>,
) -> AppResult<(axum::http::StatusCode, Json<Synchronization>)> {
    state
        .login_rate_limiter
        .check_key(&format!("synchronization:{user_id}"))?;
    let job = state
        .store
        .enqueue_sync(
            user_id,
            request.calendar_id,
            "calendar_sync",
            &request.idempotency_key,
        )
        .await?;
    Ok((axum::http::StatusCode::ACCEPTED, Json(job)))
}

#[utoipa::path(
    get,
    path = "/api/v1/synchronizations/{synchronization_id}",
    params(("synchronization_id" = Uuid, Path, description = "Synchronization identifier")),
    responses((status = 200, body = Synchronization), (status = 401, body = ErrorResponse), (status = 404, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn get_synchronization(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(synchronization_id): Path<Uuid>,
) -> AppResult<Json<Synchronization>> {
    Ok(Json(
        state
            .store
            .synchronization(user_id, synchronization_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/sync-conflicts",
    responses((status = 200, body = SyncConflictList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn list_conflicts(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<SyncConflictList>> {
    Ok(Json(state.store.list_sync_conflicts(user_id).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/sync-conflicts/{conflict_id}/resolve",
    params(("conflict_id" = Uuid, Path, description = "Conflict identifier")),
    request_body = ResolveSyncConflictRequest,
    responses((status = 200, body = SyncConflict), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn resolve_conflict(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(conflict_id): Path<Uuid>,
    ApiJson(request): ApiJson<ResolveSyncConflictRequest>,
) -> AppResult<Json<SyncConflict>> {
    Ok(Json(
        state
            .store
            .resolve_sync_conflict(user_id, conflict_id, &request.resolution)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/api/v1/activity",
    responses((status = 200, body = ActivityList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "synchronization"
)]
pub async fn activity(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<ActivityList>> {
    Ok(Json(state.store.activity_for_user(user_id).await?))
}
