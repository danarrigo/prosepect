use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{Duration, Utc};
use prosepect_api::{
    config::GoogleOAuthConfig, google_auth::GoogleOAuth, store::Store, sync_service::SyncService,
};
use serde_json::json;
use sqlx::PgPool;
use tokio::net::TcpListener;
use uuid::Uuid;

#[derive(Clone)]
struct MockGoogleState {
    requests: Arc<AtomicUsize>,
}

#[sqlx::test(migrations = "../../migrations")]
async fn synchronization_recovers_an_expired_token_and_imports_a_remote_event(
    pool: PgPool,
) -> anyhow::Result<()> {
    let state = MockGoogleState {
        requests: Arc::new(AtomicUsize::new(0)),
    };
    let app = Router::new()
        .route("/calendars/{calendar_id}/events", get(mock_google_events))
        .with_state(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server = tokio::spawn(async move { axum::serve(listener, app).await });

    let user_id = create_user(&pool, "sync-provider@example.com").await?;
    let calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected, is_default, sync_token
        ) VALUES ($1, $2, 'Google', '#4285f4', 'google', 'remote-calendar', TRUE, FALSE, 'expired-token')
        "#,
    )
    .bind(calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;

    let encryption_key = [42_u8; 32];
    sqlx::query(
        r#"
        INSERT INTO google_accounts (
            user_id, encrypted_access_token, access_token_expires_at, scopes
        ) VALUES ($1, $2, $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(encrypt_token(&encryption_key, b"provider-access-token")?)
    .bind(Utc::now() + Duration::hours(1))
    .bind(vec!["https://www.googleapis.com/auth/calendar.events"])
    .execute(&pool)
    .await?;

    let store = Store::from_pool(pool.clone());
    store
        .enqueue_sync(
            user_id,
            Some(calendar_id),
            "calendar_sync",
            "provider-recovery-test",
        )
        .await?;
    let google = GoogleOAuth::new(GoogleOAuthConfig {
        client_id: "test-client".to_owned(),
        client_secret: "test-secret".to_owned(),
        redirect_uri: "http://localhost/callback".to_owned(),
        token_encryption_key: STANDARD.encode(encryption_key),
    })?;
    let service = SyncService::new(store, google)?.with_api_base(format!("http://{address}"));

    assert!(service.run_once().await?);

    let imported: (String, String) = sqlx::query_as(
        "SELECT title, location FROM calendar_events WHERE user_id = $1 AND calendar_id = $2",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(imported.0, "Provider planning session");
    assert_eq!(imported.1, "Remote room");
    let sync_token: Option<String> =
        sqlx::query_scalar("SELECT sync_token FROM calendars WHERE id = $1")
            .bind(calendar_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(sync_token.as_deref(), Some("replacement-token"));
    assert_eq!(state.requests.load(Ordering::SeqCst), 2);
    let completed_jobs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_jobs WHERE user_id = $1 AND status = 'succeeded'",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(completed_jobs, 1);

    server.abort();
    Ok(())
}

async fn mock_google_events(
    State(state): State<MockGoogleState>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Response {
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some("Bearer provider-access-token")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    state.requests.fetch_add(1, Ordering::SeqCst);
    if query.contains_key("syncToken") {
        return StatusCode::GONE.into_response();
    }
    Json(json!({
        "items": [{
            "id": "remote-event-1",
            "etag": "etag-1",
            "status": "confirmed",
            "summary": "Provider planning session",
            "description": "Imported through the provider mock",
            "start": { "dateTime": "2026-09-01T09:00:00Z", "timeZone": "UTC" },
            "end": { "dateTime": "2026-09-01T10:00:00Z", "timeZone": "UTC" },
            "location": "Remote room",
            "attendees": [{ "email": "person@example.com" }],
            "updated": "2026-08-31T12:00:00Z"
        }],
        "nextSyncToken": "replacement-token"
    }))
    .into_response()
}

fn encrypt_token(key: &[u8; 32], plaintext: &[u8]) -> anyhow::Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("32-byte key");
    let nonce_bytes = [7_u8; 12];
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| anyhow::anyhow!("test token encryption failed"))?;
    let mut value = nonce_bytes.to_vec();
    value.extend(encrypted);
    Ok(value)
}

async fn create_user(pool: &PgPool, email: &str) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(email)
        .bind(email)
        .execute(pool)
        .await?;
    Ok(id)
}
