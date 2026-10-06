use chrono::{DateTime, Duration, Utc};
use prosepect_api::{
    error::AppError,
    models::{
        CreateTaskRequest, Task, TaskPriority, TaskRecurrence, TaskStatus, UpdateTaskRequest,
    },
    store::Store,
    task_recurrence::RecurrenceEditScope,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(pool: &PgPool) -> anyhow::Result<(Store, Uuid, Task)> {
    let user = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Recurring fixture')")
        .bind(user)
        .bind(format!("{user}@example.test"))
        .execute(pool)
        .await?;
    let project = Uuid::now_v7();
    sqlx::query("INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Original project')")
        .bind(project)
        .bind(user)
        .execute(pool)
        .await?;
    let due: DateTime<Utc> = "2030-01-01T12:00:00Z".parse()?;
    let store = Store::from_pool(pool.clone());
    let task = store
        .create_task(
            user,
            CreateTaskRequest {
                project_id: Some(project),
                parent_task_id: None,
                title: "Original".into(),
                description: "Original description".into(),
                due_at: Some(due),
                scheduled_start: Some(due - Duration::hours(3)),
                scheduled_end: Some(due - Duration::hours(2)),
                status: TaskStatus::Todo,
                priority: TaskPriority::Medium,
                recurrence: TaskRecurrence::Daily,
                labels: vec!["routine".into()],
                remind_at: Some(due - Duration::hours(1)),
            },
        )
        .await?;
    Ok((store, user, task))
}

fn edit(task: &Task) -> UpdateTaskRequest {
    UpdateTaskRequest {
        project_id: task.project_id,
        parent_task_id: task.parent_task_id,
        title: task.title.clone(),
        description: task.description.clone(),
        due_at: task.due_at,
        scheduled_start: task.scheduled_start,
        scheduled_end: task.scheduled_end,
        status: task.status,
        priority: task.priority,
        recurrence: task.recurrence,
        labels: task.labels.clone(),
        remind_at: task.remind_at,
        expected_version: task.version,
    }
}

async fn successor(pool: &PgPool, task: &Task) -> anyhow::Result<Task> {
    Ok(
        sqlx::query_as("SELECT * FROM tasks WHERE recurrence_source_id=$1")
            .bind(task.id)
            .fetch_one(pool)
            .await?,
    )
}

#[sqlx::test(migrations = "../../migrations")]
async fn one_occurrence_preserves_original_future_values_and_schedule(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, original) = fixture(&pool).await?;
    let mut changes = edit(&original);
    changes.title = "Only today".into();
    changes.description = "Exception".into();
    changes.project_id = None;
    changes.priority = TaskPriority::Urgent;
    changes.labels = vec!["exception".into()];
    changes.due_at = original.due_at.map(|date| date + Duration::days(3));
    changes.scheduled_start = None;
    changes.scheduled_end = None;
    changes.remind_at = None;
    let first = store
        .update_task_scoped(
            user,
            original.id,
            changes,
            Some(RecurrenceEditScope::ThisOccurrence),
        )
        .await?;
    let mut changes = edit(&first);
    changes.title = "Still only today".into();
    let first = store
        .update_task_scoped(
            user,
            first.id,
            changes,
            Some(RecurrenceEditScope::ThisOccurrence),
        )
        .await?;
    // Export and delete-Undo preserve the hidden future defaults as well.
    let exported: serde_json::Value = serde_json::from_slice(&store.export_json(user).await?)?;
    assert_eq!(
        exported["recurrence_templates"][0]["defaults"]["title"],
        "Original"
    );
    let receipt = store
        .delete_task_with_undo(user, first.id, first.version)
        .await?;
    store.undo_task_delete(user, receipt.id, None).await?;
    let restored: Task = sqlx::query_as("SELECT * FROM tasks WHERE id=$1")
        .bind(first.id)
        .fetch_one(&pool)
        .await?;
    let mut complete = edit(&restored);
    complete.status = TaskStatus::Completed;
    let completed = store.update_task(user, restored.id, complete).await?;
    let next = successor(&pool, &completed).await?;
    assert_eq!(completed.title, "Still only today");
    assert_eq!(next.title, original.title);
    assert_eq!(next.description, original.description);
    assert_eq!(next.project_id, original.project_id);
    assert_eq!(next.priority, original.priority);
    assert_eq!(next.labels, original.labels);
    assert_eq!(
        next.due_at,
        original.due_at.map(|date| date + Duration::days(1))
    );
    assert_eq!(
        next.scheduled_start,
        original
            .scheduled_start
            .map(|date| date + Duration::days(1))
    );
    assert_eq!(
        next.scheduled_end,
        original.scheduled_end.map(|date| date + Duration::days(1))
    );
    assert_eq!(
        next.remind_at,
        original.remind_at.map(|date| date + Duration::days(1))
    );
    assert_eq!(next.status, TaskStatus::Todo);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn forward_edit_reanchors_future_without_changing_completed_history(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, original) = fixture(&pool).await?;
    let mut complete = edit(&original);
    complete.status = TaskStatus::Completed;
    let completed = store.update_task(user, original.id, complete).await?;
    let active = successor(&pool, &completed).await?;
    let mut once = edit(&active);
    once.title = "Exception".into();
    let active = store
        .update_task_scoped(
            user,
            active.id,
            once,
            Some(RecurrenceEditScope::ThisOccurrence),
        )
        .await?;
    let mut forward = edit(&active);
    forward.title = "New routine".into();
    forward.recurrence = TaskRecurrence::Weekly;
    forward.due_at = active.due_at.map(|date| date + Duration::days(2));
    let active = store
        .update_task_scoped(
            user,
            active.id,
            forward,
            Some(RecurrenceEditScope::ThisAndFuture),
        )
        .await?;
    let mut complete = edit(&active);
    complete.status = TaskStatus::Completed;
    let active = store.update_task(user, active.id, complete).await?;
    let next = successor(&pool, &active).await?;
    assert_eq!(next.title, "New routine");
    assert_eq!(next.recurrence, TaskRecurrence::Weekly);
    assert_eq!(
        next.due_at,
        active.due_at.map(|date| date + Duration::days(7))
    );
    let past: Task = sqlx::query_as("SELECT * FROM tasks WHERE id=$1")
        .bind(completed.id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        serde_json::to_value(past)?,
        serde_json::to_value(&completed)?
    );
    assert!(matches!(
        store
            .update_task_scoped(
                user,
                completed.id,
                edit(&completed),
                Some(RecurrenceEditScope::ThisAndFuture)
            )
            .await,
        Err(AppError::Validation(_))
    ));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn recurring_scopes_validate_rules_versions_ownership_and_release_locks(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, original) = fixture(&pool).await?;
    let (_, other, _) = fixture(&pool).await?;
    assert!(matches!(
        store
            .update_task_scoped(
                other,
                original.id,
                edit(&original),
                Some(RecurrenceEditScope::ThisOccurrence)
            )
            .await,
        Err(AppError::NotFound(_)) | Err(AppError::Validation(_))
    ));
    let mut observer = pool.acquire().await?;
    let mut invalid = edit(&original);
    invalid.recurrence = TaskRecurrence::None;
    assert!(matches!(
        store
            .update_task_scoped(
                user,
                original.id,
                invalid,
                Some(RecurrenceEditScope::ThisOccurrence)
            )
            .await,
        Err(AppError::Validation(_))
    ));
    let unlocked: bool =
        sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1::TEXT,0))")
            .bind(user.to_string())
            .fetch_one(&mut *observer)
            .await?;
    assert!(unlocked);
    drop(observer);
    let active = store
        .update_task_scoped(
            user,
            original.id,
            edit(&original),
            Some(RecurrenceEditScope::ThisOccurrence),
        )
        .await?;
    assert!(matches!(
        store
            .update_task_scoped(
                user,
                original.id,
                edit(&original),
                Some(RecurrenceEditScope::ThisAndFuture)
            )
            .await,
        Err(AppError::Conflict(_))
    ));
    // Removing only the future project leaves this moved occurrence intact,
    // unassigns future tasks, and changes the version for stale-editor protection.
    let mut moved = edit(&active);
    moved.project_id = None;
    let moved = store
        .update_task_scoped(
            user,
            active.id,
            moved,
            Some(RecurrenceEditScope::ThisOccurrence),
        )
        .await?;
    sqlx::query("DELETE FROM projects WHERE id=$1")
        .bind(original.project_id)
        .execute(&pool)
        .await?;
    let latest: Task = sqlx::query_as("SELECT * FROM tasks WHERE id=$1")
        .bind(moved.id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(latest.version, moved.version + 1);
    let mut complete = edit(&latest);
    complete.status = TaskStatus::Completed;
    let completed = store.update_task(user, latest.id, complete).await?;
    assert!(successor(&pool, &completed).await?.project_id.is_none());
    Ok(())
}
