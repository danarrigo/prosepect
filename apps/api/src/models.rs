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

/// Personal usage only; service-wide storage usage is never exposed.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FileUsage {
    pub used_bytes: i64,
    pub max_user_storage_bytes: i64,
    pub max_file_size_bytes: usize,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct FileRecord {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub note_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub filename: String,
    pub content_type: String,
    pub byte_size: i64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct FileList {
    pub items: Vec<FileRecord>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct FileListQuery {
    pub project_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub note_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct Note {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub title: String,
    pub markdown: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateNoteRequest {
    pub project_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub title: String,
    #[serde(default)]
    pub markdown: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateNoteRequest {
    pub project_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub event_id: Option<Uuid>,
    pub title: String,
    pub markdown: String,
    pub expected_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct NoteList {
    pub items: Vec<Note>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum SearchResultKind {
    Task,
    Project,
    Note,
    Event,
}

#[derive(Debug, Serialize, ToSchema, FromRow)]
pub struct SearchResult {
    pub kind: SearchResultKind,
    pub id: Uuid,
    pub title: String,
    pub excerpt: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SearchResultList {
    pub items: Vec<SearchResult>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SearchQuery {
    pub q: String,
    pub limit: Option<i64>,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum CalendarSource {
    #[default]
    Native,
    Google,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum EventRecurrence {
    #[default]
    None,
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct GoogleIntegrationStatus {
    pub connected: bool,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub latest_synchronization: Option<Synchronization>,
    pub pending_synchronization_count: i64,
    pub failed_synchronization_count: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct Synchronization {
    pub id: Uuid,
    pub calendar_id: Option<Uuid>,
    pub kind: String,
    pub status: String,
    pub attempt_count: i32,
    pub available_at: DateTime<Utc>,
    pub last_error: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateSynchronizationRequest {
    pub calendar_id: Option<Uuid>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct SyncConflict {
    pub id: Uuid,
    pub canonical_event_id: Option<Uuid>,
    pub title: String,
    pub status: String,
    pub resolution: Option<String>,
    pub created_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SyncConflictList {
    pub items: Vec<SyncConflict>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResolveSyncConflictRequest {
    pub resolution: String,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct ActivityEntry {
    pub kind: String,
    pub message: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ActivityList {
    pub items: Vec<ActivityEntry>,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct Calendar {
    pub id: Uuid,
    pub name: String,
    pub color: String,
    pub source: CalendarSource,
    pub external_id: Option<String>,
    pub selected: bool,
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCalendarRequest {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCalendarRequest {
    pub name: String,
    pub color: String,
    pub selected: bool,
    pub expected_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CalendarList {
    pub items: Vec<Calendar>,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct CalendarEvent {
    pub id: Uuid,
    pub calendar_id: Uuid,
    pub linked_task_id: Option<Uuid>,
    pub title: String,
    pub description: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub all_day: bool,
    pub timezone: String,
    pub location: String,
    pub attendees: Vec<String>,
    pub recurrence: EventRecurrence,
    pub recurrence_until: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateCalendarEventRequest {
    pub calendar_id: Uuid,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    #[serde(default)]
    pub all_day: bool,
    pub timezone: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub attendees: Vec<String>,
    #[serde(default)]
    pub recurrence: EventRecurrence,
    pub recurrence_until: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateCalendarEventRequest {
    pub calendar_id: Uuid,
    pub title: String,
    pub description: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
    pub all_day: bool,
    pub timezone: String,
    pub location: String,
    pub attendees: Vec<String>,
    pub recurrence: EventRecurrence,
    pub recurrence_until: Option<DateTime<Utc>>,
    pub expected_version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CalendarEventList {
    pub items: Vec<CalendarEvent>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CalendarEventQuery {
    pub starts_before: DateTime<Utc>,
    pub ends_after: DateTime<Utc>,
    pub calendar_id: Option<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DailyPlan {
    pub date: NaiveDate,
    pub focus_tasks: Vec<Task>,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum DailyReviewStatus {
    #[default]
    Open,
    Completed,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DailyReview {
    pub id: Uuid,
    pub review_date: NaiveDate,
    pub status: DailyReviewStatus,
    pub unfinished_tasks: Vec<Task>,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub version: i32,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct DailyReviewResponse {
    pub review: Option<DailyReview>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecisionAction {
    #[default]
    CarryForward,
    Reschedule,
    Remove,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReviewTaskDecision {
    pub task_id: Uuid,
    pub action: ReviewDecisionAction,
    pub due_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct CompleteDailyReviewRequest {
    pub decisions: Vec<ReviewTaskDecision>,
    pub expected_version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct StartDailyReviewRequest {
    #[serde(default)]
    pub manual: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateDailyFocusRequest {
    pub task_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LabelList {
    pub items: Vec<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GoogleLoginQuery {
    pub terms_version: String,
    pub privacy_version: String,
    pub age_confirmed: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GoogleCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, ToSchema,
)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum SyncConflictPolicy {
    #[default]
    Ask,
    Latest,
    Google,
    Prosepect,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct UserSettings {
    pub theme: ThemePreference,
    pub automatic_daily_review: bool,
    pub sync_conflict_policy: SyncConflictPolicy,
    pub sidebar_visible: bool,
    pub updated_at: DateTime<Utc>,
    pub version: i32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct UpdateUserSettingsRequest {
    pub theme: ThemePreference,
    pub automatic_daily_review: bool,
    pub sync_conflict_policy: SyncConflictPolicy,
    pub sidebar_visible: bool,
    pub expected_version: i32,
}

#[derive(Debug, Clone, Serialize, ToSchema, FromRow)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub timezone: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionResponse {
    pub user: UserProfile,
    pub csrf_token: String,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TodoistImportTask {
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub due_at: Option<DateTime<Utc>>,
    pub scheduled_start: Option<DateTime<Utc>>,
    pub scheduled_end: Option<DateTime<Utc>>,
    #[serde(default)]
    pub priority: TaskPriority,
    #[serde(default)]
    pub recurrence: TaskRecurrence,
    #[serde(default)]
    pub labels: Vec<String>,
    pub parent_index: Option<usize>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct TodoistImportRequest {
    pub project_name: String,
    #[serde(default)]
    pub project_description: String,
    pub tasks: Vec<TodoistImportTask>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct TodoistImportResult {
    pub project: Project,
    pub imported_tasks: usize,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DeleteAccountRequest {
    pub confirmation: String,
}
