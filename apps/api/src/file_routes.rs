use axum::{
    body::Body,
    extract::{Multipart, Path, Query, State},
    http::{HeaderValue, Response, StatusCode, header},
    response::Json,
};
use bytes::Bytes;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppError, AppResult, ErrorResponse},
    models::{FileList, FileListQuery, FileRecord},
};

#[utoipa::path(
    get,
    path = "/api/v1/files",
    params(FileListQuery),
    responses((status = 200, body = FileList), (status = 401, body = ErrorResponse)),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "files"
)]
pub async fn list_files(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Query(query): Query<FileListQuery>,
) -> AppResult<Json<FileList>> {
    Ok(Json(state.store.list_files(user_id, query).await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/files",
    request_body(content = String, content_type = "multipart/form-data"),
    responses(
        (status = 201, body = FileRecord),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 413, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "files"
)]
pub async fn upload_file(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    mut multipart: Multipart,
) -> AppResult<(StatusCode, Json<FileRecord>)> {
    state
        .login_rate_limiter
        .check_key(&format!("upload:{user_id}"))?;
    let mut upload: Option<Upload> = None;
    let mut project_id = None;
    let mut task_id = None;
    let mut note_id = None;
    let mut event_id = None;

    while let Some(field) = multipart.next_field().await.map_err(invalid_multipart)? {
        let name = field.name().unwrap_or_default().to_owned();
        if name == "file" {
            let filename = field
                .file_name()
                .map(clean_filename)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| AppError::Validation("file must have a filename".to_owned()))?;
            let content_type = field
                .content_type()
                .map(str::to_owned)
                .unwrap_or_else(|| "application/octet-stream".to_owned());
            content_type
                .parse::<mime::Mime>()
                .map_err(|_| AppError::Validation("file content type is invalid".to_owned()))?;
            let bytes = field.bytes().await.map_err(invalid_multipart)?;
            if bytes.len() > state.max_file_size_bytes {
                return Err(AppError::InvalidRequest {
                    status: StatusCode::PAYLOAD_TOO_LARGE,
                    message: format!("file must not exceed {} bytes", state.max_file_size_bytes),
                });
            }
            upload = Some(Upload {
                filename,
                content_type,
                bytes,
            });
        } else {
            let value = field.text().await.map_err(invalid_multipart)?;
            let id = parse_optional_id(&value)?;
            match name.as_str() {
                "project_id" => project_id = id,
                "task_id" => task_id = id,
                "note_id" => note_id = id,
                "event_id" => event_id = id,
                _ => {}
            }
        }
    }

    let upload = upload.ok_or_else(|| AppError::Validation("file is required".to_owned()))?;
    let file_id = Uuid::now_v7();
    let object_key = format!("{user_id}-{file_id}");
    state
        .file_storage
        .put(&object_key, upload.bytes.clone())
        .await
        .map_err(storage_error)?;
    let metadata = state
        .store
        .create_file_metadata(
            user_id,
            project_id,
            task_id,
            note_id,
            event_id,
            &object_key,
            &upload.filename,
            &upload.content_type,
            upload.bytes.len() as i64,
        )
        .await;
    match metadata {
        Ok(metadata) => Ok((StatusCode::CREATED, Json(metadata))),
        Err(error) => {
            if let Err(cleanup_error) = state.file_storage.delete(&object_key).await {
                tracing::error!(error = ?cleanup_error, object_key, "failed to clean up rejected upload");
            }
            Err(error)
        }
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/files/{file_id}/download",
    params(("file_id" = Uuid, Path, description = "File identifier")),
    responses(
        (status = 200, content_type = "application/octet-stream", body = String),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "files"
)]
pub async fn download_file(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(file_id): Path<Uuid>,
) -> AppResult<Response<Body>> {
    let (file, object_key) = state.store.file_download(user_id, file_id).await?;
    if let Some(url) = state
        .file_storage
        .signed_download_url(&object_key)
        .await
        .map_err(storage_error)?
    {
        return Response::builder()
            .status(StatusCode::TEMPORARY_REDIRECT)
            .header(header::LOCATION, url)
            .body(Body::empty())
            .map_err(response_error);
    }
    let bytes = state
        .file_storage
        .get(&object_key)
        .await
        .map_err(storage_error)?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, file.content_type)
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!(
                "attachment; filename=\"{}\"",
                file.filename.replace(['"', '\r', '\n'], "_")
            ))
            .map_err(response_error)?,
        )
        .body(Body::from(bytes))
        .map_err(response_error)
}

#[utoipa::path(
    delete,
    path = "/api/v1/files/{file_id}",
    params(("file_id" = Uuid, Path, description = "File identifier")),
    responses(
        (status = 204, description = "File deleted"),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse)
    ),
    security(("session_cookie" = []), ("development_user" = [])),
    tag = "files"
)]
pub async fn delete_file(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    Path(file_id): Path<Uuid>,
) -> AppResult<StatusCode> {
    let (_, object_key) = state.store.file_download(user_id, file_id).await?;
    state
        .file_storage
        .delete(&object_key)
        .await
        .map_err(storage_error)?;
    state.store.delete_file_metadata(user_id, file_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

struct Upload {
    filename: String,
    content_type: String,
    bytes: Bytes,
}

fn parse_optional_id(value: &str) -> AppResult<Option<Uuid>> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    value
        .parse()
        .map(Some)
        .map_err(|_| AppError::Validation("file link identifier must be a UUID".to_owned()))
}

fn clean_filename(value: &str) -> String {
    value
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .replace(['\0', '\r', '\n'], "_")
        .chars()
        .take(255)
        .collect()
}

fn invalid_multipart(error: impl std::fmt::Debug) -> AppError {
    tracing::warn!(error = ?error, "invalid multipart upload");
    AppError::Validation("invalid multipart file upload".to_owned())
}

fn storage_error(error: impl std::fmt::Debug) -> AppError {
    tracing::error!(error = ?error, "file storage operation failed");
    AppError::InvalidRequest {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: "file storage operation failed".to_owned(),
    }
}

fn response_error(error: impl std::fmt::Debug) -> AppError {
    tracing::error!(error = ?error, "failed to create file response");
    AppError::InvalidRequest {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        message: "could not create file response".to_owned(),
    }
}
