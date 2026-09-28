use axum::{Json, extract::State, http::StatusCode};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppResult, ErrorResponse},
    extract::{ApiJson, ApiPath},
    models::{DeleteTaskWithUndoRequest, TaskDeleteUndo, TaskDeleteUndoList},
};

#[utoipa::path(
    post, path = "/api/v1/tasks/{task_id}/delete-with-undo",
    params(("task_id" = Uuid, Path)), request_body = DeleteTaskWithUndoRequest,
    responses((status = 200, body = TaskDeleteUndo), (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse), (status = 422, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "tasks"
)]
pub async fn delete_task_with_undo(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<DeleteTaskWithUndoRequest>,
) -> AppResult<Json<TaskDeleteUndo>> {
    let receipt = state
        .store
        .delete_task_with_undo(user, id, request.expected_version)
        .await?;
    state.sync_dispatcher.wake();
    Ok(Json(receipt))
}

#[utoipa::path(
    get, path = "/api/v1/task-delete-undos",
    responses((status = 200, body = TaskDeleteUndoList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "tasks"
)]
pub async fn list_task_delete_undos(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<TaskDeleteUndoList>> {
    Ok(Json(state.store.list_task_delete_undos(user).await?))
}

#[utoipa::path(
    post, path = "/api/v1/task-delete-undos/{receipt_id}/consume",
    params(("receipt_id" = Uuid, Path)),
    responses((status = 204), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse),
        (status = 503, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "tasks"
)]
pub async fn undo_task_delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiPath(id): ApiPath<Uuid>,
) -> AppResult<StatusCode> {
    state
        .store
        .undo_task_delete(user, id, state.sync_service.as_ref())
        .await?;
    state.sync_dispatcher.wake();
    Ok(StatusCode::NO_CONTENT)
}
