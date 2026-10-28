use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::{
    app::AppState,
    error::{AppError, AppResult},
    rate_limit::LoginRateLimiter,
};

#[derive(Clone)]
pub struct RequestLimits {
    writes: LoginRateLimiter,
    requests: Arc<Semaphore>,
    large: Arc<Semaphore>,
}

impl Default for RequestLimits {
    fn default() -> Self {
        Self {
            // Enough for a full 50-task batch and independent Undo operations.
            writes: LoginRateLimiter::with_limit(240),
            requests: Arc::new(Semaphore::new(32)),
            large: Arc::new(Semaphore::new(2)),
        }
    }
}

impl RequestLimits {
    pub fn check_write(&self, user_id: Uuid) -> AppResult<()> {
        self.writes.check_key(&user_id.to_string())
    }

    pub fn large_request(&self) -> AppResult<OwnedSemaphorePermit> {
        self.large.clone().try_acquire_owned().map_err(|_| busy())
    }
}

fn busy() -> AppError {
    AppError::InvalidRequest {
        status: StatusCode::TOO_MANY_REQUESTS,
        message: "the server is busy; try again shortly".to_owned(),
    }
}

async fn acquire(slots: &Arc<Semaphore>) -> AppResult<OwnedSemaphorePermit> {
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        slots.clone().acquire_owned(),
    )
    .await
    .map_err(|_| busy())?
    .map_err(|_| busy())
}

pub async fn limit_requests(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let Ok(_permit) = acquire(&state.request_limits.requests).await else {
        return busy().into_response();
    };
    // Nested routers may strip their prefix. Bound the expensive collection
    // responses and imports before extracting/deserializing their bodies.
    let path = request.uri().path().trim_start_matches("/api/v1");
    let large = path.starts_with("/exports/")
        || path.starts_with("/imports/")
        || (request.method() == Method::GET && path == "/notes");
    let _large_permit = if large {
        match acquire(&state.request_limits.large).await {
            Ok(permit) => Some(permit),
            Err(error) => return error.into_response(),
        }
    } else {
        None
    };
    next.run(request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_requests_are_bounded_across_clones_and_release_on_drop() {
        let limits = RequestLimits::default();
        let first = limits.large_request().unwrap();
        let second = limits.clone().large_request().unwrap();
        assert!(limits.large_request().is_err());
        drop(first);
        assert!(limits.large_request().is_ok());
        drop(second);
    }

    #[test]
    fn write_limit_preserves_bulk_and_undo_but_blocks_flooding() {
        let limits = RequestLimits::default();
        let user = Uuid::now_v7();
        for _ in 0..240 {
            limits.check_write(user).unwrap();
        }
        assert!(limits.check_write(user).is_err());
        assert!(limits.check_write(Uuid::now_v7()).is_ok());
    }
}
