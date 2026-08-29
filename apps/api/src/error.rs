use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Validation(String),
    #[error("{message}")]
    InvalidRequest { status: StatusCode, message: String },
    #[error("authentication is required")]
    Unauthorized,
    #[error("{0} was not found")]
    NotFound(&'static str),
    #[error("route was not found")]
    RouteNotFound,
    #[error("method is not allowed for this route")]
    MethodNotAllowed,
    #[error("{0}")]
    Conflict(String),
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorResponse {
    pub error: ErrorBody,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ErrorBody {
    pub code: &'static str,
    pub message: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::Validation(message) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_error",
                message,
            ),
            Self::InvalidRequest { status, message } => (status, "invalid_request", message),
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "authentication_required",
                "authentication is required".to_owned(),
            ),
            Self::NotFound(resource) => (
                StatusCode::NOT_FOUND,
                "not_found",
                format!("{resource} was not found"),
            ),
            Self::RouteNotFound => (
                StatusCode::NOT_FOUND,
                "route_not_found",
                "route was not found".to_owned(),
            ),
            Self::MethodNotAllowed => (
                StatusCode::METHOD_NOT_ALLOWED,
                "method_not_allowed",
                "method is not allowed for this route".to_owned(),
            ),
            Self::Conflict(message) => (StatusCode::CONFLICT, "conflict", message),
            Self::Database(error) => {
                tracing::error!(error = ?error, "database operation failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "An internal error occurred".to_owned(),
                )
            }
        };

        (
            status,
            Json(ErrorResponse {
                error: ErrorBody { code, message },
            }),
        )
            .into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
