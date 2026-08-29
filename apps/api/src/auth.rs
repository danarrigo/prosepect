use axum::{extract::FromRequestParts, http::request::Parts};
use uuid::Uuid;

use crate::{app::AppState, error::AppError};

pub const DEVELOPMENT_USER_HEADER: &str = "x-prosepect-user-id";

#[derive(Debug, Clone, Copy)]
pub struct CurrentUser(pub Uuid);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if !state.allow_insecure_dev_auth {
            return Err(AppError::Unauthorized);
        }

        let value = parts
            .headers
            .get(DEVELOPMENT_USER_HEADER)
            .ok_or(AppError::Unauthorized)?;
        let value = value.to_str().map_err(|_| AppError::Unauthorized)?;
        let user_id = value.parse::<Uuid>().map_err(|_| AppError::Unauthorized)?;

        Ok(Self(user_id))
    }
}
