use chrono::{Duration, NaiveDate, TimeZone, Utc};
use prosepect_api::{
    error::AppError,
    google_auth::{GoogleLoginResult, GoogleLoginStart},
    models::{
        CalendarEventQuery, CompleteDailyReviewRequest, CreateCalendarEventRequest,
        CreateNoteRequest, CreateProjectRequest, CreateTaskRequest, EventRecurrence, ProjectStatus,
        ReorderTasksRequest, ReviewDecisionAction, ReviewTaskDecision, SyncConflictPolicy,
        TaskPriority, TaskRecurrence, TaskStatus, ThemePreference, TodoistImportRequest,
        TodoistImportTask, UpdateCalendarEventRequest, UpdateDailyFocusRequest,
        UpdateProjectRequest, UpdateTaskRequest, UpdateUserSettingsRequest,
    },
    store::Store,
};
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrations = "../../migrations")]
async fn oauth_login_records_current_legal_acceptance(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let login = GoogleLoginStart {
        authorization_url: "https://accounts.example/authorize".to_owned(),
        state: "oauth-state".to_owned(),
        nonce: "0123456789abcdef".to_owned(),
        pkce_verifier: "0123456789012345678901234567890123456789012".to_owned(),
    };
    store
        .save_google_login_attempt(&login, None, "login", Some(("2026-09-04", "2026-09-04")))
        .await?;
    let attempt = store.consume_google_login_attempt(&login.state).await?;
    assert_eq!(attempt.terms_version.as_deref(), Some("2026-09-04"));
    assert_eq!(attempt.privacy_version.as_deref(), Some("2026-09-04"));
    assert!(attempt.age_confirmed);

    let user_id = create_user(&pool, "legal-acceptance@example.com").await?;
    store
        .record_legal_acceptance(user_id, "2026-09-04", "2026-09-04", true)
        .await?;
    store
        .record_legal_acceptance(user_id, "2026-09-04", "2026-09-04", true)
        .await?;
    let acceptance_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM legal_acceptances WHERE user_id = $1")
            .bind(user_id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(acceptance_count, 1);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn account_capacity_limits_new_users_without_locking_out_existing_users(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let first = store
        .upsert_google_user(google_login("subject-1", "first@example.com"), Some(1))
        .await?;
    let returning = store
        .upsert_google_user(google_login("subject-1", "first@example.com"), Some(1))
        .await?;
    assert_eq!(returning.id, first.id);

    let blocked = store
        .upsert_google_user(google_login("subject-2", "second@example.com"), Some(1))
        .await;
    assert!(matches!(blocked, Err(AppError::Forbidden(_))));
    let user_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await?;
    assert_eq!(user_count, 1);
    Ok(())
}

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
async fn todoist_import_preserves_projects_tasks_and_nesting(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "todoist-import@example.com").await?;
    let due_at = Utc.with_ymd_and_hms(2026, 9, 15, 16, 0, 0).unwrap();

    let result = store
        .import_todoist_project(
            user_id,
            TodoistImportRequest {
                project_name: "Imported work".to_owned(),
                project_description: "Imported from Todoist".to_owned(),
                tasks: vec![
                    TodoistImportTask {
                        title: "Parent task".to_owned(),
                        description: "Context".to_owned(),
                        due_at: Some(due_at),
                        scheduled_start: None,
                        scheduled_end: None,
                        priority: TaskPriority::Urgent,
                        recurrence: TaskRecurrence::None,
                        labels: vec!["Review".to_owned()],
                        parent_index: None,
                    },
                    TodoistImportTask {
                        title: "Child task".to_owned(),
                        description: String::new(),
                        due_at: None,
                        scheduled_start: None,
                        scheduled_end: None,
                        priority: TaskPriority::Medium,
                        recurrence: TaskRecurrence::None,
                        labels: vec![],
                        parent_index: Some(0),
                    },
                ],
            },
        )
        .await?;

    assert_eq!(result.imported_tasks, 2);
    assert_eq!(result.project.name, "Imported work");
    assert_eq!(result.project.total_tasks, 2);
    let tasks = store
        .list_tasks(user_id, Some(result.project.id), None, 50)
        .await?
        .items;
    let parent = tasks
        .iter()
        .find(|task| task.title == "Parent task")
        .unwrap();
    let child = tasks
        .iter()
        .find(|task| task.title == "Child task")
        .unwrap();
    assert_eq!(parent.due_at, Some(due_at));
    assert_eq!(parent.priority, TaskPriority::Urgent);
    assert_eq!(parent.labels, vec!["review"]);
    assert_eq!(child.parent_task_id, Some(parent.id));

    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn invalid_todoist_import_does_not_create_a_partial_project(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "invalid-todoist-import@example.com").await?;

    let error = store
        .import_todoist_project(
            user_id,
            TodoistImportRequest {
                project_name: "Should roll back".to_owned(),
                project_description: String::new(),
                tasks: vec![TodoistImportTask {
                    title: String::new(),
                    description: String::new(),
                    due_at: None,
                    scheduled_start: None,
                    scheduled_end: None,
                    priority: TaskPriority::Medium,
                    recurrence: TaskRecurrence::None,
                    labels: vec![],
                    parent_index: None,
                }],
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, AppError::Validation(_)));
    assert!(
        store
            .list_projects(user_id, None, 50)
            .await?
            .items
            .is_empty()
    );
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
async fn daily_focus_is_ordered_limited_and_tenant_isolated(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "focus@example.com").await?;
    let other_user = create_user(&pool, "other-focus@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Focus project"))
        .await?;
    let other_project = store
        .create_project(other_user, project_request("Other focus project"))
        .await?;
    let mut tasks = Vec::new();
    for title in ["First", "Second", "Third", "Fourth"] {
        tasks.push(
            store
                .create_task(user_id, task_request(project.id, title))
                .await?,
        );
    }
    let other_task = store
        .create_task(other_user, task_request(other_project.id, "Private"))
        .await?;
    let date = NaiveDate::from_ymd_opt(2026, 8, 29).expect("valid date");

    let plan = store
        .update_daily_focus(
            user_id,
            date,
            UpdateDailyFocusRequest {
                task_ids: vec![tasks[1].id, tasks[0].id, tasks[2].id],
            },
        )
        .await?;
    assert_eq!(
        plan.focus_tasks
            .iter()
            .map(|task| task.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Second", "First", "Third"]
    );
    assert_eq!(store.daily_plan(user_id, date).await?.focus_tasks.len(), 3);

    let too_many = store
        .update_daily_focus(
            user_id,
            date,
            UpdateDailyFocusRequest {
                task_ids: tasks.iter().map(|task| task.id).collect(),
            },
        )
        .await;
    assert!(matches!(too_many, Err(AppError::Validation(_))));

    let cross_tenant = store
        .update_daily_focus(
            user_id,
            date,
            UpdateDailyFocusRequest {
                task_ids: vec![other_task.id],
            },
        )
        .await;
    assert!(matches!(cross_tenant, Err(AppError::Validation(_))));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn daily_review_carries_unfinished_focus_forward(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "review@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Review project"))
        .await?;
    let task = store
        .create_task(user_id, task_request(project.id, "Carry me forward"))
        .await?;
    let yesterday = NaiveDate::from_ymd_opt(2026, 8, 28).unwrap();
    let today = NaiveDate::from_ymd_opt(2026, 8, 29).unwrap();
    store
        .update_daily_focus(
            user_id,
            yesterday,
            UpdateDailyFocusRequest {
                task_ids: vec![task.id],
            },
        )
        .await?;

    let started = store.start_daily_review(user_id, today, false).await?;
    let review = started.review.expect("review should start");
    assert_eq!(review.unfinished_tasks[0].id, task.id);
    let completed = store
        .complete_daily_review(
            user_id,
            today,
            CompleteDailyReviewRequest {
                decisions: vec![ReviewTaskDecision {
                    task_id: task.id,
                    action: ReviewDecisionAction::CarryForward,
                    due_at: None,
                }],
                expected_version: review.version,
            },
        )
        .await?;

    assert!(matches!(
        completed.status,
        prosepect_api::models::DailyReviewStatus::Completed
    ));
    assert_eq!(
        store.daily_plan(user_id, today).await?.focus_tasks[0].id,
        task.id
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_labels_become_reusable_global_labels(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "labels@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Labels project"))
        .await?;
    let mut request = task_request(project.id, "Labeled task");
    request.labels = vec![" Work ".to_owned(), "review".to_owned()];

    store.create_task(user_id, request).await?;

    assert_eq!(
        store.list_labels(user_id).await?.items,
        vec!["review", "work"]
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn scheduling_a_task_maintains_a_distinct_linked_event(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "scheduled-event@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Scheduled project"))
        .await?;
    let starts_at = Utc
        .with_ymd_and_hms(2026, 8, 30, 14, 0, 0)
        .single()
        .unwrap();
    let mut request = task_request(project.id, "Time blocked task");
    request.scheduled_start = Some(starts_at);
    request.scheduled_end = Some(starts_at + Duration::hours(1));

    let task = store.create_task(user_id, request).await?;
    let calendars = store.list_calendars(user_id).await?;
    assert_eq!(calendars.items.len(), 1);
    assert!(calendars.items[0].is_default);
    let range = CalendarEventQuery {
        starts_before: starts_at + Duration::days(1),
        ends_after: starts_at - Duration::days(1),
        calendar_id: None,
    };
    let events = store.list_calendar_events(user_id, range).await?;
    assert_eq!(events.items.len(), 1);
    assert_eq!(events.items[0].linked_task_id, Some(task.id));
    assert_eq!(events.items[0].title, task.title);

    let completed = store
        .update_task(
            user_id,
            task.id,
            update_request(&task, TaskStatus::Completed),
        )
        .await?;
    let completed_event_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM calendar_events WHERE linked_task_id = $1")
            .bind(task.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(completed_event_count, 1);

    let mut update = update_request(&completed, TaskStatus::Completed);
    update.scheduled_start = None;
    update.scheduled_end = None;
    store.update_task(user_id, task.id, update).await?;
    let remaining = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM calendar_events WHERE linked_task_id = $1",
    )
    .bind(task.id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining, 0);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn read_only_google_events_cannot_be_moved_or_deleted(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "readonly-calendar@example.com").await?;
    let native_calendar_id = store.list_calendars(user_id).await?.items[0].id;
    let google_calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected, access_role
        ) VALUES ($1, $2, 'Read only', '#4285f4', 'google', 'readonly', TRUE, 'reader')
        "#,
    )
    .bind(google_calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;
    let starts_at = Utc.with_ymd_and_hms(2026, 9, 2, 9, 0, 0).single().unwrap();
    let event_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendar_events (
            id, user_id, calendar_id, title, starts_at, ends_at, timezone
        ) VALUES ($1, $2, $3, 'Provider event', $4, $5, 'UTC')
        "#,
    )
    .bind(event_id)
    .bind(user_id)
    .bind(google_calendar_id)
    .bind(starts_at)
    .bind(starts_at + Duration::hours(1))
    .execute(&pool)
    .await?;

    let update_error = store
        .update_calendar_event(
            user_id,
            event_id,
            UpdateCalendarEventRequest {
                calendar_id: native_calendar_id,
                title: "Moved event".to_owned(),
                description: String::new(),
                starts_at,
                ends_at: starts_at + Duration::hours(1),
                all_day: false,
                timezone: "UTC".to_owned(),
                location: String::new(),
                attendees: Vec::new(),
                recurrence: EventRecurrence::None,
                recurrence_until: None,
                expected_version: 1,
            },
        )
        .await
        .expect_err("read-only event move must fail");
    assert!(matches!(update_error, AppError::Forbidden(_)));
    let delete_error = store
        .delete_calendar_event(user_id, event_id, 1)
        .await
        .expect_err("read-only event deletion must fail");
    assert!(matches!(delete_error, AppError::Forbidden(_)));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn scheduled_tasks_use_the_primary_writable_google_calendar(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "google-time-block@example.com").await?;
    let calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected,
            provider_primary, access_role
        ) VALUES ($1, $2, 'Primary', '#4285f4', 'google', $3, TRUE, TRUE, 'owner')
        "#,
    )
    .bind(calendar_id)
    .bind(user_id)
    .bind("google-time-block@example.com")
    .execute(&pool)
    .await?;
    let project = store
        .create_project(user_id, project_request("Google time blocks"))
        .await?;
    let starts_at = Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).single().unwrap();
    let mut request = task_request(project.id, "Mirrored task");
    request.scheduled_start = Some(starts_at);
    request.scheduled_end = Some(starts_at + Duration::hours(1));

    let task = store.create_task(user_id, request).await?;
    let linked_calendar: Uuid =
        sqlx::query_scalar("SELECT calendar_id FROM calendar_events WHERE linked_task_id = $1")
            .bind(task.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!(linked_calendar, calendar_id);
    let jobs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_jobs WHERE user_id = $1 AND calendar_id = $2 AND kind = 'calendar_sync'",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(jobs, 1);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn markdown_notes_are_linked_and_globally_searchable(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "notes@example.com").await?;
    let other_user = create_user(&pool, "other-notes@example.com").await?;
    let project = store
        .create_project(user_id, project_request("Launch portfolio"))
        .await?;
    let note = store
        .create_note(
            user_id,
            CreateNoteRequest {
                project_id: Some(project.id),
                task_id: None,
                event_id: None,
                title: "Release checklist".to_owned(),
                markdown: "Verify the **portfolio launch**.".to_owned(),
            },
        )
        .await?;

    assert_eq!(store.list_notes(user_id).await?.items[0].id, note.id);
    let results = store.global_search(user_id, "portfolio", 20).await?;
    assert!(results.items.iter().any(|result| result.id == project.id));
    assert!(results.items.iter().any(|result| result.id == note.id));
    assert!(
        store
            .global_search(other_user, "portfolio", 20)
            .await?
            .items
            .is_empty()
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

#[sqlx::test(migrations = "../../migrations")]
async fn settings_use_optimistic_concurrency(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "settings@example.com").await?;
    let settings = store.user_settings(user_id).await?;
    assert_eq!(settings.theme, ThemePreference::System);
    assert!(settings.sidebar_visible);

    let updated = store
        .update_user_settings(
            user_id,
            UpdateUserSettingsRequest {
                theme: ThemePreference::Dark,
                automatic_daily_review: false,
                sync_conflict_policy: SyncConflictPolicy::Latest,
                sidebar_visible: false,
                expected_version: settings.version,
            },
        )
        .await?;
    assert_eq!(updated.theme, ThemePreference::Dark);
    assert!(!updated.automatic_daily_review);
    assert!(!updated.sidebar_visible);

    let stale = store
        .update_user_settings(
            user_id,
            UpdateUserSettingsRequest {
                theme: ThemePreference::Light,
                automatic_daily_review: true,
                sync_conflict_policy: SyncConflictPolicy::Ask,
                sidebar_visible: true,
                expected_version: settings.version,
            },
        )
        .await;
    assert!(matches!(stale, Err(AppError::Conflict(_))));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn synchronization_jobs_are_idempotent_tenant_scoped_and_leased(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let first_user = create_user(&pool, "sync-first@example.com").await?;
    let second_user = create_user(&pool, "sync-second@example.com").await?;

    let first = store
        .enqueue_sync(first_user, None, "calendar_discovery", "same-key")
        .await?;
    let duplicate = store
        .enqueue_sync(first_user, None, "calendar_discovery", "same-key")
        .await?;
    let other_tenant = store
        .enqueue_sync(second_user, None, "calendar_discovery", "same-key")
        .await?;
    assert_eq!(first.id, duplicate.id);
    assert_ne!(first.id, other_tenant.id);

    let claimed = store.claim_sync_job().await?.expect("claimable job");
    assert_eq!(claimed.attempt_count, 0);
    let claimed_again = store.claim_sync_job().await?.expect("other tenant job");
    assert_ne!(claimed.id, claimed_again.id);
    assert!(store.claim_sync_job().await?.is_none());
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn activity_history_is_ordered_and_tenant_scoped(pool: PgPool) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let first_user = create_user(&pool, "activity-first@example.com").await?;
    let second_user = create_user(&pool, "activity-second@example.com").await?;

    store
        .record_activity(first_user, "sync_started", "First private activity")
        .await?;
    store
        .record_activity(second_user, "sync_started", "Other tenant activity")
        .await?;
    store
        .record_activity(first_user, "sync_finished", "Most recent activity")
        .await?;

    let activity = store.activity_for_user(first_user).await?;
    assert_eq!(activity.items.len(), 2);
    assert_eq!(activity.items[0].kind, "sync_finished");
    assert_eq!(activity.items[0].message, "Most recent activity");
    assert!(
        activity
            .items
            .iter()
            .all(|entry| entry.message != "Other tenant activity")
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn google_calendar_mutations_enqueue_sync_and_mark_mappings_dirty(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "calendar-sync@example.com").await?;
    let calendar_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (
            id, user_id, name, color, source, external_id, selected, access_role
        ) VALUES ($1, $2, 'Google', '#4285f4', 'google', 'remote-calendar', TRUE, 'writer')
        "#,
    )
    .bind(calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;
    let starts_at = Utc.with_ymd_and_hms(2026, 9, 1, 9, 0, 0).unwrap();
    let event = store
        .create_calendar_event(
            user_id,
            CreateCalendarEventRequest {
                calendar_id,
                title: "Planning".to_owned(),
                description: String::new(),
                starts_at,
                ends_at: starts_at + Duration::hours(1),
                all_day: false,
                timezone: "UTC".to_owned(),
                location: String::new(),
                attendees: vec![],
                recurrence: EventRecurrence::None,
                recurrence_until: None,
            },
        )
        .await?;
    let queued: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_jobs WHERE user_id = $1 AND calendar_id = $2",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(queued, 1);

    sqlx::query(
        r#"
        INSERT INTO external_event_mappings (
            id, user_id, calendar_id, canonical_event_id, external_calendar_id,
            external_event_id, external_etag
        ) VALUES ($1, $2, $3, $4, 'remote-calendar', 'remote-event', 'etag-1')
        "#,
    )
    .bind(Uuid::now_v7())
    .bind(user_id)
    .bind(calendar_id)
    .bind(event.id)
    .execute(&pool)
    .await?;
    store
        .update_calendar_event(
            user_id,
            event.id,
            UpdateCalendarEventRequest {
                calendar_id,
                title: "Updated planning".to_owned(),
                description: event.description,
                starts_at: event.starts_at,
                ends_at: event.ends_at,
                all_day: event.all_day,
                timezone: event.timezone,
                location: event.location,
                attendees: event.attendees,
                recurrence: event.recurrence,
                recurrence_until: event.recurrence_until,
                expected_version: event.version,
            },
        )
        .await?;
    let dirty: bool = sqlx::query_scalar(
        "SELECT local_dirty FROM external_event_mappings WHERE canonical_event_id = $1",
    )
    .bind(event.id)
    .fetch_one(&pool)
    .await?;
    assert!(dirty);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn conflict_resolution_updates_mapping_and_enqueues_atomically(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let user_id = create_user(&pool, "conflict-resolution@example.com").await?;
    let calendar_id = Uuid::now_v7();
    let mapping_id = Uuid::now_v7();
    let conflict_id = Uuid::now_v7();
    sqlx::query(
        r#"
        INSERT INTO calendars (id, user_id, name, color, source, external_id, selected)
        VALUES ($1, $2, 'Google', '#4285f4', 'google', 'remote-calendar', TRUE)
        "#,
    )
    .bind(calendar_id)
    .bind(user_id)
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO external_event_mappings (
            id, user_id, calendar_id, external_calendar_id, external_event_id,
            external_etag, local_dirty, conflict_state
        ) VALUES ($1, $2, $3, 'remote-calendar', 'remote-event', 'etag-1', TRUE, 'unresolved')
        "#,
    )
    .bind(mapping_id)
    .bind(user_id)
    .bind(calendar_id)
    .execute(&pool)
    .await?;
    sqlx::query(
        r#"
        INSERT INTO sync_conflicts (id, user_id, mapping_id, title)
        VALUES ($1, $2, $3, 'Conflicted event')
        "#,
    )
    .bind(conflict_id)
    .bind(user_id)
    .bind(mapping_id)
    .execute(&pool)
    .await?;

    let resolved = store
        .resolve_sync_conflict(user_id, conflict_id, "google")
        .await?;
    assert_eq!(resolved.status, "resolved");
    assert_eq!(resolved.resolution.as_deref(), Some("google"));
    let mapping: (String, bool, bool, Option<String>, Option<String>) = sqlx::query_as(
        r#"
        SELECT conflict_state, local_dirty, local_deleted, external_etag, pending_resolution
        FROM external_event_mappings WHERE id = $1
        "#,
    )
    .bind(mapping_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        mapping,
        (
            "none".to_owned(),
            false,
            false,
            None,
            Some("google".to_owned())
        )
    );
    let jobs: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sync_jobs WHERE user_id = $1 AND calendar_id = $2 AND kind = 'calendar_sync'",
    )
    .bind(user_id)
    .bind(calendar_id)
    .fetch_one(&pool)
    .await?;
    assert_eq!(jobs, 1);
    Ok(())
}

fn google_login(subject: &str, email: &str) -> GoogleLoginResult {
    GoogleLoginResult {
        subject: subject.to_owned(),
        email: email.to_owned(),
        display_name: "Test User".to_owned(),
        avatar_url: None,
        encrypted_access_token: vec![1, 2, 3],
        encrypted_refresh_token: None,
        access_token_expires_at: None,
        scopes: vec!["openid".to_owned(), "email".to_owned()],
    }
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
