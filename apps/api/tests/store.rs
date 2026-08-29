use chrono::{TimeZone, Utc};
use prosepect_api::{
    error::AppError,
    models::{
        CreateProjectRequest, CreateTaskRequest, ProjectStatus, ReorderTasksRequest, TaskPriority,
        TaskRecurrence, TaskStatus, UpdateProjectRequest, UpdateTaskRequest,
    },
    store::Store,
};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../migrations")]
async fn project_and_task_queries_are_tenant_isolated(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let first_user = create_user(&pool, "first@example.com").await?;
    let second_user = create_user(&pool, "second@example.com").await?;

    let first_project = store
        .create_project(first_user, project_request("First project"))
        .await?;
    store
        .create_project(second_user, project_request("Second project"))
        .await?;
    store
        .create_task(first_user, task_request(first_project.id, "Private task"))
        .await?;

    let first_projects = store.list_projects(first_user, None, 50).await?;
    let second_projects = store.list_projects(second_user, None, 50).await?;
    let second_tasks = store.list_tasks(second_user, None, None, 50).await?;

    assert_eq!(first_projects.items.len(), 1);
    assert_eq!(first_projects.items[0].name, "First project");
    assert_eq!(first_projects.items[0].total_tasks, 1);
    assert_eq!(second_projects.items.len(), 1);
    assert_eq!(second_projects.items[0].name, "Second project");
    assert!(second_tasks.items.is_empty());

    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn tasks_can_exist_without_a_project(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "standalone-task@example.com").await?;
    let request = CreateTaskRequest {
        project_id: None,
        parent_task_id: None,
        title: "Standalone task".to_owned(),
        description: String::new(),
        due_at: None,
        scheduled_start: None,
        scheduled_end: None,
        status: TaskStatus::Todo,
        priority: TaskPriority::Medium,
        recurrence: TaskRecurrence::None,
        labels: vec![],
        remind_at: None,
    };

    let task = store.create_task(user_id, request).await?;

    assert_eq!(task.project_id, None);
    assert_eq!(
        store.list_tasks(user_id, None, None, 50).await?.items[0].id,
        task.id
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn deleting_a_project_cascades_its_task_tree(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "delete-project@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Temporary project"))
        .await?;
    let parent = store
        .create_task(user_id, task_request(project.id, "Parent task"))
        .await?;
    let mut child_request = task_request(project.id, "Child task");
    child_request.parent_task_id = Some(parent.id);
    store.create_task(user_id, child_request).await?;

    store
        .delete_project(user_id, project.id, project.version)
        .await?;

    assert!(
        store
            .list_projects(user_id, None, 50)
            .await?
            .items
            .is_empty()
    );
    assert!(
        store
            .list_tasks(user_id, Some(project.id), None, 50)
            .await?
            .items
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn subtask_cycles_and_cross_project_moves_are_rejected(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "tree@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Task tree"))
        .await?;
    let other_project = store
        .create_project(user_id, project_request("Other project"))
        .await?;
    let parent = store
        .create_task(user_id, task_request(project.id, "Parent"))
        .await?;
    let mut child_request = task_request(project.id, "Child");
    child_request.parent_task_id = Some(parent.id);
    let child = store.create_task(user_id, child_request).await?;

    let mut cycle = update_request(&parent, TaskStatus::Todo);
    cycle.parent_task_id = Some(child.id);
    let cycle_error = store
        .update_task(user_id, parent.id, cycle)
        .await
        .expect_err("cycle must fail");
    assert!(matches!(cycle_error, AppError::Validation(_)));

    let mut move_with_child = update_request(&parent, TaskStatus::Todo);
    move_with_child.project_id = Some(other_project.id);
    let move_error = store
        .update_task(user_id, parent.id, move_with_child)
        .await
        .expect_err("moving a parent across projects must fail");
    assert!(matches!(move_error, AppError::Validation(_)));

    let delete_error = store
        .delete_task(user_id, parent.id, parent.version)
        .await
        .expect_err("deleting a parent must not cascade over subtasks");
    assert!(matches!(delete_error, AppError::Conflict(_)));

    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_parent_updates_cannot_create_a_cycle(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "concurrent-tree@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Concurrent tree"))
        .await?;
    let first = store
        .create_task(user_id, task_request(project.id, "First"))
        .await?;
    let second = store
        .create_task(user_id, task_request(project.id, "Second"))
        .await?;

    let mut first_update = update_request(&first, TaskStatus::Todo);
    first_update.parent_task_id = Some(second.id);
    let mut second_update = update_request(&second, TaskStatus::Todo);
    second_update.parent_task_id = Some(first.id);

    let (first_result, second_result) = tokio::join!(
        store.update_task(user_id, first.id, first_update),
        store.update_task(user_id, second.id, second_update),
    );

    assert_ne!(first_result.is_ok(), second_result.is_ok());
    let error = first_result.err().or_else(|| second_result.err());
    assert!(matches!(error, Some(AppError::Validation(_))));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn stale_task_updates_are_rejected(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "owner@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Concurrency"))
        .await?;
    let task = store
        .create_task(user_id, task_request(project.id, "Versioned task"))
        .await?;

    let update = update_request(&task, TaskStatus::InProgress);
    let updated = store.update_task(user_id, task.id, update).await?;
    assert_eq!(updated.version, 2);

    let stale_update = update_request(&task, TaskStatus::Completed);
    let error = store
        .update_task(user_id, task.id, stale_update)
        .await
        .expect_err("stale version must fail");

    assert!(matches!(error, AppError::Conflict(_)));

    let delete_error = store
        .delete_task(user_id, task.id, task.version)
        .await
        .expect_err("stale delete must fail");
    assert!(matches!(delete_error, AppError::Conflict(_)));

    store.delete_task(user_id, task.id, updated.version).await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn projects_can_be_edited_and_archived(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "project-edit@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Initial name"))
        .await?;

    let updated = store
        .update_project(
            user_id,
            project.id,
            UpdateProjectRequest {
                name: "Launch portfolio".to_owned(),
                outcome: "Published and reviewed".to_owned(),
                target_date: None,
                status: ProjectStatus::Archived,
                expected_version: project.version,
            },
        )
        .await?;

    assert_eq!(updated.name, "Launch portfolio");
    assert_eq!(updated.status, ProjectStatus::Archived);
    assert_eq!(updated.version, project.version + 1);

    let stale = store
        .update_project(
            user_id,
            project.id,
            UpdateProjectRequest {
                name: project.name,
                outcome: project.outcome,
                target_date: project.target_date,
                status: ProjectStatus::Active,
                expected_version: project.version,
            },
        )
        .await
        .expect_err("stale project update must fail");
    assert!(matches!(stale, AppError::Conflict(_)));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn recurring_completion_creates_the_next_anchored_task(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "recurrence@example.com").await?;
    let due_at = Utc
        .with_ymd_and_hms(2026, 1, 31, 18, 0, 0)
        .single()
        .expect("valid date");
    let remind_at = Utc
        .with_ymd_and_hms(2026, 1, 31, 17, 0, 0)
        .single()
        .expect("valid date");
    let request = CreateTaskRequest {
        project_id: None,
        parent_task_id: None,
        title: "Monthly review".to_owned(),
        description: "Review the previous month".to_owned(),
        due_at: Some(due_at),
        scheduled_start: None,
        scheduled_end: None,
        status: TaskStatus::Todo,
        priority: TaskPriority::High,
        recurrence: TaskRecurrence::Monthly,
        labels: vec![" Finance ".to_owned(), "finance".to_owned()],
        remind_at: Some(remind_at),
    };
    let task = store.create_task(user_id, request).await?;
    assert_eq!(task.labels, vec!["finance"]);

    let child_error = store
        .create_task(
            user_id,
            CreateTaskRequest {
                project_id: None,
                parent_task_id: Some(task.id),
                title: "Invalid child".to_owned(),
                description: String::new(),
                due_at: None,
                scheduled_start: None,
                scheduled_end: None,
                status: TaskStatus::Todo,
                priority: TaskPriority::Medium,
                recurrence: TaskRecurrence::None,
                labels: vec![],
                remind_at: None,
            },
        )
        .await
        .expect_err("recurring task cannot gain subtasks");
    assert!(matches!(child_error, AppError::Validation(_)));

    let completed = store
        .update_task(
            user_id,
            task.id,
            update_request(&task, TaskStatus::Completed),
        )
        .await?;
    assert_eq!(completed.status, TaskStatus::Completed);

    let tasks = store.list_tasks(user_id, None, None, 50).await?.items;
    assert_eq!(tasks.len(), 2);
    let next = tasks
        .iter()
        .find(|candidate| candidate.id != task.id)
        .expect("next occurrence");
    assert_eq!(
        next.due_at,
        Utc.with_ymd_and_hms(2026, 2, 28, 18, 0, 0).single()
    );
    assert_eq!(
        next.remind_at,
        Utc.with_ymd_and_hms(2026, 2, 28, 17, 0, 0).single()
    );
    assert_eq!(next.status, TaskStatus::Todo);
    assert_eq!(next.recurrence, TaskRecurrence::Monthly);
    assert_eq!(next.labels, vec!["finance"]);

    let reopened = store
        .update_task(
            user_id,
            completed.id,
            update_request(&completed, TaskStatus::Todo),
        )
        .await?;
    assert_eq!(
        store.list_tasks(user_id, None, None, 50).await?.items.len(),
        1,
        "reopening removes the untouched generated occurrence"
    );

    store
        .update_task(
            user_id,
            reopened.id,
            update_request(&reopened, TaskStatus::Completed),
        )
        .await?;
    assert_eq!(
        store.list_tasks(user_id, None, None, 50).await?.items.len(),
        2,
        "recompleting creates exactly one next occurrence"
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn tasks_can_be_reordered_globally(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "reorder@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Ordered work"))
        .await?;
    let first = store
        .create_task(user_id, task_request(project.id, "First"))
        .await?;
    let second = store
        .create_task(user_id, task_request(project.id, "Second"))
        .await?;
    let third = store
        .create_task(user_id, task_request(project.id, "Third"))
        .await?;

    store
        .reorder_tasks(
            user_id,
            ReorderTasksRequest {
                task_ids: vec![third.id, first.id, second.id],
            },
        )
        .await?;

    let mut tasks = store.list_tasks(user_id, None, None, 50).await?.items;
    tasks.sort_by_key(|task| task.position);
    assert_eq!(
        tasks
            .iter()
            .map(|task| task.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Third", "First", "Second"]
    );
    Ok(())
}

