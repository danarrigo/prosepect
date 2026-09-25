use axum::{Json, extract::State, http::StatusCode};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppResult, ErrorResponse},
    extract::{ApiJson, ApiPath},
    models::{CalendarMoveUndo, CalendarMoveUndoList, MoveCalendarItemRequest},
};

#[utoipa::path(
    get, path = "/api/v1/calendar-move-undos",
    responses((status = 200, body = CalendarMoveUndoList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "calendars"
)]
pub async fn list_calendar_move_undos(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<CalendarMoveUndoList>> {
    Ok(Json(state.store.list_calendar_move_undos(user).await?))
}

#[utoipa::path(
    post, path = "/api/v1/events/{event_id}/move",
    params(("event_id" = Uuid, Path)), request_body = MoveCalendarItemRequest,
    responses((status = 200, body = CalendarMoveUndo), (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse), (status = 422, body = ErrorResponse), (status = 429, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "calendars"
)]
pub async fn move_event(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<MoveCalendarItemRequest>,
) -> AppResult<Json<CalendarMoveUndo>> {
    let receipt = state
        .store
        .move_calendar_item(user, id, false, request)
        .await?;
    state.sync_dispatcher.wake();
    Ok(Json(receipt))
}

#[utoipa::path(
    post, path = "/api/v1/tasks/{task_id}/move",
    params(("task_id" = Uuid, Path)), request_body = MoveCalendarItemRequest,
    responses((status = 200, body = CalendarMoveUndo), (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse), (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse), (status = 422, body = ErrorResponse), (status = 429, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "calendars"
)]
pub async fn move_task(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<MoveCalendarItemRequest>,
) -> AppResult<Json<CalendarMoveUndo>> {
    let receipt = state
        .store
        .move_calendar_item(user, id, true, request)
        .await?;
    state.sync_dispatcher.wake();
    Ok(Json(receipt))
}

#[utoipa::path(
    post, path = "/api/v1/calendar-move-undos/{receipt_id}/consume",
    params(("receipt_id" = Uuid, Path)),
    responses((status = 204), (status = 401, body = ErrorResponse), (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse), (status = 409, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])), tag = "calendars"
)]
pub async fn undo_calendar_move(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiPath(id): ApiPath<Uuid>,
) -> AppResult<StatusCode> {
    state.store.undo_calendar_move(user, id).await?;
    state.sync_dispatcher.wake();
    Ok(StatusCode::NO_CONTENT)
}
