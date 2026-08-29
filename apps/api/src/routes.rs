use axum::{Json, extract::State, http::StatusCode};
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppError, AppResult, ErrorResponse},
    extract::{ApiJson, ApiPath, ApiQuery},
    models::{
        CreateProjectRequest, CreateTaskRequest, DevelopmentSession, ExpectedVersionQuery,
        HealthResponse, PageQuery, Project, ProjectPage, ReorderTasksRequest, Task, TaskListQuery,
        TaskPage, UpdateProjectRequest, UpdateTaskRequest,
    },
};

#[utoipa::path(
    get,
    path = "/health",
    responses((status = 200, description = "Process is healthy", body = HealthResponse)),
    tag = "system"
)]
pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[utoipa::path(
    get,
    path = "/ready",
    responses(
        (status = 200, description = "Dependencies are ready", body = HealthResponse),
        (status = 500, description = "A dependency is unavailable", body = ErrorResponse)
    ),
    tag = "system"
)]
pub async fn ready(State(state): State<AppState>) -> AppResult<Json<HealthResponse>> {
    state.store.ready().await?;
    Ok(Json(HealthResponse { status: "ready" }))
}

#[utoipa::path(
    post,
    path = "/api/v1/development/session",
    responses(
        (status = 200, description = "Development user session", body = DevelopmentSession),
        (status = 401, description = "Development authentication is disabled", body = ErrorResponse)
    ),
    tag = "development"
)]
pub async fn development_session(
    State(state): State<AppState>,
) -> AppResult<Json<DevelopmentSession>> {
    if !state.allow_insecure_dev_auth {
        return Err(AppError::Unauthorized);
    }

    Ok(Json(state.store.ensure_development_user().await?))
}

#[utoipa::path(
    post,
    path = "/api/v1/projects",
    request_body = CreateProjectRequest,
    responses(
        (status = 201, description = "Project created", body = Project),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "projects"
)]
pub async fn create_project(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<CreateProjectRequest>,
) -> AppResult<(StatusCode, Json<Project>)> {
    let project = state.store.create_project(user_id, request).await?;
    Ok((StatusCode::CREATED, Json(project)))
}

#[utoipa::path(
    get,
    path = "/api/v1/projects",
    params(PageQuery),
    responses(
        (status = 200, description = "Projects", body = ProjectPage),
        (status = 401, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "projects"
)]
pub async fn list_projects(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiQuery(query): ApiQuery<PageQuery>,
) -> AppResult<Json<ProjectPage>> {
    let page = state
        .store
        .list_projects(user_id, query.cursor, query.normalized_limit())
        .await?;
    Ok(Json(page))
}

#[utoipa::path(
    put,
    path = "/api/v1/projects/{project_id}",
    params(("project_id" = Uuid, Path, description = "Project identifier")),
    request_body = UpdateProjectRequest,
    responses(
        (status = 200, description = "Project updated", body = Project),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "projects"
)]
pub async fn update_project(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<UpdateProjectRequest>,
) -> AppResult<Json<Project>> {
    let project = state
        .store
        .update_project(user_id, project_id, request)
        .await?;
    Ok(Json(project))
}

#[utoipa::path(
    delete,
    path = "/api/v1/projects/{project_id}",
    params(
        ("project_id" = Uuid, Path, description = "Project identifier"),
        ExpectedVersionQuery
    ),
    responses(
        (status = 204, description = "Project deleted"),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "projects"
)]
pub async fn delete_project(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(project_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExpectedVersionQuery>,
) -> AppResult<StatusCode> {
    state
        .store
        .delete_project(user_id, project_id, query.expected_version)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/api/v1/tasks",
    request_body = CreateTaskRequest,
    responses(
        (status = 201, description = "Task created", body = Task),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "tasks"
)]
pub async fn create_task(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<CreateTaskRequest>,
) -> AppResult<(StatusCode, Json<Task>)> {
    let task = state.store.create_task(user_id, request).await?;
    Ok((StatusCode::CREATED, Json(task)))
}

#[utoipa::path(
    get,
    path = "/api/v1/tasks",
    params(TaskListQuery),
    responses(
        (status = 200, description = "Tasks", body = TaskPage),
        (status = 401, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "tasks"
)]
pub async fn list_tasks(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiQuery(query): ApiQuery<TaskListQuery>,
) -> AppResult<Json<TaskPage>> {
    let page = state
        .store
        .list_tasks(
            user_id,
            query.project_id,
            query.cursor,
            query.normalized_limit(),
        )
        .await?;
    Ok(Json(page))
}

#[utoipa::path(
    put,
    path = "/api/v1/tasks/order",
    request_body = ReorderTasksRequest,
    responses(
        (status = 204, description = "Task order updated"),
        (status = 401, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "tasks"
)]
pub async fn reorder_tasks(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiJson(request): ApiJson<ReorderTasksRequest>,
) -> AppResult<StatusCode> {
    state.store.reorder_tasks(user_id, request).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    put,
    path = "/api/v1/tasks/{task_id}",
    params(("task_id" = Uuid, Path, description = "Task identifier")),
    request_body = UpdateTaskRequest,
    responses(
        (status = 200, description = "Task updated", body = Task),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "tasks"
)]
pub async fn update_task(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(task_id): ApiPath<Uuid>,
    ApiJson(request): ApiJson<UpdateTaskRequest>,
) -> AppResult<Json<Task>> {
    let task = state.store.update_task(user_id, task_id, request).await?;
    Ok(Json(task))
}

#[utoipa::path(
    delete,
    path = "/api/v1/tasks/{task_id}",
    params(
        ("task_id" = Uuid, Path, description = "Task identifier"),
        ExpectedVersionQuery
    ),
    responses(
        (status = 204, description = "Task deleted"),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, body = ErrorResponse)
    ),
    security(("development_user" = [])),
    tag = "tasks"
)]
pub async fn delete_task(
    State(state): State<AppState>,
    CurrentUser(user_id): CurrentUser,
    ApiPath(task_id): ApiPath<Uuid>,
    ApiQuery(query): ApiQuery<ExpectedVersionQuery>,
) -> AppResult<StatusCode> {
    state
        .store
        .delete_task(user_id, task_id, query.expected_version)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn route_not_found() -> AppError {
    AppError::RouteNotFound
}

pub async fn method_not_allowed() -> AppError {
    AppError::MethodNotAllowed
}
