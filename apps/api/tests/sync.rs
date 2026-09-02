use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
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
    routing::{get, post, put},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use chrono::{Duration, Utc};
use prosepect_api::{
    config::GoogleOAuthConfig,
    google_auth::GoogleOAuth,
    models::{CreateTaskRequest, TaskPriority, TaskRecurrence, TaskStatus, UpdateTaskRequest},
    store::Store,
    sync_service::SyncService,
};
use serde_json::json;
use sqlx::PgPool;
use tokio::net::TcpListener;
use uuid::Uuid;

#[derive(Clone)]
struct MockGoogleState {
    requests: Arc<AtomicUsize>,
}

#[derive(Clone, Default)]
struct MutationState {
    creates: Arc<AtomicUsize>,
    updates: Arc<AtomicUsize>,
    deletes: Arc<AtomicUsize>,
    remote_change: Arc<AtomicBool>,
}

#[sqlx::test(migrations = "../../migrations")]
async fn scheduled_task_time_blocks_follow_the_google_event_lifecycle(
    pool: PgPool,
) -> anyhow::Result<()> {
    let state = MutationState::default();
    let app = Router::new()
        .route(
            "/calendars/{calendar_id}/events",
            get(mock_empty_google_events).post(mock_create_google_event),
        )
        .route(
            "/calendars/{calendar_id}/events/{event_id}",
            put(mock_update_google_event).delete(mock_delete_google_event),
        )
        .with_state(state.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server = tokio::spawn(async move { axum::serve(listener, app).await });

    let user_id = create_user(&pool, "task-lifecycle@example.com").await?;
    let calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected, is_default,
            provider_primary, access_role
        ) VALUES ($1, $2, 'Primary', '#4285f4', 'google', 'remote-calendar', TRUE, FALSE,
                  TRUE, 'owner')
        "#,
    )
    .bind(calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;
    let encryption_key = [31_u8; 32];
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
    let starts_at = Utc::now() + Duration::hours(2);
    let store = Store::from_pool(pool.clone());
    let task = store
        .create_task(
            user_id,
            CreateTaskRequest {
                project_id: None,
                parent_task_id: None,
                title: "Provider time block".to_owned(),
                description: "Mirrored scheduled work".to_owned(),
                due_at: None,
                scheduled_start: Some(starts_at),
                scheduled_end: Some(starts_at + Duration::hours(1)),
                status: TaskStatus::Todo,
                priority: TaskPriority::Medium,
                recurrence: TaskRecurrence::None,
                labels: Vec::new(),
                remind_at: None,
            },
        )
        .await?;
    let google = GoogleOAuth::new(GoogleOAuthConfig {
        client_id: "test-client".to_owned(),
        client_secret: "test-secret".to_owned(),
        redirect_uri: "http://localhost/callback".to_owned(),
        token_encryption_key: STANDARD.encode(encryption_key),
    })?;
    let service =
        SyncService::new(store.clone(), google, None)?.with_api_base(format!("http://{address}"));

    assert!(service.run_once().await?);
    assert_eq!(state.creates.load(Ordering::SeqCst), 1);
    assert_eq!(state.updates.load(Ordering::SeqCst), 0);
    assert_eq!(state.deletes.load(Ordering::SeqCst), 0);

    state.remote_change.store(true, Ordering::SeqCst);
    store
        .enqueue_sync(
            user_id,
            Some(calendar_id),
            "calendar_sync",
            "provider-remote-task-update",
        )
        .await?;
    assert!(service.run_once().await?);
    let task = store
        .list_tasks(user_id, None, None, 10)
        .await?
        .items
        .into_iter()
        .find(|candidate| candidate.id == task.id)
        .expect("mirrored task");
    assert_eq!(task.title, "Remotely moved task");
    assert_eq!(task.scheduled_start, Some("2026-09-03T11:00:00Z".parse()?));
    state.remote_change.store(false, Ordering::SeqCst);

    let completed = store
        .update_task(
            user_id,
            task.id,
            update_task_request(&task, TaskStatus::Completed, true),
        )
        .await?;
    assert!(service.run_once().await?);
    assert_eq!(state.updates.load(Ordering::SeqCst), 1);
    assert_eq!(state.deletes.load(Ordering::SeqCst), 0);

    store
        .update_task(
            user_id,
            task.id,
            update_task_request(&completed, TaskStatus::Completed, false),
        )
        .await?;
    assert!(service.run_once().await?);
    assert_eq!(state.deletes.load(Ordering::SeqCst), 1);
    let mappings: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM external_event_mappings WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(mappings, 0);

    server.abort();
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn synchronization_creates_a_renewable_google_watch_channel(
    pool: PgPool,
) -> anyhow::Result<()> {
    let app = Router::new().route(
        "/calendars/{calendar_id}/events/watch",
        post(mock_google_watch),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server = tokio::spawn(async move { axum::serve(listener, app).await });

    let user_id = create_user(&pool, "watch-provider@example.com").await?;
    let calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected, is_default,
            provider_primary, access_role
        ) VALUES ($1, $2, 'Google', '#4285f4', 'google', 'remote-calendar', TRUE, FALSE,
                  TRUE, 'owner')
        "#,
    )
    .bind(calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;
    let encryption_key = [24_u8; 32];
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
    let old_channel_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO google_watch_channels (
            channel_id, user_id, calendar_id, resource_id, token_hash, expires_at
        ) VALUES ($1, $2, $3, 'old-resource', $4, $5)
        "#,
    )
    .bind(old_channel_id)
    .bind(user_id)
    .bind(calendar_id)
    .bind(vec![1_u8; 32])
    .bind(Utc::now() + Duration::hours(12))
    .execute(&pool)
    .await?;
    let store = Store::from_pool(pool.clone());
    store
        .enqueue_sync(
            user_id,
            Some(calendar_id),
            "calendar_watch",
            "watch-provider-test",
        )
        .await?;
    let google = GoogleOAuth::new(GoogleOAuthConfig {
        client_id: "test-client".to_owned(),
        client_secret: "test-secret".to_owned(),
        redirect_uri: "http://localhost/callback".to_owned(),
        token_encryption_key: STANDARD.encode(encryption_key),
    })?;
    let service = SyncService::new(
        store,
        google,
        Some("https://api.prosepect.test/webhooks/google/calendar".to_owned()),
    )?
    .with_api_base(format!("http://{address}"));

    assert!(service.run_once().await?);
    let channels: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM google_watch_channels WHERE user_id = $1 AND calendar_id = $2",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(channels, 1);
    let active_channel: Uuid = sqlx::query_scalar(
        "SELECT channel_id FROM google_watch_channels WHERE user_id = $1 AND calendar_id = $2",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_ne!(active_channel, old_channel_id);
    let pending_syncs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_jobs WHERE user_id = $1 AND calendar_id = $2 AND kind = 'calendar_sync' AND status = 'pending'",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(pending_syncs, 1);

    server.abort();
    Ok(())
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
    let service = SyncService::new(store, google, None)?.with_api_base(format!("http://{address}"));

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

async fn mock_empty_google_events(
    State(state): State<MutationState>,
    headers: HeaderMap,
) -> Response {
    if !has_provider_access_token(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if state.remote_change.load(Ordering::SeqCst) {
        return Json(json!({
            "items": [{
                "id": "provider-task-event",
                "etag": "etag-remote-update",
                "status": "confirmed",
                "summary": "Remotely moved task",
                "description": "Changed through Google Calendar",
                "start": { "dateTime": "2026-09-03T11:00:00Z", "timeZone": "UTC" },
                "end": { "dateTime": "2026-09-03T12:00:00Z", "timeZone": "UTC" },
                "updated": "2026-09-03T10:30:00Z"
            }],
            "nextSyncToken": "provider-token-after-update"
        }))
        .into_response();
    }
    Json(json!({ "items": [], "nextSyncToken": "provider-token" })).into_response()
}

async fn mock_create_google_event(
    State(state): State<MutationState>,
    headers: HeaderMap,
    Json(mut event): Json<serde_json::Value>,
) -> Response {
    if !has_provider_access_token(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    state.creates.fetch_add(1, Ordering::SeqCst);
    event["id"] = json!("provider-task-event");
    event["etag"] = json!("etag-created");
    event["status"] = json!("confirmed");
    event["updated"] = json!(Utc::now());
    Json(event).into_response()
}

async fn mock_update_google_event(
    State(state): State<MutationState>,
    headers: HeaderMap,
    Json(mut event): Json<serde_json::Value>,
) -> Response {
    if !has_provider_access_token(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    state.updates.fetch_add(1, Ordering::SeqCst);
    event["id"] = json!("provider-task-event");
    event["etag"] = json!("etag-updated");
    event["status"] = json!("confirmed");
    event["updated"] = json!(Utc::now());
    Json(event).into_response()
}

async fn mock_delete_google_event(
    State(state): State<MutationState>,
    headers: HeaderMap,
) -> Response {
    if !has_provider_access_token(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    state.deletes.fetch_add(1, Ordering::SeqCst);
    StatusCode::NO_CONTENT.into_response()
}

fn has_provider_access_token(headers: &HeaderMap) -> bool {
    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        == Some("Bearer provider-access-token")
}

async fn mock_google_watch(headers: HeaderMap) -> Response {
    if headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        != Some("Bearer provider-access-token")
    {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    Json(json!({
        "id": Uuid::new_v4().to_string(),
        "resourceId": "watch-resource-1",
        "expiration": (Utc::now() + Duration::days(6)).timestamp_millis().to_string()
    }))
    .into_response()
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

fn update_task_request(
    task: &prosepect_api::models::Task,
    status: TaskStatus,
    keep_schedule: bool,
) -> UpdateTaskRequest {
    UpdateTaskRequest {
        project_id: task.project_id,
        parent_task_id: task.parent_task_id,
        title: task.title.clone(),
        description: task.description.clone(),
        due_at: task.due_at,
        scheduled_start: keep_schedule.then_some(task.scheduled_start).flatten(),
        scheduled_end: keep_schedule.then_some(task.scheduled_end).flatten(),
        status,
        priority: task.priority,
        recurrence: task.recurrence,
        labels: task.labels.clone(),
        remind_at: task.remind_at,
        expected_version: task.version,
    }
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
