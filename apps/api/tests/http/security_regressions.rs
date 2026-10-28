use super::*;

#[sqlx::test(migrations = "../../migrations")]
async fn oauth_start_sets_a_short_lived_browser_binding(pool: PgPool) -> anyhow::Result<()> {
    let mut config = test_config();
    config.google_oauth = Some(GoogleOAuthConfig {
        client_id: "test-client".to_owned(),
        client_secret: "test-secret".to_owned(),
        redirect_uri: "http://localhost/callback".to_owned(),
        token_encryption_key: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=".to_owned(),
    });
    let router = app::build(&config, Store::from_pool(pool))?;
    let response = router.oneshot(Request::builder()
        .uri("/api/v1/auth/google/start?terms_version=2026-10-04&privacy_version=2026-10-04&age_confirmed=true")
        .body(Body::empty())?).await?;
    assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
    let cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .expect("OAuth start must bind the receiving browser")
        .to_str()?;
    assert!(cookie.starts_with("prosepect_oauth="));
    for required in ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=600"] {
        assert!(cookie.contains(required));
    }
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn json_is_bounded_before_deserialization(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool);
    store.ensure_development_user(DEVELOPMENT_USER_ID).await?;
    let router = app::build(&test_config(), store)?;
    let body = serde_json::json!({"title":"Oversized", "markdown":"x".repeat(2 * 1024 * 1024)})
        .to_string();
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/notes")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn csv_export_neutralizes_untrusted_spreadsheet_cells(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool);
    store.ensure_development_user(DEVELOPMENT_USER_ID).await?;
    store
        .create_task(
            DEVELOPMENT_USER_ID,
            serde_json::from_value(serde_json::json!({
                "title":"=1+1", "description":"@SUM(1,2)", "labels":["+example"]
            }))?,
        )
        .await?;
    let router = app::build(&test_config(), store)?;
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/v1/exports/tasks.csv")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .body(Body::empty())?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let csv = String::from_utf8(to_bytes(response.into_body(), 65536).await?.to_vec())?;
    assert!(
        csv.contains("'=1+1"),
        "CSV export must neutralize formula prefixes"
    );
    assert!(csv.contains("\"'@SUM(1,2)\""));
    assert!(csv.contains("'+example"));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn api_responses_apply_security_headers(pool: PgPool) -> anyhow::Result<()> {
    let router = app::build(&test_config(), Store::from_pool(pool))?;
    for path in ["/health", "/api/v1/session", "/unknown"] {
        let response = router
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty())?)
            .await?;
        assert_eq!(
            response
                .headers()
                .get("x-content-type-options")
                .and_then(|v| v.to_str().ok()),
            Some("nosniff")
        );
        assert_eq!(
            response
                .headers()
                .get("x-frame-options")
                .and_then(|v| v.to_str().ok()),
            Some("DENY")
        );
    }
    Ok(())
}
