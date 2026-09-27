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
    sync_dispatcher::SyncDispatcher,
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
    remote_delete: Arc<AtomicBool>,
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

    // A dirty local task and a Google deletion must require a decision first.
    let unscheduled = store
        .list_tasks(user_id, None, None, 10)
        .await?
        .items
        .remove(0);
    let mut reschedule = update_task_request(&unscheduled, TaskStatus::Completed, false);
    reschedule.scheduled_start = Some(starts_at);
    reschedule.scheduled_end = Some(starts_at + Duration::hours(1));
    let rescheduled = store.update_task(user_id, task.id, reschedule).await?;
    assert!(service.run_once().await?);
    let mut local_edit = update_task_request(&rescheduled, TaskStatus::Completed, true);
    local_edit.title = "Keep my local work".to_owned();
    store.update_task(user_id, task.id, local_edit).await?;
    state.remote_delete.store(true, Ordering::SeqCst);
    assert!(service.run_once().await?);
    let conflicts = store.list_sync_conflicts(user_id).await?.items;
    assert_eq!(conflicts.len(), 1);
    let before_decision = store
        .list_tasks(user_id, None, None, 10)
        .await?
        .items
        .remove(0);
    assert!(before_decision.scheduled_start.is_some());
    store
        .resolve_sync_conflict(user_id, conflicts[0].id, "google")
        .await?;
    assert!(service.run_once().await?);
    let after_deletion = store
        .list_tasks(user_id, None, None, 10)
        .await?
        .items
        .remove(0);
    assert_eq!(after_deletion.id, task.id);
    assert_eq!(after_deletion.status, TaskStatus::Completed);
    assert!(after_deletion.scheduled_start.is_none());
    assert!(after_deletion.scheduled_end.is_none());
    assert!(store.list_sync_conflicts(user_id).await?.items.is_empty());
    assert_eq!(state.deletes.load(Ordering::SeqCst), 1);

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
        store.clone(),
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
    let read_only_calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected, access_role
        ) VALUES ($1, $2, 'Read only', '#4285f4', 'google', 'read-only-calendar', TRUE, 'reader')
        "#,
    )
    .bind(read_only_calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;
    let enqueued = store
        .enqueue_expiring_calendar_watches(Some(user_id))
        .await?;
    assert_eq!(enqueued, 0);
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
    if state.remote_delete.load(Ordering::SeqCst) {
        return Json(json!({
            "items": [{"id": "provider-task-event", "status": "cancelled", "etag": "deleted"}],
            "nextSyncToken": "provider-token-after-deletion"
        }))
        .into_response();
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

struct DispatcherFixture {
    service: SyncService,
    store: Store,
    user_id: Uuid,
    calendar_id: Uuid,
    requests: Arc<AtomicUsize>,
    first_response: Arc<tokio::sync::Semaphore>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for DispatcherFixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}

async fn dispatcher_fixture(pool: &PgPool, failures: usize) -> anyhow::Result<DispatcherFixture> {
    let requests = Arc::new(AtomicUsize::new(0));
    let calls = requests.clone();
    let first_response = Arc::new(tokio::sync::Semaphore::new(1));
    let response_gate = first_response.clone();
    let app = Router::new().route(
        "/calendars/{calendar_id}/events",
        get(move || {
            let calls = calls.clone();
            let response_gate = response_gate.clone();
            async move {
                let attempt = calls.fetch_add(1, Ordering::SeqCst);
                if attempt == 0 {
                    // Tests can hold the first response without sleeping or real provider traffic.
                    let _permit = response_gate.acquire().await.unwrap();
                }
                if attempt < failures {
                    // Non-5xx failure: test the durable job retry, not HTTP-level retries.
                    StatusCode::BAD_REQUEST.into_response()
                } else {
                    Json(json!({ "items": [], "nextSyncToken": "dispatcher-token" }))
                        .into_response()
                }
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let user_id = create_user(pool, "dispatcher@example.com").await?;
    let calendar_id = Uuid::now_v7();
    // Keep startup periodic enqueue out of the scenario: only the seeded jobs should run.
    sqlx::query(
        "INSERT INTO calendars (id, user_id, name, color, source, external_id, selected, last_synced_at) VALUES ($1, $2, 'Google', '#4285f4', 'google', 'dispatcher-calendar', TRUE, NOW())",
    )
    .bind(calendar_id)
    .bind(user_id)
    .execute(pool)
    .await?;
    let encryption_key = [43_u8; 32];
    sqlx::query(
        "INSERT INTO google_accounts (user_id, encrypted_access_token, access_token_expires_at, scopes) VALUES ($1, $2, $3, $4)",
    )
    .bind(user_id)
    .bind(encrypt_token(&encryption_key, b"provider-access-token")?)
    .bind(Utc::now() + Duration::hours(1))
    .bind(vec!["https://www.googleapis.com/auth/calendar.events"])
    .execute(pool)
    .await?;
    let store = Store::from_pool(pool.clone());
    let google = GoogleOAuth::new(GoogleOAuthConfig {
        client_id: "test-client".to_owned(),
        client_secret: "test-secret".to_owned(),
        redirect_uri: "http://localhost/callback".to_owned(),
        token_encryption_key: STANDARD.encode(encryption_key),
    })?;
    let service =
        SyncService::new(store.clone(), google, None)?.with_api_base(format!("http://{address}"));
    Ok(DispatcherFixture {
        service,
        store,
        user_id,
        calendar_id,
        requests,
        first_response,
        server,
    })
}

async fn dispatcher_job(fixture: &DispatcherFixture, key: &str) -> anyhow::Result<Uuid> {
    Ok(fixture
        .store
        .enqueue_sync(
            fixture.user_id,
            Some(fixture.calendar_id),
            "calendar_sync",
            key,
        )
        .await?
        .id)
}

async fn wait_for_dispatcher_job(pool: &PgPool, id: Uuid, status: &str) -> anyhow::Result<i32> {
    // PostgreSQL uses wall time. Do not pause Tokio time or advance it independently of SQL.
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let mut poll = tokio::time::interval(std::time::Duration::from_millis(25));
        poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            poll.tick().await;
            let row: (String, i32) =
                sqlx::query_as("SELECT status, attempt_count FROM sync_jobs WHERE id = $1")
                    .bind(id)
                    .fetch_one(pool)
                    .await?;
            if row.0 == status {
                return Ok::<_, anyhow::Error>(row.1);
            }
        }
    })
    .await
    .map_err(|_| anyhow::anyhow!("dispatcher did not reach {status} for {id} without a wake"))?
}

#[sqlx::test(migrations = "../../migrations")]
async fn dispatcher_retries_future_failure_without_manual_wake(pool: PgPool) -> anyhow::Result<()> {
    let fixture = dispatcher_fixture(&pool, 1).await?;
    let job = dispatcher_job(&fixture, "fail-once").await?;
    let dispatcher = SyncDispatcher::start(fixture.service.clone());
    assert_eq!(wait_for_dispatcher_job(&pool, job, "failed").await?, 1);
    let future: bool =
        sqlx::query_scalar("SELECT available_at > NOW() FROM sync_jobs WHERE id = $1")
            .bind(job)
            .fetch_one(&pool)
            .await?;
    assert!(future, "the first failure must schedule a future retry");
    // No dispatcher.wake(), run_once(), frontend request, or SQL retry-time rewrite.
    assert_eq!(wait_for_dispatcher_job(&pool, job, "succeeded").await?, 2);
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 2);
    drop(dispatcher);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn dispatcher_startup_drains_due_retries_but_never_resurrects_terminal_jobs(
    pool: PgPool,
) -> anyhow::Result<()> {
    let fixture = dispatcher_fixture(&pool, 0).await?;
    let due = dispatcher_job(&fixture, "due-on-restart").await?;
    let terminal = dispatcher_job(&fixture, "exhausted").await?;
    let succeeded = dispatcher_job(&fixture, "already-succeeded").await?;
    let later = dispatcher_job(&fixture, "later-without-wake").await?;
    sqlx::query("UPDATE sync_jobs SET status = 'failed', attempt_count = 7 WHERE id = $1")
        .bind(due)
        .execute(&pool)
        .await?;
    sqlx::query("UPDATE sync_jobs SET status = 'failed', attempt_count = 8 WHERE id = $1")
        .bind(terminal)
        .execute(&pool)
        .await?;
    sqlx::query("UPDATE sync_jobs SET status = 'succeeded', attempt_count = 1 WHERE id = $1")
        .bind(succeeded)
        .execute(&pool)
        .await?;
    sqlx::query("UPDATE sync_jobs SET available_at = NOW() + INTERVAL '2 seconds' WHERE id = $1")
        .bind(later)
        .execute(&pool)
        .await?;
    let dispatcher = SyncDispatcher::start(fixture.service.clone());
    assert_eq!(wait_for_dispatcher_job(&pool, due, "succeeded").await?, 8);
    // A later timer cycle must neither replay the successful eighth attempt nor revive failures.
    assert_eq!(wait_for_dispatcher_job(&pool, later, "succeeded").await?, 1);
    assert_eq!(wait_for_dispatcher_job(&pool, terminal, "failed").await?, 8);
    assert_eq!(
        wait_for_dispatcher_job(&pool, succeeded, "succeeded").await?,
        1
    );
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 2);
    drop(dispatcher);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn dispatcher_final_failure_does_not_promise_another_retry(
    pool: PgPool,
) -> anyhow::Result<()> {
    let fixture = dispatcher_fixture(&pool, usize::MAX).await?;
    let job = dispatcher_job(&fixture, "final-failure").await?;
    sqlx::query("UPDATE sync_jobs SET status = 'failed', attempt_count = 7 WHERE id = $1")
        .bind(job)
        .execute(&pool)
        .await?;
    let dispatcher = SyncDispatcher::start(fixture.service.clone());
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let mut poll = tokio::time::interval(std::time::Duration::from_millis(25));
        loop {
            poll.tick().await;
            let message: Option<String> = sqlx::query_scalar("SELECT message FROM activity_entries WHERE user_id = $1 AND kind = 'synchronization_failed'")
                .bind(fixture.user_id).fetch_optional(&pool).await?;
            if let Some(message) = message {
                assert!(!message.contains("will be retried"), "terminal failure must not promise an automatic retry");
                return Ok::<_, anyhow::Error>(());
            }
        }
    }).await??;
    assert_eq!(wait_for_dispatcher_job(&pool, job, "failed").await?, 8);
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 1);
    drop(dispatcher);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn dispatcher_waits_after_database_error_then_recovers_without_wake(
    pool: PgPool,
) -> anyhow::Result<()> {
    let fixture = dispatcher_fixture(&pool, 0).await?;
    let job = dispatcher_job(&fixture, "claim-error").await?;
    // Sequence increments survive rollback: exactly the first claim fails in this disposable DB.
    sqlx::raw_sql(
        "CREATE SEQUENCE dispatcher_claim_attempts;
         CREATE FUNCTION fail_first_dispatcher_claim() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
             IF NEW.status = 'running' AND nextval('dispatcher_claim_attempts') = 1 THEN
                 RAISE EXCEPTION 'test transient claim error';
             END IF;
             RETURN NEW;
         END $$;
         CREATE TRIGGER dispatcher_claim_error BEFORE UPDATE ON sync_jobs
         FOR EACH ROW EXECUTE FUNCTION fail_first_dispatcher_claim();",
    )
    .execute(&pool)
    .await?;
    let started = std::time::Instant::now();
    let dispatcher = SyncDispatcher::start(fixture.service.clone());
    assert_eq!(wait_for_dispatcher_job(&pool, job, "succeeded").await?, 1);
    assert!(
        started.elapsed() >= std::time::Duration::from_secs(5),
        "errors must wait before polling again"
    );
    let claims: i64 = sqlx::query_scalar("SELECT last_value FROM dispatcher_claim_attempts")
        .fetch_one(&pool)
        .await?;
    assert_eq!(claims, 2);
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 1);
    drop(dispatcher);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn dispatcher_shutdown_finishes_current_job_without_starting_another(
    pool: PgPool,
) -> anyhow::Result<()> {
    let fixture = dispatcher_fixture(&pool, 0).await?;
    let first = dispatcher_job(&fixture, "shutdown-first").await?;
    let second = dispatcher_job(&fixture, "shutdown-second").await?;
    let blocked_response = fixture.first_response.acquire().await?;
    let dispatcher = SyncDispatcher::start(fixture.service.clone());
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        let mut poll = tokio::time::interval(std::time::Duration::from_millis(25));
        while fixture.requests.load(Ordering::SeqCst) == 0 {
            poll.tick().await;
        }
    })
    .await?;
    // Queue many coalesced wake signals while a real run_once is blocked in mock HTTP.
    for _ in 0..100 {
        dispatcher.wake();
    }
    drop(dispatcher);
    drop(blocked_response);
    assert_eq!(wait_for_dispatcher_job(&pool, first, "succeeded").await?, 1);
    // Observe an entire retry-poll window. Shutdown must suppress both buffered wakes and timers.
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(6), async {
            let mut poll = tokio::time::interval(std::time::Duration::from_millis(25));
            while fixture.requests.load(Ordering::SeqCst) == 1 {
                poll.tick().await;
            }
        })
        .await
        .is_err()
    );
    assert_eq!(wait_for_dispatcher_job(&pool, second, "pending").await?, 0);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn dispatcher_coalesces_wakes_and_bounds_each_drain(pool: PgPool) -> anyhow::Result<()> {
    let fixture = dispatcher_fixture(&pool, 0).await?;
    let mut jobs = Vec::new();
    for index in 0..33 {
        jobs.push(dispatcher_job(&fixture, &format!("bounded-drain-{index}")).await?);
    }
    // Block startup cleanup so the receiver cannot consume a signal during this burst.
    let mut startup_lock = pool.begin().await?;
    sqlx::query("LOCK TABLE oauth_login_attempts IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *startup_lock)
        .await?;
    let dispatcher = SyncDispatcher::start(fixture.service.clone());
    for _ in 0..100 {
        dispatcher.wake();
    }
    startup_lock.commit().await?;
    assert_eq!(
        wait_for_dispatcher_job(&pool, jobs[32], "succeeded").await?,
        1
    );
    let waited_between_batches: bool = sqlx::query_scalar(
        "SELECT later.updated_at >= earlier.updated_at + INTERVAL '5 seconds'
         FROM sync_jobs earlier, sync_jobs later WHERE earlier.id = $1 AND later.id = $2",
    )
    .bind(jobs[31])
    .bind(jobs[32])
    .fetch_one(&pool)
    .await?;
    assert!(waited_between_batches, "a drain must yield after 32 jobs");
    assert_eq!(fixture.requests.load(Ordering::SeqCst), 33);
    drop(dispatcher);
    Ok(())
}
