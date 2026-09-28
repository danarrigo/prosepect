use chrono::NaiveDate;
use prosepect_api::{
    error::AppError,
    models::{Task, UpdateDailyFocusRequest},
    store::Store,
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(pool: &PgPool, scheduled: bool) -> anyhow::Result<(Store, Uuid, Task)> {
    let user = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO users(id,email,display_name) VALUES ($1,'delete@example.test','Delete')",
    )
    .bind(user)
    .execute(pool)
    .await?;
    let store = Store::from_pool(pool.clone());
    let mut request = json!({"title":"Private task","description":"Preserve all fields", "labels":["work"], "priority":"high"});
    if scheduled {
        request["scheduled_start"] = json!("2026-09-10T10:00:00Z");
        request["scheduled_end"] = json!("2026-09-10T11:00:00Z");
    }
    let task = store
        .create_task(user, serde_json::from_value(request)?)
        .await?;
    Ok((store, user, task))
}
async fn rows(pool: &PgPool, table: &str, user: Uuid) -> anyhow::Result<Vec<Value>> {
    let query = match table {
        "tasks" => "SELECT to_jsonb(r) FROM tasks r WHERE user_id=$1 ORDER BY to_jsonb(r)::text",
        "calendar_events" => {
            "SELECT to_jsonb(r) FROM calendar_events r WHERE user_id=$1 ORDER BY to_jsonb(r)::text"
        }
        "notes" => "SELECT to_jsonb(r) FROM notes r WHERE user_id=$1 ORDER BY to_jsonb(r)::text",
        "files" => "SELECT to_jsonb(r) FROM files r WHERE user_id=$1 ORDER BY to_jsonb(r)::text",
        "daily_focus_tasks" => {
            "SELECT to_jsonb(r) FROM daily_focus_tasks r WHERE user_id=$1 ORDER BY to_jsonb(r)::text"
        }
        _ => panic!("unknown fixture table"),
    };
    Ok(sqlx::query_scalar(query).bind(user).fetch_all(pool).await?)
}
fn assert_advanced(before: &[Value], after: &[Value]) {
    assert_eq!(before.len(), after.len());
    for original in before {
        let restored = after.iter().find(|r| r["id"] == original["id"]).unwrap();
        assert!(restored["version"].as_i64().unwrap() > original["version"].as_i64().unwrap());
        let mut restored = restored.clone();
        restored["version"] = original["version"].clone();
        restored["updated_at"] = original["updated_at"].clone();
        assert_eq!(&restored, original);
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_atomic_inverse_restores_notes_files_focus_and_lineage(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, true).await?;
    let event: Uuid = sqlx::query_scalar("SELECT id FROM calendar_events WHERE linked_task_id=$1")
        .bind(task.id)
        .fetch_one(&pool)
        .await?;
    let successor = Uuid::now_v7();
    sqlx::query("INSERT INTO tasks(id,user_id,title,recurrence_source_id) VALUES ($1,$2,'Next occurrence',$3)").bind(successor).bind(user).bind(task.id).execute(&pool).await?;
    let mut notes = vec![];
    for (task_link, event_link) in [(Some(task.id), None), (None, Some(event))] {
        let note = Uuid::now_v7();
        notes.push(note);
        sqlx::query("INSERT INTO notes(id,user_id,task_id,event_id,title,markdown) VALUES ($1,$2,$3,$4,'Linked note','Sensitive **markdown**')")
            .bind(note).bind(user).bind(task_link).bind(event_link).execute(&pool).await?;
    }
    for (task_link, event_link, note_link) in [
        (Some(task.id), None, None),
        (None, Some(event), None),
        (None, None, Some(notes[0])),
        (None, None, Some(notes[1])),
    ] {
        let file = Uuid::now_v7();
        sqlx::query("INSERT INTO files(id,user_id,task_id,event_id,note_id,object_key,filename,content_type,byte_size) VALUES ($1,$2,$3,$4,$5,$6,'attachment','text/plain',10)")
            .bind(file).bind(user).bind(task_link).bind(event_link).bind(note_link).bind(file.to_string()).execute(&pool).await?;
    }
    for date in ["2026-09-10", "2026-09-11"] {
        store
            .update_daily_focus(
                user,
                date.parse()?,
                UpdateDailyFocusRequest {
                    task_ids: vec![task.id, successor],
                },
            )
            .await?;
    }
    let tables = [
        "tasks",
        "calendar_events",
        "notes",
        "files",
        "daily_focus_tasks",
    ];
    let mut before = vec![];
    for table in tables {
        before.push(rows(&pool, table, user).await?);
    }
    let receipt = store
        .delete_task_with_undo(user, task.id, task.version)
        .await?;
    assert_eq!(rows(&pool, "tasks", user).await?.len(), 1);
    assert!(rows(&pool, "notes", user).await?.is_empty());
    assert!(rows(&pool, "calendar_events", user).await?.is_empty());
    let detached = rows(&pool, "files", user).await?;
    assert!(
        detached
            .iter()
            .all(|f| f["task_id"].is_null() && f["event_id"].is_null() && f["note_id"].is_null())
    );
    store.undo_task_delete(user, receipt.id, None).await?;
    for (i, table) in tables.iter().enumerate() {
        let after = rows(&pool, table, user).await?;
        if i < 3 {
            assert_advanced(&before[i], &after);
        } else {
            assert_eq!(before[i], after);
        }
    }
    assert!(matches!(
        store.undo_task_delete(user, receipt.id, None).await,
        Err(AppError::NotFound(_))
    ));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_restore_failure_rolls_back_every_insert(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, true).await?;
    sqlx::query("INSERT INTO notes(id,user_id,task_id,title) VALUES ($1,$2,$3,'Fail restore')")
        .bind(Uuid::now_v7())
        .bind(user)
        .bind(task.id)
        .execute(&pool)
        .await?;
    let receipt = store
        .delete_task_with_undo(user, task.id, task.version)
        .await?;
    sqlx::raw_sql("CREATE FUNCTION reject_restored_note() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected restore failure'; END $$; CREATE TRIGGER reject_restored_note BEFORE INSERT ON notes FOR EACH ROW EXECUTE FUNCTION reject_restored_note();").execute(&pool).await?;
    assert!(
        store
            .undo_task_delete(user, receipt.id, None)
            .await
            .is_err()
    );
    for table in ["tasks", "calendar_events", "notes"] {
        assert!(rows(&pool, table, user).await?.is_empty());
    }
    assert_eq!(store.list_task_delete_undos(user).await?.items.len(), 1);
    sqlx::query("DROP TRIGGER reject_restored_note ON notes")
        .execute(&pool)
        .await?;
    store.undo_task_delete(user, receipt.id, None).await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_refuses_parent_stale_owner_expired_and_repeated_requests(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, false).await?;
    let (_, other, _) = fixture(&pool, false).await?;
    assert!(matches!(
        store.delete_task_with_undo(other, task.id, 1).await,
        Err(AppError::NotFound(_))
    ));
    assert!(matches!(
        store.delete_task_with_undo(user, task.id, 2).await,
        Err(AppError::Conflict(_))
    ));
    let child = store
        .create_task(
            user,
            serde_json::from_value(json!({"title":"Child","parent_task_id":task.id}))?,
        )
        .await?;
    assert!(matches!(
        store.delete_task_with_undo(user, task.id, 1).await,
        Err(AppError::Conflict(_))
    ));
    let receipt = store
        .delete_task_with_undo(user, child.id, child.version)
        .await?;
    assert!(store.list_task_delete_undos(other).await?.items.is_empty());
    assert!(matches!(
        store.undo_task_delete(other, receipt.id, None).await,
        Err(AppError::NotFound(_))
    ));
    sqlx::query("UPDATE task_delete_undos SET expires_at=clock_timestamp() WHERE id=$1")
        .bind(receipt.id)
        .execute(&pool)
        .await?;
    assert!(matches!(
        store.undo_task_delete(user, receipt.id, None).await,
        Err(AppError::Conflict(_))
    ));
    assert!(store.list_task_delete_undos(user).await?.items.is_empty());
    assert_eq!(rows(&pool, "tasks", user).await?.len(), 1);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_dependency_changes_fail_closed(pool: PgPool) -> anyhow::Result<()> {
    for change in [
        "project",
        "parent",
        "calendar",
        "file",
        "successor",
        "empty-focus",
    ] {
        let (store, user, task) = fixture(&pool, true).await?;
        let project = Uuid::now_v7();
        let parent = Uuid::now_v7();
        let file = Uuid::now_v7();
        let successor = Uuid::now_v7();
        sqlx::query("INSERT INTO projects(id,user_id,name) VALUES ($1,$2,'Project')")
            .bind(project)
            .bind(user)
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO tasks(id,user_id,project_id,title) VALUES ($1,$2,$3,'Parent')")
            .bind(parent)
            .bind(user)
            .bind(project)
            .execute(&pool)
            .await?;
        sqlx::query("UPDATE tasks SET project_id=$2,parent_task_id=$3 WHERE id=$1")
            .bind(task.id)
            .bind(project)
            .bind(parent)
            .execute(&pool)
            .await?;
        sqlx::query("INSERT INTO tasks(id,user_id,title,recurrence_source_id) VALUES ($1,$2,'Successor',$3)").bind(successor).bind(user).bind(task.id).execute(&pool).await?;
        sqlx::query("INSERT INTO files(id,user_id,task_id,object_key,filename,content_type,byte_size) VALUES ($1,$2,$3,$4,'file','text/plain',0)").bind(file).bind(user).bind(task.id).bind(file.to_string()).execute(&pool).await?;
        let date: NaiveDate = "2026-09-10".parse()?;
        store
            .update_daily_focus(
                user,
                date,
                UpdateDailyFocusRequest {
                    task_ids: vec![task.id],
                },
            )
            .await?;
        let receipt = store.delete_task_with_undo(user, task.id, 1).await?;
        match change {
            "project" => {
                sqlx::query("DELETE FROM projects WHERE id=$1")
                    .bind(project)
                    .execute(&pool)
                    .await?;
            }
            "parent" => {
                sqlx::query("UPDATE tasks SET position=position+1 WHERE id=$1")
                    .bind(parent)
                    .execute(&pool)
                    .await?;
            }
            "calendar" => {
                sqlx::query("DELETE FROM calendars WHERE user_id=$1")
                    .bind(user)
                    .execute(&pool)
                    .await?;
            }
            "file" => {
                sqlx::query("DELETE FROM files WHERE id=$1")
                    .bind(file)
                    .execute(&pool)
                    .await?;
            }
            "successor" => {
                sqlx::query("UPDATE tasks SET title='Changed without version' WHERE id=$1")
                    .bind(successor)
                    .execute(&pool)
                    .await?;
            }
            _ => {
                store
                    .update_daily_focus(user, date, UpdateDailyFocusRequest { task_ids: vec![] })
                    .await?;
            }
        }
        assert!(
            matches!(
                store.undo_task_delete(user, receipt.id, None).await,
                Err(AppError::Conflict(_))
            ),
            "{change}"
        );
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tasks WHERE id=$1)")
            .bind(task.id)
            .fetch_one(&pool)
            .await?;
        assert!(!exists, "{change}");
    }
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_bounded_snapshots_refuse_before_mutation(
    pool: PgPool,
) -> anyhow::Result<()> {
    for (count, length) in [(65, 1), (12, 100_000)] {
        let (store, user, task) = fixture(&pool, false).await?;
        for _ in 0..count {
            sqlx::query(
                "INSERT INTO notes(id,user_id,task_id,title,markdown) VALUES ($1,$2,$3,'Bound',$4)",
            )
            .bind(Uuid::now_v7())
            .bind(user)
            .bind(task.id)
            .bind("a".repeat(length))
            .execute(&pool)
            .await?;
        }
        assert!(matches!(
            store.delete_task_with_undo(user, task.id, 1).await,
            Err(AppError::Validation(_))
        ));
        assert_eq!(rows(&pool, "notes", user).await?.len(), count);
        assert_eq!(rows(&pool, "tasks", user).await?.len(), 1);
        assert!(store.list_task_delete_undos(user).await?.items.is_empty());
    }
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_count_and_owner_byte_limits(pool: PgPool) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, false).await?;
    sqlx::query("INSERT INTO task_delete_undos(id,user_id,task_id,task_title,snapshot,expires_at) SELECT gen_random_uuid(),$1,$2,'capacity','{}',clock_timestamp()+INTERVAL '60 seconds' FROM generate_series(1,100)")
        .bind(user).bind(task.id).execute(&pool).await?;
    assert!(matches!(
        store.delete_task_with_undo(user, task.id, 1).await,
        Err(AppError::Validation(_))
    ));
    sqlx::query("DELETE FROM task_delete_undos WHERE user_id=$1")
        .bind(user)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO task_delete_undos(id,user_id,task_id,task_title,snapshot,expires_at) SELECT gen_random_uuid(),$1,$2,'capacity',jsonb_build_object('padding',repeat('a',1048500)),clock_timestamp()+INTERVAL '60 seconds' FROM generate_series(1,4)")
        .bind(user).bind(task.id).execute(&pool).await?;
    assert!(matches!(
        store.delete_task_with_undo(user, task.id, 1).await,
        Err(AppError::Validation(_))
    ));
    assert_eq!(rows(&pool, "tasks", user).await?.len(), 1);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_locks_fail_promptly_and_single_connection_restores(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, true).await?;
    for key in [format!("prosepect-sync:{user}"), user.to_string()] {
        let mut lock = pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(key)
            .execute(&mut *lock)
            .await?;
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            store.delete_task_with_undo(user, task.id, 1),
        )
        .await?;
        assert!(matches!(result, Err(AppError::Conflict(_))));
        lock.rollback().await?;
    }
    let mut held = pool.begin().await?;
    sqlx::query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE")
        .bind(task.id)
        .execute(&mut *held)
        .await?;
    assert!(matches!(
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            store.delete_task_with_undo(user, task.id, 1)
        )
        .await?,
        Err(AppError::Conflict(_))
    ));
    held.rollback().await?;
    let single = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await?;
    let store = Store::from_pool(single.clone());
    let receipt = store.delete_task_with_undo(user, task.id, 1).await?;
    let (a, b) = tokio::join!(
        store.undo_task_delete(user, receipt.id, None),
        store.undo_task_delete(user, receipt.id, None)
    );
    assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
    single.close().await;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_cleanup_skips_locked_rows_and_account_deletion_cascades(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, false).await?;
    let receipt = store.delete_task_with_undo(user, task.id, 1).await?;
    sqlx::query("UPDATE task_delete_undos SET expires_at=clock_timestamp() WHERE id=$1")
        .bind(receipt.id)
        .execute(&pool)
        .await?;
    let mut held = pool.begin().await?;
    sqlx::query("SELECT id FROM task_delete_undos WHERE id=$1 FOR UPDATE")
        .bind(receipt.id)
        .execute(&mut *held)
        .await?;
    assert_eq!(store.cleanup_task_delete_undos().await?, 0);
    held.rollback().await?;
    assert_eq!(store.cleanup_task_delete_undos().await?, 1);
    let (_, other, task) = fixture(&pool, false).await?;
    store.delete_task_with_undo(other, task.id, 1).await?;
    sqlx::query("DELETE FROM users WHERE id=$1")
        .bind(other)
        .execute(&pool)
        .await?;
    assert!(store.list_task_delete_undos(other).await?.items.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_note_file_plan_and_account_contention_is_bounded(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, false).await?;
    let note = Uuid::now_v7();
    let file = Uuid::now_v7();
    sqlx::query("INSERT INTO notes(id,user_id,task_id,title) VALUES ($1,$2,$3,'Concurrent note')")
        .bind(note)
        .bind(user)
        .bind(task.id)
        .execute(&pool)
        .await?;
    sqlx::query("INSERT INTO files(id,user_id,note_id,object_key,filename,content_type,byte_size) VALUES ($1,$2,$3,$4,'Concurrent file','text/plain',0)").bind(file).bind(user).bind(note).bind(file.to_string()).execute(&pool).await?;
    let date: NaiveDate = "2026-09-10".parse()?;
    store
        .update_daily_focus(
            user,
            date,
            UpdateDailyFocusRequest {
                task_ids: vec![task.id],
            },
        )
        .await?;
    for query in [
        "SELECT id FROM notes WHERE user_id=$1 FOR UPDATE",
        "SELECT id FROM files WHERE user_id=$1 FOR UPDATE",
        "SELECT user_id FROM task_delete_guard_revisions WHERE user_id=$1 FOR UPDATE",
        "SELECT id FROM users WHERE id=$1 FOR UPDATE",
    ] {
        let mut writer = pool.begin().await?;
        sqlx::query(query).bind(user).execute(&mut *writer).await?;
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            store.delete_task_with_undo(user, task.id, 1),
        )
        .await?;
        assert!(matches!(result, Err(AppError::Conflict(_))), "{query}");
        writer.rollback().await?;
        assert_eq!(rows(&pool, "tasks", user).await?.len(), 1);
    }
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_does_not_restore_old_move_receipts(pool: PgPool) -> anyhow::Result<()> {
    let (store, user, task) = fixture(&pool, true).await?;
    let moved=store.move_calendar_item(user,task.id,true,serde_json::from_value(json!({"starts_at":"2026-09-10T12:00:00Z","ends_at":"2026-09-10T13:00:00Z","expected_version":1}))?).await?;
    let deleted = store.delete_task_with_undo(user, task.id, 2).await?;
    store.undo_task_delete(user, deleted.id, None).await?;
    assert!(matches!(
        store.undo_calendar_move(user, moved.id).await,
        Err(AppError::NotFound(_))
    ));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn task_delete_undo_review_completion_guards_disappeared_focus_date(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, task_a) = fixture(&pool, false).await?;
    let task_b = store
        .create_task(user, serde_json::from_value(json!({"title":"Earlier B"}))?)
        .await?;
    for (day, task) in [("2026-09-08", task_b.id), ("2026-09-09", task_a.id)] {
        store
            .update_daily_focus(
                user,
                day.parse()?,
                UpdateDailyFocusRequest {
                    task_ids: vec![task],
                },
            )
            .await?;
    }
    let day = "2026-09-10".parse()?;
    let review = store
        .start_daily_review(user, day, true)
        .await?
        .review
        .unwrap();
    assert_eq!(review.unfinished_tasks[0].id, task_a.id);
    let receipt = store
        .delete_task_with_undo(user, task_a.id, task_a.version)
        .await?;
    let reloaded = store
        .start_daily_review(user, day, true)
        .await?
        .review
        .unwrap();
    assert_eq!(reloaded.unfinished_tasks[0].id, task_b.id);
    store.complete_daily_review(user, day, serde_json::from_value(json!({
        "expected_version":reloaded.version,"decisions":[{"task_id":task_b.id,"action":"remove"}]
    }))?).await?;
    assert!(
        matches!(
            store.undo_task_delete(user, receipt.id, None).await,
            Err(AppError::Conflict(_))
        ),
        "completed review must invalidate Undo even though September 9 disappeared"
    );
    assert_eq!(rows(&pool, "tasks", user).await?.len(), 1);
    Ok(())
}
