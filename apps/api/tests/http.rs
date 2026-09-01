use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use prosepect_api::{
    app::{self, ApiDoc},
    auth::DEVELOPMENT_USER_HEADER,
    config::{Config, Environment, GoogleOAuthConfig, ObjectStorageConfig},
    store::{DEVELOPMENT_USER_ID, Store},
};
use sqlx::PgPool;
use tower::ServiceExt;
use utoipa::OpenApi;

#[sqlx::test(migrations = "../../migrations")]
async fn development_session_uses_an_http_only_cookie_and_csrf_token(
    pool: PgPool,
) -> anyhow::Result<()> {
    let config = test_config();
    let router = app::build(&config, Store::from_pool(pool))?;

    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/development/session")
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("session cookie")
        .to_str()?
        .split(';')
        .next()
        .expect("cookie value")
        .to_owned();
    assert!(
        response.headers()[header::SET_COOKIE]
            .to_str()?
            .contains("HttpOnly")
    );
    assert!(
        response.headers()[header::SET_COOKIE]
            .to_str()?
            .contains("SameSite=Lax")
    );
    let body = to_bytes(response.into_body(), 64 * 1024).await?;
    let session: serde_json::Value = serde_json::from_slice(&body)?;
    let csrf_token = session["csrf_token"].as_str().expect("CSRF token");

    let current = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/session")
                .header(header::COOKIE, &cookie)
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(current.status(), StatusCode::OK);

    let rejected = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects")
                .header(header::COOKIE, &cookie)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"No CSRF"}"#))?,
        )
        .await?;
    assert_eq!(rejected.status(), StatusCode::FORBIDDEN);

    let accepted = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/projects")
                .header(header::COOKIE, cookie)
                .header("x-csrf-token", csrf_token)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"name":"With CSRF"}"#))?,
        )
        .await?;
    assert_eq!(accepted.status(), StatusCode::CREATED);

    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn synchronization_trigger_requires_its_service_token(pool: PgPool) -> anyhow::Result<()> {
    let token = "worker-trigger-token-for-tests-123";
    let mut config = test_config();
    config.worker_trigger_token = Some(token.to_owned());
    config.google_oauth = Some(GoogleOAuthConfig {
        client_id: "test-client".to_owned(),
        client_secret: "test-secret".to_owned(),
        redirect_uri: "http://localhost/callback".to_owned(),
        token_encryption_key: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=".to_owned(),
    });
    let router = app::build(&config, Store::from_pool(pool))?;

    let rejected = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/synchronization/run")
                .header(header::AUTHORIZATION, "Bearer wrong-token")
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);

    let accepted = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/internal/synchronization/run")
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(accepted.status(), StatusCode::OK);
    let body = to_bytes(accepted.into_body(), 64 * 1024).await?;
    let body: serde_json::Value = serde_json::from_slice(&body)?;
    assert_eq!(body["enqueued"], 0);
    assert_eq!(body["processed"], false);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn file_upload_download_and_deletion_are_tenant_scoped(pool: PgPool) -> anyhow::Result<()> {
    let config = test_config();
    let router = app::build(&config, Store::from_pool(pool))?;
    router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/development/session")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;

    let boundary = "prosepect-test-boundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"brief.txt\"\r\nContent-Type: text/plain\r\n\r\nprivate attachment\r\n--{boundary}--\r\n"
    );
    let uploaded = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .header(
                    header::CONTENT_TYPE,
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(Body::from(body))?,
        )
        .await?;
    let upload_status = uploaded.status();
    let body = to_bytes(uploaded.into_body(), 64 * 1024).await?;
    assert_eq!(
        upload_status,
        StatusCode::CREATED,
        "upload response: {}",
        String::from_utf8_lossy(&body)
    );
    let file: serde_json::Value = serde_json::from_slice(&body)?;
    let file_id = file["id"].as_str().expect("file id");
    assert_eq!(file["filename"], "brief.txt");

    let denied = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header(DEVELOPMENT_USER_HEADER, uuid::Uuid::new_v4().to_string())
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(denied.status(), StatusCode::NOT_FOUND);

    let downloaded = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/v1/files/{file_id}/download"))
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(downloaded.status(), StatusCode::OK);
    assert_eq!(
        to_bytes(downloaded.into_body(), 64 * 1024).await?,
        "private attachment"
    );

    let deleted = router
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/v1/files/{file_id}"))
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn file_uploads_respect_the_global_storage_quota(pool: PgPool) -> anyhow::Result<()> {
    let mut config = test_config();
    config.max_total_file_storage_bytes = 8;
    let router = app::build(&config, Store::from_pool(pool.clone()))?;
    router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/development/session")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;

    for (contents, expected) in [
        ("12345678", StatusCode::CREATED),
        ("x", StatusCode::PAYLOAD_TOO_LARGE),
    ] {
        let boundary = format!("prosepect-quota-{}", contents.len());
        let body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"quota.txt\"\r\nContent-Type: text/plain\r\n\r\n{contents}\r\n--{boundary}--\r\n"
        );
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/files")
                    .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                    .header(
                        header::CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(body))?,
            )
            .await?;
        assert_eq!(response.status(), expected);
    }

    let stored_bytes: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(byte_size), 0)::BIGINT FROM files")
            .fetch_one(&pool)
            .await?;
    assert_eq!(stored_bytes, 8);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn settings_exports_and_account_deletion_work_end_to_end(pool: PgPool) -> anyhow::Result<()> {
    let config = test_config();
    let router = app::build(&config, Store::from_pool(pool.clone()))?;
    router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/development/session")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;

    let settings = router
        .clone()
        .oneshot(
            Request::builder()
                .method("PUT")
                .uri("/api/v1/settings")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"theme":"dark","automatic_daily_review":false,"sync_conflict_policy":"latest","expected_version":1}"#,
                ))?,
        )
        .await?;
    assert_eq!(settings.status(), StatusCode::OK);

    let export = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/v1/exports/json")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(export.status(), StatusCode::OK);
    assert_eq!(
        export.headers()[header::CONTENT_DISPOSITION],
        "attachment; filename=\"prosepect-export.json\""
    );
    let export_body = to_bytes(export.into_body(), 1024 * 1024).await?;
    let export_json: serde_json::Value = serde_json::from_slice(&export_body)?;
    assert_eq!(export_json["user"]["id"], DEVELOPMENT_USER_ID.to_string());

    let deleted = router
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri("/api/v1/account")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(r#"{"confirmation":"DELETE"}"#))?,
        )
        .await?;
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let user_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(DEVELOPMENT_USER_ID)
        .fetch_one(&pool)
        .await?;
    assert!(!user_exists);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn todoist_import_is_created_atomically_through_the_api(pool: PgPool) -> anyhow::Result<()> {
    let router = app::build(&test_config(), Store::from_pool(pool.clone()))?;
    router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/development/session")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;

    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/imports/todoist")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{
                        "project_name":"Imported work",
                        "project_description":"Imported from Todoist",
                        "tasks":[{
                            "title":"Imported task",
                            "description":"Context",
                            "due_at":"2026-09-15T16:00:00Z",
                            "scheduled_start":null,
                            "scheduled_end":null,
                            "priority":"urgent",
                            "recurrence":"none",
                            "labels":["review"],
                            "parent_index":null
                        }]
                    }"#,
                ))?,
        )
        .await?;

    let status = response.status();
    let body = to_bytes(response.into_body(), 64 * 1024).await?;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "import response: {}",
        String::from_utf8_lossy(&body)
    );
    let result: serde_json::Value = serde_json::from_slice(&body)?;
    assert_eq!(result["project"]["name"], "Imported work");
    assert_eq!(result["imported_tasks"], 1);
    let task_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tasks WHERE user_id = $1")
        .bind(DEVELOPMENT_USER_ID)
        .fetch_one(&pool)
        .await?;
    assert_eq!(task_count, 1);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn extractor_failures_use_the_error_envelope(pool: PgPool) -> anyhow::Result<()> {
    let openapi = serde_json::to_value(ApiDoc::openapi())?;
    assert_eq!(
        openapi["components"]["securitySchemes"]["development_user"]["name"],
        DEVELOPMENT_USER_HEADER
    );
    assert_eq!(
        openapi["paths"]["/api/v1/tasks"]["get"]["security"],
        serde_json::json!([
            { "session_cookie": [] },
            { "development_user": [] }
        ])
    );

    let config = test_config();
    let router = app::build(&config, Store::from_pool(pool))?;
    let request = Request::builder()
        .method("POST")
        .uri("/api/v1/projects")
        .header(header::CONTENT_TYPE, "application/json")
        .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
        .body(Body::from("{"))?;

    let response = router.clone().oneshot(request).await?;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);

    let body = to_bytes(response.into_body(), 64 * 1024).await?;
    let body: serde_json::Value = serde_json::from_slice(&body)?;
    assert_eq!(body["error"]["code"], "invalid_request");
    assert!(body["error"]["message"].is_string());

    let missing = router
        .clone()
        .oneshot(Request::builder().uri("/missing").body(Body::empty())?)
        .await?;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let body = to_bytes(missing.into_body(), 64 * 1024).await?;
    let body: serde_json::Value = serde_json::from_slice(&body)?;
    assert_eq!(body["error"]["code"], "route_not_found");

    let wrong_method = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/health")
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(wrong_method.status(), StatusCode::METHOD_NOT_ALLOWED);
    let body = to_bytes(wrong_method.into_body(), 64 * 1024).await?;
    let body: serde_json::Value = serde_json::from_slice(&body)?;
    assert_eq!(body["error"]["code"], "method_not_allowed");

    Ok(())
}

fn test_config() -> Config {
    Config {
        environment: Environment::Test,
        bind_address: "127.0.0.1:3000".parse().expect("test address"),
        database_url: "unused".to_owned(),
        database_max_connections: 1,
        cors_allowed_origin: "http://localhost:5173".to_owned(),
        app_url: "http://localhost:5173".to_owned(),
        allow_insecure_dev_auth: true,
        invite_only: false,
        trust_proxy_headers: false,
        google_oauth: None,
        object_storage: ObjectStorageConfig::Local {
            root: std::env::temp_dir()
                .join("prosepect-http-tests")
                .to_string_lossy()
                .into_owned(),
        },
        max_file_size_bytes: 25 * 1024 * 1024,
        max_total_file_storage_bytes: 5_i64 * 1024 * 1024 * 1024,
        worker_trigger_token: None,
    }
}
