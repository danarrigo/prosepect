use axum::{Json, extract::State, http::StatusCode};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppResult, ErrorResponse},
    extract::{ApiJson, ApiPath, ApiQuery},
    models::{
        CreateNoteRequest, ExpectedVersionQuery, Note, NoteList, SearchQuery, SearchResultList,
        UpdateNoteRequest,
    },
};

#[utoipa::path(
    get,
    path = "/api/v1/notes",
    responses((status = 200, body = NoteList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "notes"
)]
pub async fn list_notes(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
) -> AppResult<Json<NoteList>> {
    Ok(Json(state.store.list_notes(user_id).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/notes",
    request_body = CreateNoteRequest,
    responses(
        (status = 201, body = Note),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "notes"
)]
pub async fn create_note(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<CreateNoteRequest>,
) -> AppResult<(StatusCode, Json<Note>)> {
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_note(user_id, request).await?),
    ))
}

#[utoipa::path(
    put,
    path = "/api/v1/notes/{note_id}",
    params(("note_id" = Uuid, Path)),
    request_body = UpdateNoteRequest,
    responses(
        (status = 200, body = Note),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "notes"
)]
pub async fn update_note(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(note_id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<UpdateNoteRequest>,
) -> AppResult<Json<Note>> {
    Ok(Json(
        state.store.update_note(user_id, note_id, request).await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/api/v1/notes/{note_id}",
    params(("note_id" = Uuid, Path), ExpectedVersionQuery),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "notes"
)]
pub async fn delete_note(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(note_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExpectedVersionQuery>,
) -> AppResult<StatusCode> {
    state
        .store
        .delete_note(user_id, note_id, query.expected_version)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/api/v1/search",
    params(SearchQuery),
    responses(
        (status = 200, body = SearchResultList),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "search"
)]
pub async fn global_search(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiQuery(query): ApiQuery<SearchQuery>,
) -> AppResult<Json<SearchResultList>> {
    Ok(Json(
        state
            .store
            .global_search(user_id, &query.q, query.limit.unwrap_or(20))
            .await?,
    ))
}
