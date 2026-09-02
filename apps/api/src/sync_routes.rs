use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use chrono::Utc;
use sha2::{Digest, Sha256};
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
    rate_limit::ClientAddress,
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
    state.sync_dispatcher.wake();
    Ok((StatusCode::ACCEPTED, Json(job)))
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
    state.sync_dispatcher.wake();
    Ok((StatusCode::ACCEPTED, Json(job)))
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
    state.sync_dispatcher.wake();
    Ok((StatusCode::ACCEPTED, Json(job)))
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
    let conflict = state
        .store
        .resolve_sync_conflict(user_id, conflict_id, &request.resolution)
        .await?;
    state.sync_dispatcher.wake();
    Ok(Json(conflict))
}

pub async fn google_calendar_webhook(
    State(state): State<AppState>,
    ClientAddress(peer): ClientAddress,
    headers: HeaderMap,
) -> AppResult<StatusCode> {
    state
        .action_rate_limiter
        .check(&headers, peer, state.trust_proxy_headers)?;
    let channel_id = required_header(&headers, "x-goog-channel-id")?
        .parse::<Uuid>()
        .map_err(|_| crate::error::AppError::Forbidden("invalid Google notification"))?;
    let resource_id = required_header(&headers, "x-goog-resource-id")?;
    let channel_token = required_header(&headers, "x-goog-channel-token")?;
    let message_number = required_header(&headers, "x-goog-message-number")?;
    if channel_token.len() != 64
        || resource_id.len() > 2_048
        || message_number.len() > 32
        || !message_number
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err(crate::error::AppError::Forbidden(
            "invalid Google notification",
        ));
    }
    let token_hash = Sha256::digest(channel_token.as_bytes()).to_vec();
    let accepted = state
        .store
        .enqueue_google_watch_notification(channel_id, resource_id, &token_hash, message_number)
        .await?;
    if !accepted {
        return Err(crate::error::AppError::Forbidden(
            "invalid Google notification",
        ));
    }
    state.sync_dispatcher.wake();
    Ok(StatusCode::NO_CONTENT)
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> AppResult<&'a str> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .ok_or(crate::error::AppError::Forbidden(
            "invalid Google notification",
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