async fn create_user(pool: &PgPool, email: &str) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(email)
        .bind(email)
        .execute(pool)
        .await?;
    Ok(id)
}

fn project_request(name: &str) -> CreateProjectRequest {
    CreateProjectRequest {
        name: name.to_owned(),
        outcome: String::new(),
        target_date: None,
        status: ProjectStatus::Active,
    }
}

fn task_request(project_id: Uuid, title: &str) -> CreateTaskRequest {
    CreateTaskRequest {
        project_id: Some(project_id),
        parent_task_id: None,
        title: title.to_owned(),
        description: String::new(),
        due_at: None,
        scheduled_start: None,
        scheduled_end: None,
        status: TaskStatus::Todo,
        priority: TaskPriority::Medium,
        recurrence: TaskRecurrence::None,
        labels: vec![],
        remind_at: None,
    }
}

fn update_request(task: &prosepect_api::models::Task, status: TaskStatus) -> UpdateTaskRequest {
    UpdateTaskRequest {
        project_id: task.project_id,
        parent_task_id: task.parent_task_id,
        title: task.title.clone(),
        description: task.description.clone(),
        due_at: task.due_at,
        scheduled_start: task.scheduled_start,
        scheduled_end: task.scheduled_end,
        status,
        priority: task.priority,
        recurrence: task.recurrence,
        labels: task.labels.clone(),
        remind_at: task.remind_at,
        expected_version: task.version,
    }
}
