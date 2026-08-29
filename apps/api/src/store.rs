use std::collections::HashSet;

use chrono::{Months, TimeDelta, Utc};
use sqlx::{PgConnection, PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

use crate::{
    config::Config,
    error::{AppError, AppResult},
    models::{
        CreateProjectRequest, CreateTaskRequest, DevelopmentSession, Project, ProjectPage,
        ReorderTasksRequest, Task, TaskPage, TaskRecurrence, TaskStatus, UpdateProjectRequest,
        UpdateTaskRequest,
    },
};

pub const DEVELOPMENT_USER_ID: Uuid = Uuid::from_u128(0x00000000_0000_4000_8000_000000000001);

#[derive(Clone)]
pub struct Store {
    pool: PgPool,
}

impl Store {
    pub async fn connect(config: &Config) -> anyhow::Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(config.database_max_connections)
            .connect(&config.database_url)
            .await?;

        sqlx::migrate!("../../migrations").run(&pool).await?;

        Ok(Self { pool })
    }

    pub fn from_pool(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn ready(&self) -> AppResult<()> {
        sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn ensure_development_user(&self) -> AppResult<DevelopmentSession> {
        let session = sqlx::query_as::<_, DevelopmentSessionRow>(
            r#"
            INSERT INTO users (id, email, display_name)
            VALUES ($1, $1::TEXT || '@development.invalid', '')
            ON CONFLICT (id) DO UPDATE
            SET
                email = EXCLUDED.email,
                display_name = EXCLUDED.display_name,
                updated_at = NOW()
            RETURNING id
            "#,
        )
        .bind(DEVELOPMENT_USER_ID)
        .fetch_one(&self.pool)
        .await?;

        Ok(session.into())
    }

    pub async fn create_project(
        &self,
        user_id: Uuid,
        request: CreateProjectRequest,
    ) -> AppResult<Project> {
        let name = request.name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err(AppError::Validation(
                "project name must contain between 1 and 120 characters".to_owned(),
            ));
        }
        if request.outcome.chars().count() > 2_000 {
            return Err(AppError::Validation(
                "project outcome cannot exceed 2000 characters".to_owned(),
            ));
        }

        let project = sqlx::query_as::<_, Project>(
            r#"
            INSERT INTO projects (id, user_id, name, outcome, target_date, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING
                id,
                name,
                outcome,
                target_date,
                status,
                0::BIGINT AS total_tasks,
                0::BIGINT AS completed_tasks,
                created_at,
                updated_at,
                version
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(name)
        .bind(request.outcome.trim())
        .bind(request.target_date)
        .bind(request.status)
        .fetch_one(&self.pool)
        .await?;

        Ok(project)
    }

    pub async fn update_project(
        &self,
        user_id: Uuid,
        project_id: Uuid,
        request: UpdateProjectRequest,
    ) -> AppResult<Project> {
        validate_project_fields(&request.name, &request.outcome)?;
        if request.expected_version < 1 {
            return Err(AppError::Validation(
                "expected_version must be greater than zero".to_owned(),
            ));
        }

        let project = sqlx::query_as::<_, Project>(
            r#"
            WITH updated AS (
                UPDATE projects
                SET
                    name = $3,
                    outcome = $4,
                    target_date = $5,
                    status = $6,
                    updated_at = NOW(),
                    version = version + 1
                WHERE id = $1 AND user_id = $2 AND version = $7
                RETURNING *
            )
            SELECT
                updated.id,
                updated.name,
                updated.outcome,
                updated.target_date,
                updated.status,
                COUNT(tasks.id)::BIGINT AS total_tasks,
                COUNT(tasks.id) FILTER (WHERE tasks.status = 'completed')::BIGINT AS completed_tasks,
                updated.created_at,
                updated.updated_at,
                updated.version
            FROM updated
            LEFT JOIN tasks ON tasks.project_id = updated.id AND tasks.user_id = $2
            GROUP BY
                updated.id,
                updated.name,
                updated.outcome,
                updated.target_date,
                updated.status,
                updated.created_at,
                updated.updated_at,
                updated.version
            "#,
        )
        .bind(project_id)
        .bind(user_id)
        .bind(request.name.trim())
        .bind(request.outcome.trim())
        .bind(request.target_date)
        .bind(request.status)
        .bind(request.expected_version)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(project) = project {
            return Ok(project);
        }

        let current_version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM projects WHERE id = $1 AND user_id = $2",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        match current_version {
            Some(version) => Err(AppError::Conflict(format!(
                "project changed since version {}; current version is {version}",
                request.expected_version
            ))),
            None => Err(AppError::NotFound("project")),
        }
    }

    pub async fn list_projects(
        &self,
        user_id: Uuid,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> AppResult<ProjectPage> {
        let mut projects = sqlx::query_as::<_, Project>(
            r#"
            SELECT
                p.id,
                p.name,
                p.outcome,
                p.target_date,
                p.status,
                COUNT(t.id)::BIGINT AS total_tasks,
                COUNT(t.id) FILTER (WHERE t.status = 'completed')::BIGINT AS completed_tasks,
                p.created_at,
                p.updated_at,
                p.version
            FROM projects p
            LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
            WHERE p.user_id = $1 AND ($2::UUID IS NULL OR p.id < $2)
            GROUP BY p.id
            ORDER BY p.id DESC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(&self.pool)
        .await?;

        let next_cursor = if projects.len() > limit as usize {
            projects.pop();
            projects.last().map(|project| project.id)
        } else {
            None
        };

        Ok(ProjectPage {
            items: projects,
            next_cursor,
        })
    }

    pub async fn delete_project(
        &self,
        user_id: Uuid,
        project_id: Uuid,
        expected_version: i32,
    ) -> AppResult<()> {
        if expected_version < 1 {
            return Err(AppError::Validation(
                "expected_version must be greater than zero".to_owned(),
            ));
        }

        let mut transaction = self.pool.begin().await?;
        Self::lock_task_graph(&mut transaction, user_id).await?;
        let result =
            sqlx::query("DELETE FROM projects WHERE id = $1 AND user_id = $2 AND version = $3")
                .bind(project_id)
                .bind(user_id)
                .bind(expected_version)
                .execute(&mut *transaction)
                .await?;

        if result.rows_affected() == 1 {
            transaction.commit().await?;
            return Ok(());
        }

        let current_version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM projects WHERE id = $1 AND user_id = $2",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;

        match current_version {
            Some(version) => Err(AppError::Conflict(format!(
                "project changed since version {expected_version}; current version is {version}"
            ))),
            None => Err(AppError::NotFound("project")),
        }
    }

    pub async fn create_task(&self, user_id: Uuid, request: CreateTaskRequest) -> AppResult<Task> {
        validate_task_fields(
            &request.title,
            &request.description,
            request.due_at,
            request.scheduled_start,
            request.scheduled_end,
            request.recurrence,
            request.parent_task_id,
        )?;
        let labels = validate_labels(request.labels)?;
        if request.recurrence != TaskRecurrence::None && request.status == TaskStatus::Completed {
            return Err(AppError::Validation(
                "a recurring task cannot be created as completed".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        Self::lock_task_graph(&mut transaction, user_id).await?;
        self.validate_task_relationships(
            &mut transaction,
            user_id,
            request.project_id,
            request.parent_task_id,
        )
        .await?;

        let position = Self::next_task_position(&mut transaction, user_id).await?;
        let completed_at = (request.status == TaskStatus::Completed).then(Utc::now);
        let remind_at = request.remind_at;
        let task = sqlx::query_as::<_, Task>(
            r#"
            INSERT INTO tasks (
                id,
                user_id,
                project_id,
                parent_task_id,
                title,
                description,
                due_at,
                scheduled_start,
                scheduled_end,
                status,
                priority,
                recurrence,
                labels,
                remind_at,
                position,
                completed_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16
            )
            RETURNING
                id,
                project_id,
                parent_task_id,
                title,
                description,
                due_at,
                scheduled_start,
                scheduled_end,
                status,
                priority,
                recurrence,
                labels,
                remind_at,
                position,
                completed_at,
                created_at,
                updated_at,
                version
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(request.project_id)
        .bind(request.parent_task_id)
        .bind(request.title.trim())
        .bind(request.description.trim())
        .bind(request.due_at)
        .bind(request.scheduled_start)
        .bind(request.scheduled_end)
        .bind(request.status)
        .bind(request.priority)
        .bind(request.recurrence)
        .bind(labels)
        .bind(remind_at)
        .bind(position)
        .bind(completed_at)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;

        Ok(task)
    }

    pub async fn list_tasks(
        &self,
        user_id: Uuid,
        project_id: Option<Uuid>,
        cursor: Option<Uuid>,
        limit: i64,
    ) -> AppResult<TaskPage> {
        let mut tasks = sqlx::query_as::<_, Task>(
            r#"
            SELECT
                id,
                project_id,
                parent_task_id,
                title,
                description,
                due_at,
                scheduled_start,
                scheduled_end,
                status,
                priority,
                recurrence,
                labels,
                remind_at,
                position,
                completed_at,
                created_at,
                updated_at,
                version
            FROM tasks
            WHERE
                user_id = $1
                AND ($2::UUID IS NULL OR project_id = $2)
                AND ($3::UUID IS NULL OR id < $3)
            ORDER BY id DESC
            LIMIT $4
            "#,
        )
        .bind(user_id)
        .bind(project_id)
        .bind(cursor)
        .bind(limit + 1)
        .fetch_all(&self.pool)
        .await?;

        let next_cursor = if tasks.len() > limit as usize {
            tasks.pop();
            tasks.last().map(|task| task.id)
        } else {
            None
        };

        Ok(TaskPage {
            items: tasks,
            next_cursor,
        })
    }

    pub async fn update_task(
        &self,
        user_id: Uuid,
        task_id: Uuid,
        request: UpdateTaskRequest,
    ) -> AppResult<Task> {
        validate_task_fields(
            &request.title,
            &request.description,
            request.due_at,
            request.scheduled_start,
            request.scheduled_end,
            request.recurrence,
            request.parent_task_id,
        )?;
        let labels = validate_labels(request.labels)?;
        if request.expected_version < 1 {
            return Err(AppError::Validation(
                "expected_version must be greater than zero".to_owned(),
            ));
        }
        if request.parent_task_id == Some(task_id) {
            return Err(AppError::Validation(
                "a task cannot be its own parent".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        Self::lock_task_graph(&mut transaction, user_id).await?;
        self.validate_task_relationships(
            &mut transaction,
            user_id,
            request.project_id,
            request.parent_task_id,
        )
        .await?;
        self.validate_task_update_relationships(
            &mut transaction,
            user_id,
            task_id,
            request.project_id,
            request.parent_task_id,
            request.recurrence,
        )
        .await?;

        let previous_status = sqlx::query_scalar::<_, TaskStatus>(
            "SELECT status FROM tasks WHERE id = $1 AND user_id = $2",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AppError::NotFound("task"))?;
        if previous_status == TaskStatus::Completed && request.status != TaskStatus::Completed {
            Self::remove_next_occurrence_for_reopen(&mut transaction, user_id, task_id).await?;
        }
        let completed_at = (request.status == TaskStatus::Completed).then(Utc::now);
        let remind_at = request.remind_at;
        let task = sqlx::query_as::<_, Task>(
            r#"
            UPDATE tasks
            SET
                project_id = $3,
                parent_task_id = $4,
                title = $5,
                description = $6,
                due_at = $7,
                scheduled_start = $8,
                scheduled_end = $9,
                status = $10,
                priority = $11,
                recurrence = $12,
                labels = $13,
                remind_at = $14,
                completed_at = CASE
                    WHEN $10 = 'completed' AND completed_at IS NOT NULL THEN completed_at
                    ELSE $15
                END,
                updated_at = NOW(),
                version = version + 1
            WHERE id = $1 AND user_id = $2 AND version = $16
            RETURNING
                id,
                project_id,
                parent_task_id,
                title,
                description,
                due_at,
                scheduled_start,
                scheduled_end,
                status,
                priority,
                recurrence,
                labels,
                remind_at,
                position,
                completed_at,
                created_at,
                updated_at,
                version
            "#,
        )
        .bind(task_id)
        .bind(user_id)
        .bind(request.project_id)
        .bind(request.parent_task_id)
        .bind(request.title.trim())
        .bind(request.description.trim())
        .bind(request.due_at)
        .bind(request.scheduled_start)
        .bind(request.scheduled_end)
        .bind(request.status)
        .bind(request.priority)
        .bind(request.recurrence)
        .bind(labels)
        .bind(remind_at)
        .bind(completed_at)
        .bind(request.expected_version)
        .fetch_optional(&mut *transaction)
        .await?;

        if let Some(task) = task {
            if previous_status != TaskStatus::Completed
                && task.status == TaskStatus::Completed
                && task.recurrence != TaskRecurrence::None
            {
                Self::create_next_recurring_task(&mut transaction, user_id, &task).await?;
            }
            transaction.commit().await?;
            return Ok(task);
        }

        let current_version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM tasks WHERE id = $1 AND user_id = $2",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;

        match current_version {
            Some(version) => Err(AppError::Conflict(format!(
                "task changed since version {}; current version is {version}",
                request.expected_version
            ))),
            None => Err(AppError::NotFound("task")),
        }
    }

    pub async fn reorder_tasks(
        &self,
        user_id: Uuid,
        request: ReorderTasksRequest,
    ) -> AppResult<()> {
        let unique_ids: HashSet<_> = request.task_ids.iter().copied().collect();
        if unique_ids.len() != request.task_ids.len() {
            return Err(AppError::Validation(
                "task_ids cannot contain duplicates".to_owned(),
            ));
        }

        let mut transaction = self.pool.begin().await?;
        Self::lock_task_graph(&mut transaction, user_id).await?;
        let task_count =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM tasks WHERE user_id = $1")
                .bind(user_id)
                .fetch_one(&mut *transaction)
                .await?;
        if task_count != request.task_ids.len() as i64 {
            return Err(AppError::Validation(
                "task_ids must contain every task in the workspace".to_owned(),
            ));
        }

        let owned_count = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tasks WHERE user_id = $1 AND id = ANY($2)",
        )
        .bind(user_id)
        .bind(&request.task_ids)
        .fetch_one(&mut *transaction)
        .await?;
        if owned_count != task_count {
            return Err(AppError::Validation(
                "task_ids must reference only the user's tasks".to_owned(),
            ));
        }

        for (index, task_id) in request.task_ids.iter().enumerate() {
            sqlx::query("UPDATE tasks SET position = $3 WHERE id = $1 AND user_id = $2")
                .bind(task_id)
                .bind(user_id)
                .bind((index as i64 + 1) * 1024)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn delete_task(
        &self,
        user_id: Uuid,
        task_id: Uuid,
        expected_version: i32,
    ) -> AppResult<()> {
        if expected_version < 1 {
            return Err(AppError::Validation(
                "expected_version must be greater than zero".to_owned(),
            ));
        }

        let mut transaction = self.pool.begin().await?;
        Self::lock_task_graph(&mut transaction, user_id).await?;
        let has_subtasks = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_task_id = $1 AND user_id = $2)",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if has_subtasks {
            return Err(AppError::Conflict(
                "task cannot be deleted while it has subtasks".to_owned(),
            ));
        }

        let result =
            sqlx::query("DELETE FROM tasks WHERE id = $1 AND user_id = $2 AND version = $3")
                .bind(task_id)
                .bind(user_id)
                .bind(expected_version)
                .execute(&mut *transaction)
                .await?;

        if result.rows_affected() == 1 {
            transaction.commit().await?;
            return Ok(());
        }

        let current_version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM tasks WHERE id = $1 AND user_id = $2",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_optional(&mut *transaction)
        .await?;

        match current_version {
            Some(version) => Err(AppError::Conflict(format!(
                "task changed since version {expected_version}; current version is {version}"
            ))),
            None => Err(AppError::NotFound("task")),
        }
    }

    async fn next_task_position(connection: &mut PgConnection, user_id: Uuid) -> AppResult<i64> {
        let position = sqlx::query_scalar::<_, i64>(
            "SELECT COALESCE(MAX(position), 0) + 1024 FROM tasks WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(connection)
        .await?;
        Ok(position)
    }

    async fn remove_next_occurrence_for_reopen(
        connection: &mut PgConnection,
        user_id: Uuid,
        task_id: Uuid,
    ) -> AppResult<()> {
        let next = sqlx::query_as::<_, (Uuid, TaskStatus, i32)>(
            "SELECT id, status, version FROM tasks WHERE recurrence_source_id = $1 AND user_id = $2",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?;

        match next {
            Some((next_id, TaskStatus::Todo, 1)) => {
                sqlx::query("DELETE FROM tasks WHERE id = $1 AND user_id = $2")
                    .bind(next_id)
                    .bind(user_id)
                    .execute(connection)
                    .await?;
            }
            Some(_) => {
                return Err(AppError::Conflict(
                    "task cannot be reopened after its next occurrence was changed".to_owned(),
                ));
            }
            None => {}
        }
        Ok(())
    }

    async fn create_next_recurring_task(
        connection: &mut PgConnection,
        user_id: Uuid,
        task: &Task,
    ) -> AppResult<()> {
        let due_at = task.due_at.ok_or_else(|| {
            AppError::Validation("a recurring task must have a deadline".to_owned())
        })?;
        let next_due_at = next_recurrence_date(due_at, task.recurrence)?;
        let shift = next_due_at - due_at;
        let position = Self::next_task_position(connection, user_id).await?;

        sqlx::query(
            r#"
            INSERT INTO tasks (
                id,
                user_id,
                project_id,
                parent_task_id,
                recurrence_source_id,
                title,
                description,
                due_at,
                scheduled_start,
                scheduled_end,
                status,
                priority,
                recurrence,
                labels,
                remind_at,
                position,
                completed_at
            )
            VALUES (
                $1, $2, $3, NULL, $4, $5, $6, $7, $8,
                $9, 'todo', $10, $11, $12, $13, $14, NULL
            )
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(task.project_id)
        .bind(task.id)
        .bind(&task.title)
        .bind(&task.description)
        .bind(next_due_at)
        .bind(task.scheduled_start.map(|value| value + shift))
        .bind(task.scheduled_end.map(|value| value + shift))
        .bind(task.priority)
        .bind(task.recurrence)
        .bind(&task.labels)
        .bind(task.remind_at.map(|value| value + shift))
        .bind(position)
        .execute(connection)
        .await?;
        Ok(())
    }

    async fn lock_task_graph(connection: &mut PgConnection, user_id: Uuid) -> AppResult<()> {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::TEXT, 0))")
            .bind(user_id.to_string())
            .execute(connection)
            .await?;
        Ok(())
    }

    async fn validate_task_update_relationships(
        &self,
        connection: &mut PgConnection,
        user_id: Uuid,
        task_id: Uuid,
        project_id: Option<Uuid>,
        parent_task_id: Option<Uuid>,
        recurrence: TaskRecurrence,
    ) -> AppResult<()> {
        let current_project = sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT project_id FROM tasks WHERE id = $1 AND user_id = $2",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?
        .ok_or(AppError::NotFound("task"))?;

        let has_subtasks = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE parent_task_id = $1 AND user_id = $2)",
        )
        .bind(task_id)
        .bind(user_id)
        .fetch_one(&mut *connection)
        .await?;

        if recurrence != TaskRecurrence::None && has_subtasks {
            return Err(AppError::Validation(
                "a task with subtasks cannot recur".to_owned(),
            ));
        }

        if current_project != project_id && has_subtasks {
            return Err(AppError::Validation(
                "a task with subtasks cannot change its project assignment".to_owned(),
            ));
        }

        if let Some(parent_task_id) = parent_task_id {
            let creates_cycle = sqlx::query_scalar::<_, bool>(
                r#"
                WITH RECURSIVE parent_chain AS (
                    SELECT id, parent_task_id
                    FROM tasks
                    WHERE id = $1 AND user_id = $2
                    UNION
                    SELECT task.id, task.parent_task_id
                    FROM tasks task
                    JOIN parent_chain parent ON task.id = parent.parent_task_id
                    WHERE task.user_id = $2
                )
                SELECT EXISTS(SELECT 1 FROM parent_chain WHERE id = $3)
                "#,
            )
            .bind(parent_task_id)
            .bind(user_id)
            .bind(task_id)
            .fetch_one(&mut *connection)
            .await?;

            if creates_cycle {
                return Err(AppError::Validation(
                    "parent_task_id would create a subtask cycle".to_owned(),
                ));
            }
        }

        Ok(())
    }

    async fn validate_task_relationships(
        &self,
        connection: &mut PgConnection,
        user_id: Uuid,
        project_id: Option<Uuid>,
        parent_task_id: Option<Uuid>,
    ) -> AppResult<()> {
        if let Some(project_id) = project_id {
            let project_exists = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND user_id = $2)",
            )
            .bind(project_id)
            .bind(user_id)
            .fetch_one(&mut *connection)
            .await?;

            if !project_exists {
                return Err(AppError::Validation(
                    "project_id must reference one of the user's projects".to_owned(),
                ));
            }
        }

        if let Some(parent_task_id) = parent_task_id {
            let parent = sqlx::query_as::<_, (Option<Uuid>, TaskRecurrence)>(
                "SELECT project_id, recurrence FROM tasks WHERE id = $1 AND user_id = $2",
            )
            .bind(parent_task_id)
            .bind(user_id)
            .fetch_optional(&mut *connection)
            .await?;

            match parent {
                Some((parent_project, _)) if parent_project != project_id => {
                    return Err(AppError::Validation(
                        "parent task must belong to the same project".to_owned(),
                    ));
                }
                Some((_, recurrence)) if recurrence != TaskRecurrence::None => {
                    return Err(AppError::Validation(
                        "a recurring task cannot have subtasks".to_owned(),
                    ));
                }
                Some(_) => {}
                None => {
                    return Err(AppError::Validation(
                        "parent_task_id must reference one of the user's tasks".to_owned(),
                    ));
                }
            }
        }

        Ok(())
    }
}

#[derive(sqlx::FromRow)]
struct DevelopmentSessionRow {
    id: Uuid,
}

impl From<DevelopmentSessionRow> for DevelopmentSession {
    fn from(value: DevelopmentSessionRow) -> Self {
        Self { user_id: value.id }
    }
}

fn validate_project_fields(name: &str, outcome: &str) -> AppResult<()> {
    if name.trim().is_empty() || name.trim().chars().count() > 120 {
        return Err(AppError::Validation(
            "project name must contain between 1 and 120 characters".to_owned(),
        ));
    }
    if outcome.chars().count() > 2_000 {
        return Err(AppError::Validation(
            "project outcome cannot exceed 2000 characters".to_owned(),
        ));
    }
    Ok(())
}

fn validate_task_fields(
    title: &str,
    description: &str,
    due_at: Option<chrono::DateTime<Utc>>,
    scheduled_start: Option<chrono::DateTime<Utc>>,
    scheduled_end: Option<chrono::DateTime<Utc>>,
    recurrence: TaskRecurrence,
    parent_task_id: Option<Uuid>,
) -> AppResult<()> {
    if title.trim().is_empty() || title.trim().chars().count() > 240 {
        return Err(AppError::Validation(
            "task title must contain between 1 and 240 characters".to_owned(),
        ));
    }
    if description.chars().count() > 10_000 {
        return Err(AppError::Validation(
            "task description cannot exceed 10000 characters".to_owned(),
        ));
    }
    if recurrence != TaskRecurrence::None && due_at.is_none() {
        return Err(AppError::Validation(
            "a recurring task must have a deadline".to_owned(),
        ));
    }
    if recurrence != TaskRecurrence::None && parent_task_id.is_some() {
        return Err(AppError::Validation("a subtask cannot recur".to_owned()));
    }

    match (scheduled_start, scheduled_end) {
        (None, None) => {}
        (Some(start), Some(end)) if end > start => {}
        (Some(_), Some(_)) => {
            return Err(AppError::Validation(
                "scheduled_end must be after scheduled_start".to_owned(),
            ));
        }
        _ => {
            return Err(AppError::Validation(
                "scheduled_start and scheduled_end must be provided together".to_owned(),
            ));
        }
    }

    Ok(())
}

fn validate_labels(labels: Vec<String>) -> AppResult<Vec<String>> {
    let mut normalized_labels = Vec::new();
    let mut seen = HashSet::new();
    for label in labels {
        let label = label.trim().to_lowercase();
        if label.is_empty() {
            continue;
        }
        if label.chars().count() > 32 {
            return Err(AppError::Validation(
                "task labels cannot exceed 32 characters".to_owned(),
            ));
        }
        if seen.insert(label.clone()) {
            normalized_labels.push(label);
        }
    }
    if normalized_labels.len() > 10 {
        return Err(AppError::Validation(
            "a task cannot have more than 10 labels".to_owned(),
        ));
    }

    Ok(normalized_labels)
}

fn next_recurrence_date(
    due_at: chrono::DateTime<Utc>,
    recurrence: TaskRecurrence,
) -> AppResult<chrono::DateTime<Utc>> {
    let next = match recurrence {
        TaskRecurrence::None => None,
        TaskRecurrence::Daily => due_at.checked_add_signed(TimeDelta::days(1)),
        TaskRecurrence::Weekly => due_at.checked_add_signed(TimeDelta::weeks(1)),
        TaskRecurrence::Monthly => due_at.checked_add_months(Months::new(1)),
        TaskRecurrence::Yearly => due_at.checked_add_months(Months::new(12)),
    };
    next.ok_or_else(|| AppError::Validation("recurrence date is out of range".to_owned()))
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use crate::models::TaskRecurrence;

    use super::validate_task_fields;

    #[test]
    fn rejects_incomplete_schedule() {
        let error = validate_task_fields(
            "Write tests",
            "",
            None,
            Some(Utc::now()),
            None,
            TaskRecurrence::None,
            None,
        )
        .expect_err("incomplete schedule must fail");

        assert_eq!(
            error.to_string(),
            "scheduled_start and scheduled_end must be provided together"
        );
    }

    #[test]
    fn accepts_ordered_schedule() {
        let start = Utc::now();
        let end = start + Duration::hours(1);

        validate_task_fields(
            "Write tests",
            "",
            None,
            Some(start),
            Some(end),
            TaskRecurrence::None,
            None,
        )
        .expect("ordered schedule should be valid");
    }
}
