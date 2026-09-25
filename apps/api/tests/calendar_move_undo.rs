use chrono::{Duration, TimeZone, Utc};
use prosepect_api::{
    error::AppError,
    models::{
        CalendarEventQuery, CreateCalendarEventRequest, EventRecurrence, MoveCalendarItemRequest,
    },
    store::Store,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn fixture(
    pool: &PgPool,
) -> anyhow::Result<(Store, Uuid, prosepect_api::models::CalendarEvent)> {
    let store = Store::from_pool(pool.clone());
    let user = Uuid::now_v7();
    sqlx::query("INSERT INTO users (id,email,display_name) VALUES ($1,'move@example.com','Move')")
        .bind(user)
        .execute(pool)
        .await?;
    let calendar = store.list_calendars(user).await?.items.remove(0);
    let event = store
        .create_calendar_event(
            user,
            CreateCalendarEventRequest {
                calendar_id: calendar.id,
                title: "Keep my content".into(),
                description: "Unchanged".into(),
                starts_at: Utc.with_ymd_and_hms(2026, 9, 10, 10, 0, 0).unwrap(),
                ends_at: Utc.with_ymd_and_hms(2026, 9, 10, 11, 0, 0).unwrap(),
                all_day: false,
                timezone: "UTC".into(),
                location: "".into(),
                attendees: vec![],
                recurrence: EventRecurrence::None,
                recurrence_until: None,
            },
        )
        .await?;
    Ok((store, user, event))
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_restores_schedule_once_without_reverting_content(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let receipt = store
        .move_calendar_item(
            user,
            event.id,
            false,
            MoveCalendarItemRequest {
                starts_at: event.starts_at + Duration::hours(2),
                ends_at: event.ends_at + Duration::hours(2),
                expected_version: event.version,
            },
        )
        .await?;
    assert_eq!(store.list_calendar_move_undos(user).await?.items.len(), 1);
    store.undo_calendar_move(user, receipt.id).await?;
    let restored = store
        .list_calendar_events(
            user,
            CalendarEventQuery {
                starts_before: event.ends_at + Duration::days(1),
                ends_after: event.starts_at - Duration::days(1),
                calendar_id: None,
            },
        )
        .await?
        .items
        .remove(0);
    assert_eq!(restored.starts_at, event.starts_at);
    assert_eq!(restored.ends_at, event.ends_at);
    assert_eq!(restored.title, event.title);
    assert_eq!(restored.created_at, event.created_at);
    assert_eq!(restored.version, event.version + 2);
    assert!(matches!(
        store.undo_calendar_move(user, receipt.id).await,
        Err(AppError::NotFound(_))
    ));
    Ok(())
}

async fn move_once(
    store: &Store,
    user: Uuid,
    event: &prosepect_api::models::CalendarEvent,
) -> anyhow::Result<prosepect_api::models::CalendarMoveUndo> {
    Ok(store
        .move_calendar_item(
            user,
            event.id,
            false,
            MoveCalendarItemRequest {
                starts_at: event.starts_at + Duration::hours(2),
                ends_at: event.ends_at + Duration::hours(2),
                expected_version: event.version,
            },
        )
        .await?)
}

async fn current_event(
    store: &Store,
    user: Uuid,
    event: &prosepect_api::models::CalendarEvent,
) -> anyhow::Result<prosepect_api::models::CalendarEvent> {
    Ok(store
        .list_calendar_events(
            user,
            CalendarEventQuery {
                starts_before: event.ends_at + Duration::days(1),
                ends_after: event.starts_at - Duration::days(1),
                calendar_id: None,
            },
        )
        .await?
        .items
        .into_iter()
        .find(|item| item.id == event.id)
        .unwrap())
}

async fn add_mapping(
    pool: &PgPool,
    user: Uuid,
    event: &prosepect_api::models::CalendarEvent,
) -> anyhow::Result<Uuid> {
    sqlx::query("UPDATE calendars SET source='google',external_id='primary',access_role='owner' WHERE id=$1")
        .bind(event.calendar_id).execute(pool).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO external_event_mappings (id,user_id,calendar_id,canonical_event_id,external_calendar_id,external_event_id,external_etag) VALUES ($1,$2,$3,$4,'primary','remote-event','etag-before')")
        .bind(id).bind(user).bind(event.calendar_id).bind(event.id).execute(pool).await?;
    Ok(id)
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_is_owner_scoped_and_expiry_is_atomic(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let (_, other, _) = fixture(&pool).await?;
    let receipt = move_once(&store, user, &event).await?;
    assert!(
        store
            .list_calendar_move_undos(other)
            .await?
            .items
            .is_empty()
    );
    assert!(matches!(
        store.undo_calendar_move(other, receipt.id).await,
        Err(AppError::NotFound(_))
    ));
    assert!(matches!(
        store
            .move_calendar_item(
                other,
                event.id,
                false,
                MoveCalendarItemRequest {
                    starts_at: event.starts_at,
                    ends_at: event.ends_at,
                    expected_version: 2,
                }
            )
            .await,
        Err(AppError::NotFound(_))
    ));
    sqlx::query("UPDATE calendar_move_undos SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1")
        .bind(receipt.id).execute(&pool).await?;
    assert!(matches!(
        store.undo_calendar_move(user, receipt.id).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        current_event(&store, user, &event).await?.starts_at,
        event.starts_at + Duration::hours(2)
    );
    assert!(store.list_calendar_move_undos(user).await?.items.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_allows_provider_push_ack_but_not_provider_pull(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let mapping = add_mapping(&pool, user, &event).await?;
    let receipt = move_once(&store, user, &event).await?;
    // The same fields written by push_calendar's successful conditional PUT acknowledgement.
    sqlx::query("UPDATE external_event_mappings SET external_etag='etag-ack',base_fingerprint='ack',local_dirty=FALSE,last_synced_at=NOW() WHERE id=$1")
        .bind(mapping).execute(&pool).await?;
    store.undo_calendar_move(user, receipt.id).await?;
    assert_eq!(
        current_event(&store, user, &event).await?.starts_at,
        event.starts_at
    );
    let event = current_event(&store, user, &event).await?;
    let receipt = move_once(&store, user, &event).await?;
    // Provider apply updates the canonical version; inverse must not overwrite it.
    sqlx::query("UPDATE calendar_events SET version=version+1,starts_at=starts_at+INTERVAL '1 hour',ends_at=ends_at+INTERVAL '1 hour' WHERE id=$1")
        .bind(event.id).execute(&pool).await?;
    assert!(matches!(
        store.undo_calendar_move(user, receipt.id).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(
        current_event(&store, user, &event).await?.starts_at,
        event.starts_at + Duration::hours(3)
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_rejects_mapping_identity_and_conflict_changes(
    pool: PgPool,
) -> anyhow::Result<()> {
    for mutation in [
        "UPDATE external_event_mappings SET conflict_state='unresolved' WHERE id=$1",
        "UPDATE external_event_mappings SET pending_resolution='google' WHERE id=$1",
        "UPDATE external_event_mappings SET canonical_event_id=NULL WHERE id=$1",
        "UPDATE external_event_mappings SET external_event_id='replacement' WHERE id=$1",
        "UPDATE external_event_mappings SET id=gen_random_uuid() WHERE id=$1",
        "UPDATE external_event_mappings SET local_deleted=TRUE WHERE id=$1",
    ] {
        let (store, user, event) = fixture(&pool).await?;
        let mapping = add_mapping(&pool, user, &event).await?;
        let receipt = move_once(&store, user, &event).await?;
        sqlx::query(mutation).bind(mapping).execute(&pool).await?;
        assert!(
            matches!(
                store.undo_calendar_move(user, receipt.id).await,
                Err(AppError::Conflict(_))
            ),
            "{mutation}"
        );
        assert_eq!(current_event(&store, user, &event).await?.version, 2);
    }
    let (store, user, event) = fixture(&pool).await?;
    let receipt = move_once(&store, user, &event).await?;
    add_mapping(&pool, user, &event).await?;
    assert!(matches!(
        store.undo_calendar_move(user, receipt.id).await,
        Err(AppError::Conflict(_))
    ));
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_busy_sync_lock_fails_fast_without_a_second_pool_connection(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let receipt = move_once(&store, user, &event).await?;
    let mut provider = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("prosepect-sync:{user}"))
        .execute(&mut *provider)
        .await?;
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        store.undo_calendar_move(user, receipt.id),
    )
    .await?;
    assert!(matches!(blocked, Err(AppError::Conflict(_))));
    provider.rollback().await?;
    // With all but one connection occupied, the operation must still complete.
    let single_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await?;
    let single_store = Store::from_pool(single_pool.clone());
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        single_store.undo_calendar_move(user, receipt.id),
    )
    .await??;
    single_pool.close().await;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_cap_rejects_before_mutation_and_account_deletion_cascades(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    for index in 0..100 {
        store
            .move_calendar_item(
                user,
                event.id,
                false,
                MoveCalendarItemRequest {
                    starts_at: event.starts_at + Duration::minutes(index + 1),
                    ends_at: event.ends_at + Duration::minutes(index + 1),
                    expected_version: (index + 1) as i32,
                },
            )
            .await?;
    }
    // Older inverses for the same item no longer match its version; only the latest is offered.
    assert_eq!(store.list_calendar_move_undos(user).await?.items.len(), 1);
    let blocked = store
        .move_calendar_item(
            user,
            event.id,
            false,
            MoveCalendarItemRequest {
                starts_at: event.starts_at,
                ends_at: event.ends_at,
                expected_version: 101,
            },
        )
        .await;
    assert!(matches!(
        blocked,
        Err(AppError::InvalidRequest {
            status: axum::http::StatusCode::TOO_MANY_REQUESTS,
            ..
        })
    ));
    assert_eq!(current_event(&store, user, &event).await?.version, 101);
    store.delete_account(user, "DELETE").await?;
    assert!(store.list_calendar_move_undos(user).await?.items.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn scheduled_task_move_undo_guards_both_versions_and_restores_both_schedules(
    pool: PgPool,
) -> anyhow::Result<()> {
    for changed_row in [None, Some("tasks"), Some("calendar_events")] {
        let (store, user, event) = fixture(&pool).await?;
        let task = store.create_task(user,serde_json::from_value(serde_json::json!({
            "title":"Scheduled work", "scheduled_start":event.starts_at,"scheduled_end":event.ends_at
        }))?).await?;
        let receipt = store
            .move_calendar_item(
                user,
                task.id,
                true,
                MoveCalendarItemRequest {
                    starts_at: event.starts_at + Duration::hours(2),
                    ends_at: event.ends_at + Duration::hours(2),
                    expected_version: task.version,
                },
            )
            .await?;
        if let Some(table) = changed_row {
            let id = if table == "tasks" {
                task.id
            } else {
                receipt.event_id
            };
            let query = if table == "tasks" {
                sqlx::query("UPDATE tasks SET version=version+1 WHERE id=$1")
            } else {
                sqlx::query("UPDATE calendar_events SET version=version+1 WHERE id=$1")
            };
            query.bind(id).execute(&pool).await?;
            assert!(matches!(
                store.undo_calendar_move(user, receipt.id).await,
                Err(AppError::Conflict(_))
            ));
        } else {
            store.undo_calendar_move(user, receipt.id).await?;
        }
        let restored = store
            .list_tasks(user, None, None, 100)
            .await?
            .items
            .into_iter()
            .find(|item| item.id == task.id)
            .unwrap();
        let mirror = store
            .list_calendar_events(
                user,
                CalendarEventQuery {
                    starts_before: event.ends_at + Duration::days(1),
                    ends_after: event.starts_at - Duration::days(1),
                    calendar_id: None,
                },
            )
            .await?
            .items
            .into_iter()
            .find(|item| item.id == receipt.event_id)
            .unwrap();
        let expected = if changed_row.is_some() {
            event.starts_at + Duration::hours(2)
        } else {
            event.starts_at
        };
        assert_eq!(restored.scheduled_start, Some(expected));
        assert_eq!(mirror.starts_at, expected);
        assert_eq!(restored.created_at, task.created_at);
        assert_eq!(restored.title, task.title);
    }
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_expires_while_waiting_for_graph_lock(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let receipt = move_once(&store, user, &event).await?;
    let mut blocker = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::TEXT,0))")
        .bind(user.to_string())
        .execute(&mut *blocker)
        .await?;
    let blocker_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await?;
    let waiting = tokio::spawn(async move { store.undo_calendar_move(user, receipt.id).await });
    // Observe the actual graph-lock wait before expiring, not a scheduling delay.
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let blocked: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)))",
            )
            .bind(blocker_pid)
            .fetch_one(&pool)
            .await?;
            if blocked {
                break Ok::<_, sqlx::Error>(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await??;
    // Item locks now fail fast; the graph lock can still wait. Check DB time afterwards.
    sqlx::query("UPDATE calendar_move_undos SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1")
        .bind(receipt.id).execute(&pool).await?;
    blocker.commit().await?;
    assert!(matches!(waiting.await?, Err(AppError::Conflict(_))));
    let store = Store::from_pool(pool);
    assert_eq!(
        current_event(&store, user, &event).await?.version,
        event.version + 1
    );
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_all_day_restores_exact_utc_boundaries(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    sqlx::query("UPDATE calendar_events SET all_day=TRUE,starts_at='2026-09-10T00:00:00Z',ends_at='2026-09-12T00:00:00Z',timezone='America/Los_Angeles' WHERE id=$1")
        .bind(event.id).execute(&pool).await?;
    let event = current_event(&store, user, &event).await?;
    let receipt = store
        .move_calendar_item(
            user,
            event.id,
            false,
            MoveCalendarItemRequest {
                starts_at: event.starts_at + Duration::days(1),
                ends_at: event.ends_at + Duration::days(1),
                expected_version: event.version,
            },
        )
        .await?;
    store.undo_calendar_move(user, receipt.id).await?;
    let restored = current_event(&store, user, &event).await?;
    assert_eq!(restored.starts_at, event.starts_at);
    assert_eq!(restored.ends_at, event.ends_at);
    assert!(restored.all_day);
    assert_eq!(restored.timezone, event.timezone);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_paired_writes_and_receipt_consumption_roll_back_on_failure(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let task = store
        .create_task(
            user,
            serde_json::from_value(serde_json::json!({
                "title":"Scheduled work", "due_at":event.ends_at + Duration::days(1),
                "scheduled_start":event.starts_at,"scheduled_end":event.ends_at
            }))?,
        )
        .await?;
    sqlx::query("CREATE FUNCTION reject_move_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected receipt failure'; END $$")
        .execute(&pool).await?;
    sqlx::query("CREATE TRIGGER reject_receipt BEFORE INSERT ON calendar_move_undos FOR EACH ROW EXECUTE FUNCTION reject_move_receipt()")
        .execute(&pool).await?;
    let request = || MoveCalendarItemRequest {
        starts_at: event.starts_at + Duration::hours(2),
        ends_at: event.ends_at + Duration::hours(2),
        expected_version: task.version,
    };
    assert!(
        store
            .move_calendar_item(user, task.id, true, request())
            .await
            .is_err()
    );
    let (start, version): (Option<chrono::DateTime<Utc>>, i32) =
        sqlx::query_as("SELECT scheduled_start,version FROM tasks WHERE id=$1")
            .bind(task.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!((start, version), (task.scheduled_start, task.version));
    let (start, version): (chrono::DateTime<Utc>, i32) =
        sqlx::query_as("SELECT starts_at,version FROM calendar_events WHERE linked_task_id=$1")
            .bind(task.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!((start, version), (event.starts_at, 1));
    sqlx::query("DROP TRIGGER reject_receipt ON calendar_move_undos")
        .execute(&pool)
        .await?;
    let receipt = store
        .move_calendar_item(user, task.id, true, request())
        .await?;
    sqlx::query("CREATE TRIGGER reject_receipt BEFORE DELETE ON calendar_move_undos FOR EACH ROW EXECUTE FUNCTION reject_move_receipt()")
        .execute(&pool).await?;
    assert!(matches!(
        store.undo_calendar_move(user, receipt.id).await,
        Err(AppError::Database(_))
    ));
    let (start, version, due): (
        Option<chrono::DateTime<Utc>>,
        i32,
        Option<chrono::DateTime<Utc>>,
    ) = sqlx::query_as("SELECT scheduled_start,version,due_at FROM tasks WHERE id=$1")
        .bind(task.id)
        .fetch_one(&pool)
        .await?;
    assert_eq!(
        (start, version, due),
        (
            Some(event.starts_at + Duration::hours(2)),
            task.version + 1,
            task.due_at
        )
    );
    let (start, version): (chrono::DateTime<Utc>, i32) =
        sqlx::query_as("SELECT starts_at,version FROM calendar_events WHERE linked_task_id=$1")
            .bind(task.id)
            .fetch_one(&pool)
            .await?;
    assert_eq!((start, version), (event.starts_at + Duration::hours(2), 2));
    assert_eq!(store.list_calendar_move_undos(user).await?.items.len(), 1);
    sqlx::query("DROP TRIGGER reject_receipt ON calendar_move_undos")
        .execute(&pool)
        .await?;
    store.undo_calendar_move(user, receipt.id).await?;
    Ok(())
}

// Lock schedules below reproduce the first half of ordinary event edit/delete
// transactions directly so the interleaving does not depend on task scheduling.
#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_and_undo_do_not_wait_on_event_first_writer(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let task = store.create_task(user, serde_json::from_value(serde_json::json!({
        "title":"Paired work", "scheduled_start":event.starts_at,"scheduled_end":event.ends_at
    }))?).await?;
    let receipt = store
        .move_calendar_item(
            user,
            task.id,
            true,
            MoveCalendarItemRequest {
                starts_at: event.starts_at + Duration::hours(2),
                ends_at: event.ends_at + Duration::hours(2),
                expected_version: task.version,
            },
        )
        .await?;
    for undo in [false, true] {
        let mut writer = pool.begin().await?;
        // update_calendar_event locks the event before updating its linked task.
        sqlx::query("SELECT id FROM calendar_events WHERE id=$1 FOR UPDATE")
            .bind(receipt.event_id)
            .execute(&mut *writer)
            .await?;
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            if undo {
                store.undo_calendar_move(user, receipt.id).await
            } else {
                store
                    .move_calendar_item(
                        user,
                        task.id,
                        true,
                        MoveCalendarItemRequest {
                            starts_at: event.starts_at + Duration::hours(3),
                            ends_at: event.ends_at + Duration::hours(3),
                            expected_version: task.version + 1,
                        },
                    )
                    .await
                    .map(|_| ())
            }
        })
        .await?;
        assert!(matches!(result, Err(AppError::Conflict(message)) if message.contains("busy")));
        // The failed inverse/move must release its earlier task lock, allowing the
        // event-first writer to continue rather than completing a wait cycle.
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            sqlx::query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE")
                .bind(task.id)
                .execute(&mut *writer),
        )
        .await??;
        writer.rollback().await?;
        let schedule: (chrono::DateTime<Utc>, chrono::DateTime<Utc>, i32, i32) = sqlx::query_as(
            "SELECT t.scheduled_start,e.starts_at,t.version,e.version FROM tasks t JOIN calendar_events e ON e.linked_task_id=t.id WHERE t.id=$1",
        ).bind(task.id).fetch_one(&pool).await?;
        assert_eq!(
            schedule,
            (
                event.starts_at + Duration::hours(2),
                event.starts_at + Duration::hours(2),
                task.version + 1,
                2
            )
        );
        assert_eq!(
            store.list_calendar_move_undos(user).await?.items[0].id,
            receipt.id
        );
    }
    // A lock-busy result did not consume the still-usable inverse.
    store.undo_calendar_move(user, receipt.id).await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_cleanup_does_not_deadlock_event_delete_cascade(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let receipt = move_once(&store, user, &event).await?;
    sqlx::query("UPDATE calendar_move_undos SET expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1")
        .bind(receipt.id).execute(&pool).await?;
    let mut deletion = pool.begin().await?;
    sqlx::query("SELECT id FROM calendar_events WHERE id=$1 FOR UPDATE")
        .bind(event.id)
        .execute(&mut *deletion)
        .await?;
    // Move first cleans the expired receipt, then attempts the already-held event.
    // It must roll back cleanup immediately, not wait for a cascade needing that receipt.
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        store.move_calendar_item(
            user,
            event.id,
            false,
            MoveCalendarItemRequest {
                starts_at: event.starts_at,
                ends_at: event.ends_at,
                expected_version: 2,
            },
        ),
    )
    .await?;
    assert!(matches!(result, Err(AppError::Conflict(message)) if message.contains("busy")));
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        sqlx::query("DELETE FROM calendar_events WHERE id=$1")
            .bind(event.id)
            .execute(&mut *deletion),
    )
    .await??;
    deletion.rollback().await?;
    assert_eq!(current_event(&store, user, &event).await?.version, 2);
    let retained: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM calendar_move_undos WHERE id=$1)")
            .bind(receipt.id)
            .fetch_one(&pool)
            .await?;
    assert!(retained, "failed move must roll back receipt cleanup too");

    // Reverse overlap: the cascade already owns the expired receipt. List/move/
    // consume cleanup must skip it rather than wait on the deleting transaction.
    let mut deletion = pool.begin().await?;
    sqlx::query("DELETE FROM calendar_events WHERE id=$1")
        .bind(event.id)
        .execute(&mut *deletion)
        .await?;
    let other = store
        .create_calendar_event(
            user,
            CreateCalendarEventRequest {
                calendar_id: event.calendar_id,
                title: "Other".into(),
                description: "".into(),
                starts_at: event.starts_at,
                ends_at: event.ends_at,
                all_day: false,
                timezone: "UTC".into(),
                location: "".into(),
                attendees: vec![],
                recurrence: EventRecurrence::None,
                recurrence_until: None,
            },
        )
        .await?;
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        store.list_calendar_move_undos(user),
    )
    .await??;
    let other_receipt = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        move_once(&store, user, &other),
    )
    .await??;
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        store.undo_calendar_move(user, other_receipt.id),
    )
    .await??;
    deletion.rollback().await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn calendar_move_undo_busy_receipt_mapping_and_fk_parents_leave_inverse_intact(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (store, user, event) = fixture(&pool).await?;
    let mapping = add_mapping(&pool, user, &event).await?;
    let receipt = move_once(&store, user, &event).await?;
    for locked_row in ["receipt", "mapping", "owner", "calendar"] {
        let mut blocker = pool.begin().await?;
        let query = match locked_row {
            "mapping" => {
                sqlx::query("SELECT id FROM external_event_mappings WHERE id=$1 FOR UPDATE")
                    .bind(mapping)
            }
            "owner" => sqlx::query("SELECT id FROM users WHERE id=$1 FOR UPDATE").bind(user),
            "calendar" => sqlx::query("SELECT id FROM calendars WHERE id=$1 FOR UPDATE")
                .bind(event.calendar_id),
            _ => sqlx::query("SELECT id FROM calendar_move_undos WHERE id=$1 FOR UPDATE")
                .bind(receipt.id),
        };
        query.execute(&mut *blocker).await?;
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            store.undo_calendar_move(user, receipt.id),
        )
        .await?;
        assert!(matches!(result, Err(AppError::Conflict(message)) if message.contains("busy")));
        blocker.rollback().await?;
        assert_eq!(current_event(&store, user, &event).await?.version, 2);
        assert_eq!(
            store.list_calendar_move_undos(user).await?.items[0].id,
            receipt.id
        );
    }
    store.undo_calendar_move(user, receipt.id).await?;
    Ok(())
}
