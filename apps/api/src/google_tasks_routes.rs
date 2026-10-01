use axum::{extract::State, http::StatusCode, response::Json};
use serde::Deserialize;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppError, AppResult, ErrorResponse},
    extract::ApiJson,
    google_tasks_client::GoogleTaskList,
    google_tasks_store::GoogleTasksStatus,
    models::Synchronization,
};

#[derive(Deserialize, ToSchema)]
pub struct GoogleTasksSettingsRequest {
    pub enabled: bool,
    pub task_list_id: Option<String>,
    pub timezone: Option<String>,
    pub expected_version: i32,
}

#[derive(Deserialize, ToSchema)]
pub struct GoogleTasksCreateListRequest {
    pub expected_version: i32,
}

#[utoipa::path(get, path="/api/v1/integrations/google/tasks", responses((status=200,body=GoogleTasksStatus),(status=401,body=ErrorResponse)), security(("session_cookie"=[]),("development_user"=[])),tag="synchronization")]
pub async fn status(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<GoogleTasksStatus>> {
    Ok(Json(state.store.google_tasks_status(user).await?))
}

#[utoipa::path(get, path="/api/v1/integrations/google/tasks/lists", responses((status=200,body=Vec<GoogleTaskList>),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=502,body=ErrorResponse)), security(("session_cookie"=[]),("development_user"=[])),tag="synchronization")]
pub async fn lists(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Vec<GoogleTaskList>>> {
    let token = token(&state, user).await?;
    let service = state
        .sync_service
        .as_ref()
        .ok_or(AppError::NotConfigured("Google Tasks"))?;
    Ok(Json(
        service
            .tasks_client
            .lists(&token)
            .await
            .map_err(|error| AppError::Integration(error.into()))?,
    ))
}

#[utoipa::path(put,path="/api/v1/integrations/google/tasks",request_body=GoogleTasksSettingsRequest,responses((status=200,body=GoogleTasksStatus),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse)), security(("session_cookie"=[]),("development_user"=[])),tag="synchronization")]
pub async fn configure(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<GoogleTasksSettingsRequest>,
) -> AppResult<Json<GoogleTasksStatus>> {
    state
        .action_rate_limiter
        .check_key(&format!("tasks-settings:{user}"))?;
    if request.enabled {
        let token = token(&state, user).await?;
        let list = request
            .task_list_id
            .as_deref()
            .ok_or_else(|| AppError::Validation("Choose a Google Tasks list.".into()))?;
        let service = state
            .sync_service
            .as_ref()
            .ok_or(AppError::NotConfigured("Google Tasks"))?;
        let available = service
            .tasks_client
            .lists(&token)
            .await
            .map_err(|error| AppError::Integration(error.into()))?;
        if !available.iter().any(|candidate| candidate.id == list) {
            return Err(AppError::Forbidden(
                "The selected Google Tasks list is not available",
            ));
        }
    }
    let selected = request
        .task_list_id
        .as_deref()
        .zip(request.timezone.as_deref());
    let status = state
        .store
        .configure_google_tasks(user, request.enabled, selected, request.expected_version)
        .await?;
    if status.enabled {
        state
            .store
            .enqueue_sync(
                user,
                None,
                "tasks_sync",
                &format!("tasks-enable:{user}:{}", status.version),
            )
            .await?;
        state.sync_dispatcher.wake();
    }
    Ok(Json(status))
}

#[utoipa::path(post,path="/api/v1/integrations/google/tasks/lists",request_body=GoogleTasksCreateListRequest,responses((status=201,body=GoogleTaskList),(status=401,body=ErrorResponse),(status=403,body=ErrorResponse),(status=409,body=ErrorResponse),(status=502,body=ErrorResponse)),security(("session_cookie"=[]),("development_user"=[])),tag="synchronization")]
pub async fn create_list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<GoogleTasksCreateListRequest>,
) -> AppResult<(StatusCode, Json<GoogleTaskList>)> {
    state
        .action_rate_limiter
        .check_key(&format!("tasks-list:{user}"))?;
    let token = token(&state, user).await?;
    // Claim is durable before POST. If its result is lost, list discovery (not a
    // repeated POST) lets the user choose the already-created list explicitly.
    let claimed = sqlx::query("INSERT INTO google_task_connections(user_id,list_create_attempted) SELECT $1,TRUE WHERE $2=0 ON CONFLICT(user_id) DO UPDATE SET list_create_attempted=TRUE,version=google_task_connections.version+1 WHERE NOT google_task_connections.list_create_attempted AND google_task_connections.version=$2")
        .bind(user).bind(request.expected_version).execute(&state.store.pool).await?;
    if claimed.rows_affected() != 1 {
        return Err(AppError::Conflict("Refresh the lists and choose an existing list. An earlier creation may already have succeeded.".into()));
    }
    let service = state
        .sync_service
        .as_ref()
        .ok_or(AppError::NotConfigured("Google Tasks"))?;
    let created = service
        .tasks_client
        .create_list(&token)
        .await
        .map_err(|error| AppError::Integration(error.into()))?;
    Ok((StatusCode::CREATED, Json(created)))
}

#[utoipa::path(post,path="/api/v1/integrations/google/tasks/sync",responses((status=202,body=Synchronization),(status=401,body=ErrorResponse),(status=409,body=ErrorResponse)),security(("session_cookie"=[]),("development_user"=[])),tag="synchronization")]
pub async fn synchronize(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<(StatusCode, Json<Synchronization>)> {
    state
        .action_rate_limiter
        .check_key(&format!("tasks-sync:{user}"))?;
    let status = state.store.google_tasks_status(user).await?;
    if !status.enabled || !status.authorized {
        return Err(AppError::Conflict(
            "Enable Google Tasks and grant permission before synchronizing.".into(),
        ));
    }
    let job = state
        .store
        .enqueue_sync(
            user,
            None,
            "tasks_sync",
            &format!(
                "tasks-manual:{user}:{}",
                chrono::Utc::now().timestamp() / 60
            ),
        )
        .await?;
    state.sync_dispatcher.wake();
    Ok((StatusCode::ACCEPTED, Json(job)))
}

async fn token(state: &AppState, user: Uuid) -> AppResult<String> {
    if !state.store.google_tasks_status(user).await?.authorized {
        return Err(AppError::Forbidden("Google Tasks permission is required"));
    }
    state
        .sync_service
        .as_ref()
        .ok_or(AppError::NotConfigured("Google Tasks"))?
        .access_token(user)
        .await
        .map_err(AppError::Integration)
}
