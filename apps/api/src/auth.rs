use axum::{
    extract::FromRequestParts,
    http::{HeaderMap, Method, request::Parts},
};
use uuid::Uuid;

use crate::{app::AppState, error::AppError};

pub const DEVELOPMENT_USER_HEADER: &str = "x-prosepect-user-id";
pub const SESSION_COOKIE: &str = "prosepect_session";
pub const CSRF_HEADER: &str = "x-csrf-token";

#[derive(Debug, Clone, Copy)]
pub struct CurrentUser(pub Uuid);

#[derive(Debug, Clone)]
pub struct SessionCsrf(pub String);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if state.allow_insecure_dev_auth
            && let Some(value) = parts.headers.get(DEVELOPMENT_USER_HEADER)
        {
            let value = value.to_str().map_err(|_| AppError::Unauthorized)?;
            let user_id = value.parse::<Uuid>().map_err(|_| AppError::Unauthorized)?;
            return Ok(Self(user_id));
        }

        if let Some(token) = session_token(&parts.headers) {
            let session = state.store.authenticate_session(token).await?;
            if requires_csrf(&parts.method) {
                let supplied = parts
                    .headers
                    .get(CSRF_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .ok_or(AppError::Forbidden("a valid CSRF token is required"))?;
                if supplied != session.csrf_token {
                    return Err(AppError::Forbidden("a valid CSRF token is required"));
                }
            }
            parts.extensions.insert(SessionCsrf(session.csrf_token));
            return Ok(Self(session.user_id));
        }

        Err(AppError::Unauthorized)
    }
}

pub fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .map(str::trim)
        .find_map(|cookie| cookie.strip_prefix(&format!("{SESSION_COOKIE}=")))
        .filter(|value| !value.is_empty())
}

fn requires_csrf(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}
