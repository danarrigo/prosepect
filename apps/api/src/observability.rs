use std::{sync::OnceLock, time::Instant};

use axum::{
    extract::{MatchedPath, Request},
    middleware::Next,
    response::Response,
};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

static METRICS: OnceLock<PrometheusHandle> = OnceLock::new();

pub fn initialize_metrics() -> PrometheusHandle {
    METRICS
        .get_or_init(|| {
            let recorder = PrometheusBuilder::new()
                .with_recommended_naming(true)
                .build_recorder();
            let handle = recorder.handle();
            if metrics::set_global_recorder(recorder).is_err() {
                tracing::warn!("a metrics recorder was already installed");
            }
            handle
        })
        .clone()
}

pub async fn track_http_metrics(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().to_string();
    let path = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str)
        .unwrap_or("unmatched")
        .to_owned();
    let response = next.run(request).await;
    let status = response.status().as_u16().to_string();
    metrics::counter!(
        "prosepect_http_requests_total",
        "method" => method,
        "path" => path,
        "status" => status.clone()
    )
    .increment(1);
    metrics::histogram!(
        "prosepect_http_request_duration_seconds",
        "status" => status.clone()
    )
    .record(started.elapsed().as_secs_f64());
    if response.status().is_server_error() {
        metrics::counter!("prosepect_api_errors_total", "status" => status).increment(1);
    }
    response
}
