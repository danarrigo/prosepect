use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use prosepect_api::{
    app::{self, ApiDoc},
    auth::DEVELOPMENT_USER_HEADER,
    config::{Config, Environment},
    store::{DEVELOPMENT_USER_ID, Store},
};
use sqlx::PgPool;
use tower::ServiceExt;
use utoipa::OpenApi;

#[sqlx::test(migrations = "../../migrations")]
async fn extractor_failures_use_the_error_envelope(pool: PgPool) -> anyhow::Result<()> {
    let openapi = serde_json::to_value(ApiDoc::openapi())?;
    assert_eq!(
        openapi["components"]["securitySchemes"]["development_user"]["name"],
        DEVELOPMENT_USER_HEADER
    );
    assert_eq!(
        openapi["paths"]["/api/v1/tasks"]["get"]["security"][0]["development_user"],
        serde_json::json!([])
    );

    let config = Config {
        environment: Environment::Test,
        bind_address: "127.0.0.1:3000".parse()?,
        database_url: "unused".to_owned(),
        database_max_connections: 1,
        cors_allowed_origin: "http://localhost:5173".to_owned(),
        allow_insecure_dev_auth: true,
    };
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
