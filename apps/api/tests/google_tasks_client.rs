use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    Json, Router,
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
};
use prosepect_api::{
    google_tasks::TaskFields,
    google_tasks_client::{GoogleTask, GoogleTasksClient, TasksError},
};
use serde_json::{Value, json};
use tokio::net::TcpListener;

struct Fixture {
    client: GoogleTasksClient,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
async fn fixture(app: Router) -> Fixture {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/", listener.local_addr().unwrap())
        .parse()
        .unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Fixture {
        client: GoogleTasksClient::new().unwrap().with_api_base(base),
        server,
    }
}
fn fields() -> TaskFields {
    TaskFields {
        title: "Deadline only".into(),
        date: Some("2026-10-03".parse().unwrap()),
        completed: false,
    }
}

#[tokio::test]
async fn paginates_and_explicitly_requests_hidden_completed_and_deleted_tasks() {
    async fn page(Query(query): Query<HashMap<String, String>>, headers: HeaderMap) -> Json<Value> {
        assert_eq!(headers["authorization"], "Bearer fixture-token");
        for flag in ["showCompleted", "showHidden", "showDeleted"] {
            assert_eq!(query[flag], "true");
        }
        assert_eq!(query["showAssigned"], "false");
        assert_eq!(query["maxResults"], "100");
        Json(if query.contains_key("pageToken") {
            assert_eq!(query["pageToken"], "second");
            json!({"items":[{"id":"deleted", "deleted":true}]})
        } else {
            json!({"items":[{"id":"done", "title":"Completed task", "status":"completed", "hidden":true}],"nextPageToken":"second"})
        })
    }
    let f = fixture(Router::new().route("/lists/list/tasks", get(page))).await;
    let tasks = f.client.tasks("fixture-token", "list").await.unwrap();
    assert_eq!(tasks.len(), 2);
    assert!(tasks[0].fields().unwrap().completed);
    assert!(tasks[0].hidden);
    assert!(tasks[1].deleted);
    assert_eq!(tasks[1].fields(), Err(TasksError::InvalidInput));
}

#[tokio::test]
async fn repeated_page_tokens_fail_without_returning_a_partial_list() {
    let f = fixture(Router::new().route(
        "/lists/list/tasks",
        get(|| async { Json(json!({"items":[],"nextPageToken":"same"})) }),
    ))
    .await;
    assert!(matches!(
        f.client.tasks("fixture-token", "list").await,
        Err(TasksError::InvalidResponse)
    ));
}

#[tokio::test]
async fn patch_uses_exact_etag_and_never_overwrites_google_notes() {
    async fn update(headers: HeaderMap, Json(body): Json<Value>) -> StatusCode {
        assert_eq!(headers["if-match"], "\"version-one\"");
        assert_eq!(body, fields().google_body());
        assert!(body.get("notes").is_none());
        StatusCode::PRECONDITION_FAILED
    }
    let f = fixture(Router::new().route("/lists/list/tasks/task", patch(update))).await;
    assert!(matches!(
        f.client
            .update(
                "fixture-token",
                "list",
                "task",
                "\"version-one\"",
                &fields()
            )
            .await,
        Err(TasksError::Conflict)
    ));
    assert!(matches!(
        f.client
            .update("fixture-token", "list", "task", "*", &fields())
            .await,
        Err(TasksError::InvalidInput)
    ));
    assert!(matches!(
        f.client
            .update("fixture-token", "list", "task", "", &fields())
            .await,
        Err(TasksError::InvalidInput)
    ));
}

#[tokio::test]
async fn failed_task_create_is_ambiguous_and_is_not_retried() {
    let hits = Arc::new(AtomicUsize::new(0));
    async fn create(State(hits): State<Arc<AtomicUsize>>, Json(body): Json<Value>) -> StatusCode {
        hits.fetch_add(1, Ordering::SeqCst);
        assert_eq!(body["notes"], "prosepect task reference");
        StatusCode::INTERNAL_SERVER_ERROR
    }
    let f = fixture(
        Router::new()
            .route("/lists/list/tasks", post(create))
            .with_state(hits.clone()),
    )
    .await;
    assert!(matches!(
        f.client
            .create(
                "fixture-token",
                "list",
                &fields(),
                "prosepect task reference"
            )
            .await,
        Err(TasksError::AmbiguousCreate)
    ));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn incomplete_successful_create_response_is_also_ambiguous() {
    let f = fixture(Router::new().route(
        "/users/@me/lists",
        post(|| async { Json(json!({"title":"prosepect"})) }),
    ))
    .await;
    assert!(matches!(
        f.client.create_list("fixture-token").await,
        Err(TasksError::AmbiguousCreate)
    ));
}

#[tokio::test]
async fn authorization_and_rate_limit_errors_do_not_expose_provider_bodies() {
    let f = fixture(
        Router::new()
            .route(
                "/lists/denied/tasks",
                get(|| async { (StatusCode::FORBIDDEN, "private provider details") }),
            )
            .route(
                "/lists/limited/tasks",
                get(|| async { StatusCode::TOO_MANY_REQUESTS }),
            ),
    )
    .await;
    let denied = f.client.tasks("fixture-token", "denied").await.unwrap_err();
    assert_eq!(denied, TasksError::Authorization);
    assert!(!denied.to_string().contains("private provider details"));
    assert!(matches!(
        f.client.tasks("fixture-token", "limited").await,
        Err(TasksError::RateLimited)
    ));
}

#[tokio::test]
async fn oversized_pages_and_mismatched_resource_identity_are_rejected() {
    let f = fixture(
        Router::new()
            .route(
                "/lists/large/tasks",
                get(|| async { "x".repeat(2 * 1024 * 1024 + 1) }),
            )
            .route(
                "/lists/list/tasks/task",
                get(|| async { Json(json!({"id":"other-task"})) }),
            ),
    )
    .await;
    assert!(matches!(
        f.client.tasks("fixture-token", "large").await,
        Err(TasksError::Capacity)
    ));
    assert!(matches!(
        f.client.get("fixture-token", "list", "task").await,
        Err(TasksError::InvalidResponse)
    ));
}

#[test]
fn dates_are_calendar_days_and_unsupported_tasks_are_not_coerced() {
    let task: GoogleTask = serde_json::from_value(json!({
        "id":"task", "title":"Title", "due":"2026-10-03T23:00:00-11:00", "status":"needsAction"
    }))
    .unwrap();
    assert_eq!(
        task.fields().unwrap().date,
        Some("2026-10-03".parse().unwrap())
    );
    let unknown: GoogleTask =
        serde_json::from_value(json!({"id":"task","title":"Title","status":"unknown"})).unwrap();
    assert_eq!(unknown.fields(), Err(TasksError::InvalidResponse));
    let assigned: GoogleTask = serde_json::from_value(
        json!({"id":"task","title":"Title","status":"needsAction","assignmentInfo":{}}),
    )
    .unwrap();
    assert_eq!(assigned.fields(), Err(TasksError::InvalidInput));
}
