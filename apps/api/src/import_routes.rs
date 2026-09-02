use axum::{extract::State, http::StatusCode, response::Json};

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppResult, ErrorResponse},
    extract::ApiJson,
    models::{TodoistImportRequest, TodoistImportResult},
};

#[utoipa::path(
    post,
    path = "/api/v1/imports/todoist",
    request_body = TodoistImportRequest,
    responses(
        (status = 201, body = TodoistImportResult),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "imports"
)]
pub async fn import_todoist(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<TodoistImportRequest>,
) -> AppResult<(StatusCode, Json<TodoistImportResult>)> {
    state
        .action_rate_limiter
        .check_key(&format!("todoist-import:{user_id}"))?;
    let result = state.store.import_todoist_project(user_id, request).await?;
    state.sync_dispatcher.wake();
    Ok((StatusCode::CREATED, Json(result)))
}
