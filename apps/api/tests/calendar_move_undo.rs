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
            sqlx::query(&format!("UPDATE {table} SET version=version+1 WHERE id=$1"))
                .bind(id)
                .execute(&pool)
                .await?;
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
