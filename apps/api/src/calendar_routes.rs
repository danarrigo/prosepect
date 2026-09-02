use axum::{Json, extract::State, http::StatusCode};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppResult, ErrorResponse},
    extract::{ApiJson, ApiPath, ApiQuery},
    models::{
        Calendar, CalendarEvent, CalendarEventList, CalendarEventQuery, CalendarList,
        CalendarSource, CreateCalendarEventRequest, CreateCalendarRequest, ExpectedVersionQuery,
        UpdateCalendarEventRequest, UpdateCalendarRequest,
    },
};

#[utoipa::path(
    get,
    path = "/api/v1/calendars",
    responses((status = 200, body = CalendarList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "calendars"
)]
pub async fn list_calendars(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<CalendarList>> {
    Ok(Json(state.store.list_calendars(user_id).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/calendars",
    request_body = CreateCalendarRequest,
    responses(
        (status = 201, body = Calendar),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "calendars"
)]
pub async fn create_calendar(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<CreateCalendarRequest>,
) -> AppResult<(StatusCode, Json<Calendar>)> {
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_calendar(user_id, request).await?),
    ))
}

#[utoipa::path(
    put,
    path = "/api/v1/calendars/{calendar_id}",
    params(("calendar_id" = Uuid, Path)),
    request_body = UpdateCalendarRequest,
    responses(
        (status = 200, body = Calendar),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "calendars"
)]
pub async fn update_calendar(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(calendar_id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<UpdateCalendarRequest>,
) -> AppResult<Json<Calendar>> {
    let calendar = state
        .store
        .update_calendar(user_id, calendar_id, request)
        .await?;
    if calendar.source == CalendarSource::Google && calendar.selected {
        state
            .store
            .enqueue_expiring_calendar_watches(Some(user_id))
            .await?;
        state.sync_dispatcher.wake();
    }
    Ok(Json(calendar))
}

#[utoipa::path(
    delete,
    path = "/api/v1/calendars/{calendar_id}",
    params(("calendar_id" = Uuid, Path), ExpectedVersionQuery),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "calendars"
)]
pub async fn delete_calendar(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(calendar_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExpectedVersionQuery>,
) -> AppResult<StatusCode> {
    state
        .store
        .delete_calendar(user_id, calendar_id, query.expected_version)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/events",
    params(CalendarEventQuery),
    responses(
        (status = 200, body = CalendarEventList),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "events"
)]
pub async fn list_events(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiQuery(query): ApiQuery<CalendarEventQuery>,
) -> AppResult<Json<CalendarEventList>> {
    Ok(Json(
        state.store.list_calendar_events(user_id, query).await?,
    ))
}

#[utoipa::path(
    post,
    path = "/api/v1/events",
    request_body = CreateCalendarEventRequest,
    responses(
        (status = 201, body = CalendarEvent),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "events"
)]
pub async fn create_event(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<CreateCalendarEventRequest>,
) -> AppResult<(StatusCode, Json<CalendarEvent>)> {
    let event = state.store.create_calendar_event(user_id, request).await?;
    state.sync_dispatcher.wake();
    Ok((StatusCode::CREATED, Json(event)))
}

#[utoipa::path(
    put,
    path = "/api/v1/events/{event_id}",
    params(("event_id" = Uuid, Path)),
    request_body = UpdateCalendarEventRequest,
    responses(
        (status = 200, body = CalendarEvent),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "events"
)]
pub async fn update_event(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(event_id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<UpdateCalendarEventRequest>,
) -> AppResult<Json<CalendarEvent>> {
    let event = state
        .store
        .update_calendar_event(user_id, event_id, request)
        .await?;
    state.sync_dispatcher.wake();
    Ok(Json(event))
}

#[utoipa::path(
    delete,
    path = "/api/v1/events/{event_id}",
    params(("event_id" = Uuid, Path), ExpectedVersionQuery),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "events"
)]
pub async fn delete_event(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(event_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExpectedVersionQuery>,
) -> AppResult<StatusCode> {
    state
        .store
        .delete_calendar_event(user_id, event_id, query.expected_version)
        .await?;
    state.sync_dispatcher.wake();
    Ok(StatusCode::NO_CONTENT)
}
