use axum::{
    extract::FromRequestParts,
    http::{HeaderMap, Method, request::Parts},
};
use uuid::Uuid;

use crate::{app::AppState, error::AppError};

pub const DEVELOPMENT_USER_HEADER: &str = "x-prosepect-user-id";
pub const SESSION_COOKIE: &str = "prosepect_session";
pub const CSRF_HEADER: &str = "x-csrf-token";

pub fn oauth_cookie_name(secure: bool) -> &'static str {
    if secure {
        "__Host-prosepect_oauth"
    } else {
        "prosepect_oauth"
    }
}

pub fn oauth_browser_secret(headers: &HeaderMap, secure: bool) -> Option<&str> {
    let name = oauth_cookie_name(secure);
    headers
        .get_all(axum::http::header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|cookie| cookie.trim().split_once('='))
        .find_map(|(key, value)| {
            (key == name
                && value.len() == 43
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
            .then_some(value)
        })
}

fn limit_write(state: &AppState, parts: &Parts, user_id: Uuid) -> Result<(), AppError> {
    let logout = parts.method == Method::POST
        && parts.uri.path().trim_start_matches("/api/v1") == "/session/logout";
    if requires_csrf(&parts.method) && !logout {
        state.request_limits.check_write(user_id)?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub struct CurrentUser(pub Uuid);

// Only server-side middleware can populate this extension. Method binding
// prevents a later method-changing middleware from bypassing CSRF validation.
#[derive(Clone)]
struct AuthenticatedUser(Uuid, Method);

#[derive(Debug, Clone)]
pub struct SessionCsrf(pub String);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Some(AuthenticatedUser(user, method)) = parts.extensions.get::<AuthenticatedUser>()
            && method == &parts.method
        {
            return Ok(Self(*user));
        }
        if state.allow_insecure_dev_auth
            && let Some(value) = parts.headers.get(DEVELOPMENT_USER_HEADER)
        {
            let value = value.to_str().map_err(|_| AppError::Unauthorized)?;
            let user_id = value.parse::<Uuid>().map_err(|_| AppError::Unauthorized)?;
            limit_write(state, parts, user_id)?;
            parts
                .extensions
                .insert(AuthenticatedUser(user_id, parts.method.clone()));
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
            limit_write(state, parts, session.user_id)?;
            parts
                .extensions
                .insert(AuthenticatedUser(session.user_id, parts.method.clone()));
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
