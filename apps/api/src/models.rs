use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

pub const DEFAULT_PAGE_SIZE: i64 = 50;
pub const MAX_PAGE_SIZE: i64 = 100;

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ProjectStatus {
    #[default]
    Planned,
    Active,
    Paused,
    Completed,
    Archived,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum TaskStatus {
    #[default]
    Todo,
    InProgress,
    Blocked,
    Completed,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum TaskPriority {
    Low,
    #[default]
    Medium,
    High,
    Urgent,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum TaskRecurrence {
    #[default]
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct Project {
    pub id: Uuid,
    pub name: String,
    pub outcome: String,
    pub target_date: Option<NaiveDate>,
    pub status: ProjectStatus,
    pub total_tasks: i64,
    pub completed_tasks: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateProjectRequest {
    pub name: String,
    #[serde(default)]
    pub outcome: String,
    pub target_date: Option<NaiveDate>,
    #[serde(default)]
    pub status: ProjectStatus,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateProjectRequest {
    pub name: String,
    pub outcome: String,
    pub target_date: Option<NaiveDate>,
    pub status: ProjectStatus,
    pub expected_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectPage {
    pub items: Vec<Project>,
    pub next_cursor: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    pub title: String,
    pub description: String,
    pub due_at: Option<DateTime<Utc>>,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub scheduled_end: Option<DateTime<Utc>>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    pub recurrence: TaskRecurrence,
    pub labels: Vec<String>,
    pub remind_at: Option<DateTime<Utc>>,
    pub position: i64,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateTaskRequest {
    pub project_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub due_at: Option<DateTime<Utc>>,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub scheduled_end: Option<DateTime<Utc>>,
    #[serde(default)]
    pub status: TaskStatus,
    #[serde(default)]
    pub priority: TaskPriority,
    #[serde(default)]
    pub recurrence: TaskRecurrence,
    #[serde(default)]
    pub labels: Vec<String>,
    pub remind_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateTaskRequest {
    pub project_id: Option<Uuid>,
    pub parent_task_id: Option<Uuid>,
    pub title: String,
    pub description: String,
    pub due_at: Option<DateTime<Utc>>,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub scheduled_end: Option<DateTime<Utc>>,
    pub status: TaskStatus,
    pub priority: TaskPriority,
    #[serde(default)]
    pub recurrence: TaskRecurrence,
    #[serde(default)]
    pub labels: Vec<String>,
    pub remind_at: Option<DateTime<Utc>>,
    pub expected_version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReorderTasksRequest {
    pub task_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TaskPage {
    pub items: Vec<Task>,
    pub next_cursor: Option<Uuid>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PageQuery {
    pub cursor: Option<Uuid>,
    pub limit: Option<i64>,
}

impl PageQuery {
    pub fn normalized_limit(&self) -> i64 {
        self.limit
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE)
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ExpectedVersionQuery {
    pub expected_version: i32,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct TaskListQuery {
    pub project_id: Option<Uuid>,
    pub cursor: Option<Uuid>,
    pub limit: Option<i64>,
}

impl TaskListQuery {
    pub fn normalized_limit(&self) -> i64 {
        self.limit
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE)
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DevelopmentSession {
    pub user_id: Uuid,
}
