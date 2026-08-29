use axum::{
    Router,
    http::{HeaderName, HeaderValue, Method, header},
    routing::{get, post, put},
};
use tower_http::{
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    auth::DEVELOPMENT_USER_HEADER,
    config::Config,
    error::{ErrorBody, ErrorResponse},
    models::{
        CreateProjectRequest, CreateTaskRequest, DevelopmentSession, HealthResponse, Project,
        ProjectPage, ProjectStatus, ReorderTasksRequest, Task, TaskPage, TaskPriority,
        TaskRecurrence, TaskStatus, UpdateProjectRequest, UpdateTaskRequest,
    },
    routes,
    store::Store,
};

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub allow_insecure_dev_auth: bool,
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Prosepect API",
        version = "0.1.0",
        description = "Personal productivity API for Prosepect"
    ),
    paths(
        routes::health,
        routes::ready,
        routes::development_session,
        routes::create_project,
        routes::list_projects,
        routes::update_project,
        routes::delete_project,
        routes::create_task,
        routes::list_tasks,
        routes::reorder_tasks,
        routes::update_task,
        routes::delete_task
    ),
    components(schemas(
        ErrorBody,
        ErrorResponse,
        HealthResponse,
        DevelopmentSession,
        ProjectStatus,
        Project,
        ProjectPage,
        CreateProjectRequest,
        UpdateProjectRequest,
        TaskStatus,
        TaskPriority,
        TaskRecurrence,
        Task,
        TaskPage,
        CreateTaskRequest,
        UpdateTaskRequest,
        ReorderTasksRequest
    )),
    modifiers(&DevelopmentSecurity),
    tags(
        (name = "system", description = "Health and readiness"),
        (name = "development", description = "Development-only session bootstrap"),
        (name = "projects", description = "Outcome-oriented projects"),
        (name = "tasks", description = "Project tasks")
    )
)]
pub struct ApiDoc;

struct DevelopmentSecurity;

impl Modify for DevelopmentSecurity {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "development_user",
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::with_description(
                    DEVELOPMENT_USER_HEADER,
                    "Development-only user identifier. This scheme is replaced by secure session cookies before production.",
                ))),
            );
        }
    }
}

pub fn build(config: &Config, store: Store) -> anyhow::Result<Router> {
    let origin: HeaderValue = config.cors_allowed_origin.parse()?;
    let request_id_header = HeaderName::from_static("x-request-id");
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static(DEVELOPMENT_USER_HEADER),
        ]);
    let state = AppState {
        store,
        allow_insecure_dev_auth: config.allow_insecure_dev_auth,
    };

    let api = Router::new()
        .route("/development/session", post(routes::development_session))
        .route(
            "/projects",
            get(routes::list_projects).post(routes::create_project),
        )
        .route(
            "/projects/{project_id}",
            put(routes::update_project).delete(routes::delete_project),
        )
        .route("/tasks", get(routes::list_tasks).post(routes::create_task))
        .route("/tasks/order", put(routes::reorder_tasks))
        .route(
            "/tasks/{task_id}",
            put(routes::update_task).delete(routes::delete_task),
        );

    Ok(Router::new()
        .route("/health", get(routes::health))
        .route("/ready", get(routes::ready))
        .nest("/api/v1", api)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .fallback(routes::route_not_found)
        .method_not_allowed_fallback(routes::method_not_allowed)
        .with_state(state)
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .layer(cors))
}
