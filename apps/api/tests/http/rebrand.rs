use super::*;

#[sqlx::test(migrations = "../../migrations")]
async fn cutover_cors_allows_both_exact_sites_but_not_other_origins(
    pool: PgPool,
) -> anyhow::Result<()> {
    let mut config = test_config();
    config.cors_allowed_origin = "https://rakkio.com,https://prosepect.com".to_owned();
    let router = app::build(&config, Store::from_pool(pool))?;
    for (origin, allowed) in [
        ("https://rakkio.com", true),
        ("https://prosepect.com", true),
        ("https://rakkio.com.attacker.invalid", false),
        ("https://attacker.invalid", false),
    ] {
        let response = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/v1/tasks")
                    .header(header::ORIGIN, origin)
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .header(
                        header::ACCESS_CONTROL_REQUEST_HEADERS,
                        "content-type,x-csrf-token",
                    )
                    .body(Body::empty())?,
            )
            .await?;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            allowed.then_some(origin)
        );
        if allowed {
            assert_eq!(
                response.headers()[header::ACCESS_CONTROL_ALLOW_CREDENTIALS],
                "true"
            );
        }
    }
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn cors_configuration_rejects_wildcards_and_non_origin_urls(
    pool: PgPool,
) -> anyhow::Result<()> {
    for origin in [
        "*",
        "https://*.rakkio.com",
        "https://rakkio.com/path",
        "https://user@rakkio.com",
        "https://rakkio.com?query=1",
        "https://rakkio.com,",
        "null",
    ] {
        let mut config = test_config();
        config.cors_allowed_origin = origin.to_owned();
        assert!(
            app::build(&config, Store::from_pool(pool.clone())).is_err(),
            "invalid origin must fail closed"
        );
    }
    Ok(())
}
