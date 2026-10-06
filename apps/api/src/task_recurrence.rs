use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgConnection, types::Json};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{Task, TaskPriority, TaskRecurrence, TaskStatus, UpdateTaskRequest},
};

#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RecurrenceEditScope {
    ThisOccurrence,
    ThisAndFuture,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScopedTaskUpdateRequest {
    #[serde(flatten)]
    pub task: UpdateTaskRequest,
    pub recurrence_scope: Option<RecurrenceEditScope>,
}

/// Values for the successor of a task that has a one-occurrence exception.
/// Dates remain anchored to the original occurrence, not its postponed deadline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurrenceDefaults {
    title: String,
    description: String,
    due_at: DateTime<Utc>,
    scheduled_start: Option<DateTime<Utc>>,
    scheduled_end: Option<DateTime<Utc>>,
    priority: TaskPriority,
    recurrence: TaskRecurrence,
    labels: Vec<String>,
    remind_at: Option<DateTime<Utc>>,
}

#[derive(FromRow)]
pub(crate) struct RecurringTaskState {
    #[sqlx(flatten)]
    pub task: Task,
    pub recurrence_defaults: Option<Json<RecurrenceDefaults>>,
    pub recurrence_project_id: Option<Uuid>,
}

impl RecurringTaskState {
    pub async fn load(connection: &mut PgConnection, user: Uuid, id: Uuid) -> AppResult<Self> {
        sqlx::query_as("SELECT * FROM tasks WHERE user_id=$1 AND id=$2 FOR UPDATE")
            .bind(user)
            .bind(id)
            .fetch_optional(connection)
            .await?
            .ok_or(AppError::NotFound("task"))
    }

    pub fn prepare(
        &mut self,
        request: &UpdateTaskRequest,
        scope: Option<RecurrenceEditScope>,
    ) -> AppResult<()> {
        if self.task.version != request.expected_version {
            return Err(AppError::Conflict(format!(
                "task changed since version {}; current version is {}",
                request.expected_version, self.task.version
            )));
        }
        if scope.is_some() && self.task.status == TaskStatus::Completed {
            return Err(AppError::Validation(
                "Choose an unfinished task to edit recurring occurrences.".into(),
            ));
        }
        match scope {
            Some(RecurrenceEditScope::ThisOccurrence) => {
                if self.task.recurrence == TaskRecurrence::None
                    || request.recurrence != self.task.recurrence
                {
                    return Err(AppError::Validation(
                        "Choose this and future occurrences to change the repeat rule.".into(),
                    ));
                }
                if self.recurrence_defaults.is_none() {
                    self.recurrence_defaults =
                        Some(Json(RecurrenceDefaults::from_task(&self.task)?));
                    self.recurrence_project_id = self.task.project_id;
                }
            }
            Some(RecurrenceEditScope::ThisAndFuture) => {
                self.recurrence_defaults = None;
                self.recurrence_project_id = None;
            }
            None => {
                // Status updates, provider reconciliation and existing API clients
                // must not discard a previously saved one-occurrence exception.
                // An explicit cadence change retains the legacy forward semantics.
                if request.recurrence != self.task.recurrence
                    || request.recurrence == TaskRecurrence::None
                {
                    self.recurrence_defaults = None;
                    self.recurrence_project_id = None;
                }
            }
        }
        Ok(())
    }

    pub fn successor_source(mut self) -> Task {
        if let Some(Json(defaults)) = self.recurrence_defaults {
            self.task.project_id = self.recurrence_project_id;
            self.task.title = defaults.title;
            self.task.description = defaults.description;
            self.task.due_at = Some(defaults.due_at);
            self.task.scheduled_start = defaults.scheduled_start;
            self.task.scheduled_end = defaults.scheduled_end;
            self.task.priority = defaults.priority;
            self.task.recurrence = defaults.recurrence;
            self.task.labels = defaults.labels;
            self.task.remind_at = defaults.remind_at;
        }
        self.task
    }
}

#[derive(Serialize, FromRow)]
pub(crate) struct RecurrenceTemplateExport {
    task_id: Uuid,
    project_id: Option<Uuid>,
    defaults: Json<RecurrenceDefaults>,
}

impl crate::store::Store {
    pub(crate) async fn recurrence_templates(
        &self,
        user: Uuid,
    ) -> AppResult<Vec<RecurrenceTemplateExport>> {
        Ok(sqlx::query_as("SELECT id AS task_id, recurrence_project_id AS project_id, recurrence_defaults AS defaults FROM tasks WHERE user_id=$1 AND recurrence_defaults IS NOT NULL ORDER BY id")
            .bind(user).fetch_all(&self.pool).await?)
    }
}

impl RecurrenceDefaults {
    fn from_task(task: &Task) -> AppResult<Self> {
        Ok(Self {
            title: task.title.clone(),
            description: task.description.clone(),
            due_at: task.due_at.ok_or_else(|| {
                AppError::Validation("a recurring task must have a deadline".into())
            })?,
            scheduled_start: task.scheduled_start,
            scheduled_end: task.scheduled_end,
            priority: task.priority,
            recurrence: task.recurrence,
            labels: task.labels.clone(),
            remind_at: task.remind_at,
        })
    }
}
