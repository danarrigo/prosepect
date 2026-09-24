use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{CalendarEvent, CalendarMoveUndo, CalendarMoveUndoList, MoveCalendarItemRequest},
    store::Store,
};

#[derive(FromRow)]
struct TaskSchedule {
    id: Uuid,
    scheduled_start: Option<DateTime<Utc>>,
    scheduled_end: Option<DateTime<Utc>>,
    version: i32,
}

#[derive(FromRow)]
struct InverseSchedule {
    event_id: Uuid,
    task_id: Option<Uuid>,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    task_starts_at: Option<DateTime<Utc>>,
    task_ends_at: Option<DateTime<Utc>>,
    event_version: i32,
    task_version: Option<i32>,
    mapping_guard: Value,
}

impl Store {
    pub async fn list_calendar_move_undos(&self, user_id: Uuid) -> AppResult<CalendarMoveUndoList> {
        let mut transaction = self.pool.begin().await?;
        cleanup(&mut transaction, user_id).await?;
        let items = sqlx::query_as::<_, CalendarMoveUndo>(
            "SELECT u.id,u.event_id,u.task_id,u.expires_at FROM calendar_move_undos u JOIN calendar_events e ON e.id=u.event_id AND e.user_id=u.user_id LEFT JOIN tasks t ON t.id=u.task_id AND t.user_id=u.user_id WHERE u.user_id=$1 AND u.expires_at > clock_timestamp() AND e.version=u.event_version AND t.version IS NOT DISTINCT FROM u.task_version ORDER BY u.expires_at DESC,u.id DESC LIMIT 100",
        ).bind(user_id).fetch_all(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(CalendarMoveUndoList { items })
    }

    pub async fn move_calendar_item(
        &self,
        user_id: Uuid,
        item_id: Uuid,
        is_task: bool,
        request: MoveCalendarItemRequest,
    ) -> AppResult<CalendarMoveUndo> {
        if request.expected_version < 1 || request.ends_at <= request.starts_at {
            return Err(AppError::Validation(
                "a move needs a positive version and an end after its start".into(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        lock_move(&mut transaction, user_id).await?;
        cleanup(&mut transaction, user_id).await?;
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM calendar_move_undos WHERE user_id=$1")
                .bind(user_id)
                .fetch_one(&mut *transaction)
                .await?;
        if count >= 100 {
            return Err(AppError::InvalidRequest {
                status: axum::http::StatusCode::TOO_MANY_REQUESTS,
                message:
                    "Too many recent calendar moves. Wait for Undo to expire before moving again."
                        .into(),
            });
        }
        let event_id = if is_task {
            sqlx::query_scalar(
                "SELECT id FROM calendar_events WHERE user_id=$1 AND linked_task_id=$2",
            )
            .bind(user_id)
            .bind(item_id)
            .fetch_optional(&mut *transaction)
            .await?
            .ok_or(AppError::NotFound("scheduled task"))?
        } else {
            item_id
        };
        let (event, task) = lock_item(&mut transaction, user_id, event_id).await?;
        let version = if is_task {
            task.as_ref().map(|task| task.version)
        } else {
            Some(event.version)
        };
        if version != Some(request.expected_version) {
            return Err(changed());
        }
        if event.starts_at == request.starts_at && event.ends_at == request.ends_at {
            return Err(AppError::Validation("calendar item has not moved".into()));
        }
        if event
            .recurrence_until
            .is_some_and(|until| until <= request.starts_at)
        {
            return Err(AppError::Validation(
                "recurrence_until must be after the event start".into(),
            ));
        }
        Self::ensure_calendar_writable(&mut transaction, user_id, event.calendar_id).await?;
        let guard = mapping_guard(&mut transaction, user_id, event_id).await?;
        let updated = write_schedule(
            &mut transaction,
            user_id,
            event_id,
            request.starts_at,
            request.ends_at,
            task.as_ref()
                .map(|task| (task.id, Some(request.starts_at), Some(request.ends_at))),
        )
        .await?;
        Self::mark_event_for_sync(&mut transaction, user_id, &updated, false).await?;
        let receipt = sqlx::query_as::<_, CalendarMoveUndo>(
            r#"INSERT INTO calendar_move_undos
                (id,user_id,event_id,task_id,starts_at,ends_at,task_starts_at,task_ends_at,event_version,task_version,mapping_guard,expires_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()+INTERVAL '60 seconds')
                RETURNING id,event_id,task_id,expires_at"#,
        ).bind(Uuid::new_v4()).bind(user_id).bind(event_id).bind(event.linked_task_id)
            .bind(event.starts_at).bind(event.ends_at)
            .bind(task.as_ref().and_then(|task| task.scheduled_start))
            .bind(task.as_ref().and_then(|task| task.scheduled_end))
            .bind(updated.version).bind(task.as_ref().map(|task| task.version+1)).bind(guard)
            .fetch_one(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(receipt)
    }

    pub async fn undo_calendar_move(&self, user_id: Uuid, receipt_id: Uuid) -> AppResult<()> {
        let mut transaction = self.pool.begin().await?;
        lock_move(&mut transaction, user_id).await?;
        // Read without locking the receipt first: cascaded task/event deletion locks those rows first.
        let inverse = sqlx::query_as::<_, InverseSchedule>(
            "SELECT event_id,task_id,starts_at,ends_at,task_starts_at,task_ends_at,event_version,task_version,mapping_guard FROM calendar_move_undos WHERE id=$1 AND user_id=$2",
        ).bind(receipt_id).bind(user_id).fetch_optional(&mut *transaction).await?
            .ok_or(AppError::NotFound("calendar move Undo"))?;
        let (event, task) = lock_item(&mut transaction, user_id, inverse.event_id).await?;
        // clock_timestamp(), not transaction NOW(): lock waits must not extend the window.
        let active: Option<bool> = sqlx::query_scalar(
            "SELECT expires_at > clock_timestamp() FROM calendar_move_undos WHERE id=$1 AND user_id=$2 FOR UPDATE",
        ).bind(receipt_id).bind(user_id).fetch_optional(&mut *transaction).await?;
        match active {
            Some(true) => {}
            Some(false) => {
                return Err(AppError::Conflict(
                    "Undo expired. Calendar moves can be undone for 60 seconds.".into(),
                ));
            }
            None => return Err(AppError::NotFound("calendar move Undo")),
        }
        if event.version != inverse.event_version
            || event.linked_task_id != inverse.task_id
            || task.as_ref().map(|task| task.version) != inverse.task_version
        {
            return Err(changed());
        }
        Self::ensure_calendar_writable(&mut transaction, user_id, event.calendar_id).await?;
        if mapping_guard(&mut transaction, user_id, event.id).await? != inverse.mapping_guard {
            return Err(changed());
        }
        let restored = write_schedule(
            &mut transaction,
            user_id,
            event.id,
            inverse.starts_at,
            inverse.ends_at,
            inverse
                .task_id
                .map(|id| (id, inverse.task_starts_at, inverse.task_ends_at)),
        )
        .await?;
        Self::mark_event_for_sync(&mut transaction, user_id, &restored, false).await?;
        let consumed = sqlx::query("DELETE FROM calendar_move_undos WHERE user_id=$1 AND id=$2 AND expires_at > clock_timestamp()")
            .bind(user_id)
            .bind(receipt_id)
            .execute(&mut *transaction)
            .await?;
        if consumed.rows_affected() != 1 {
            return Err(AppError::Conflict(
                "Undo expired. Calendar moves can be undone for 60 seconds.".into(),
            ));
        }
        cleanup(&mut transaction, user_id).await?;
        transaction.commit().await?;
        Ok(())
    }
}

fn changed() -> AppError {
    AppError::Conflict("Calendar item changed. Refresh before trying another move; Undo cannot overwrite a later change.".into())
}

async fn lock_move(connection: &mut PgConnection, user_id: Uuid) -> AppResult<()> {
    // Same connection throughout. Never wait for provider HTTP or acquire a second pool connection.
    let available: bool =
        sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("prosepect-sync:{user_id}"))
            .fetch_one(&mut *connection)
            .await?;
    if !available {
        return Err(AppError::Conflict(
            "Calendar synchronization is in progress. Try again shortly.".into(),
        ));
    }
    Store::lock_task_graph(connection, user_id).await
}

async fn cleanup(connection: &mut PgConnection, user_id: Uuid) -> AppResult<()> {
    sqlx::query("DELETE FROM calendar_move_undos WHERE user_id=$1 AND id IN (SELECT id FROM calendar_move_undos WHERE user_id=$1 AND expires_at <= clock_timestamp() ORDER BY expires_at LIMIT 100)")
        .bind(user_id).execute(connection).await?;
    Ok(())
}

async fn lock_item(
    connection: &mut PgConnection,
    user_id: Uuid,
    event_id: Uuid,
) -> AppResult<(CalendarEvent, Option<TaskSchedule>)> {
    let task_id: Option<Uuid> =
        sqlx::query_scalar("SELECT linked_task_id FROM calendar_events WHERE user_id=$1 AND id=$2")
            .bind(user_id)
            .bind(event_id)
            .fetch_optional(&mut *connection)
            .await?
            .ok_or(AppError::NotFound("calendar item"))?;
    let task = if let Some(id) = task_id {
        Some(sqlx::query_as::<_, TaskSchedule>("SELECT id,scheduled_start,scheduled_end,version FROM tasks WHERE user_id=$1 AND id=$2 FOR UPDATE")
            .bind(user_id).bind(id).fetch_optional(&mut *connection).await?.ok_or(AppError::NotFound("task"))?)
    } else {
        None
    };
    let event = sqlx::query_as::<_, CalendarEvent>(
        "SELECT id,calendar_id,linked_task_id,title,description,starts_at,ends_at,all_day,timezone,location,attendees,recurrence,recurrence_until,created_at,updated_at,version FROM calendar_events WHERE user_id=$1 AND id=$2 FOR UPDATE",
    ).bind(user_id).bind(event_id).fetch_optional(&mut *connection).await?.ok_or(AppError::NotFound("calendar item"))?;
    if event.linked_task_id != task_id {
        return Err(changed());
    }
    Ok((event, task))
}

async fn mapping_guard(
    connection: &mut PgConnection,
    user_id: Uuid,
    event_id: Uuid,
) -> AppResult<Value> {
    // Push ACKs may change etag/baseline/dirty/last_synced_at without changing the user's schedule.
    // Identity and conflict state must not change. Provider pulls independently advance row versions.
    let guard: Option<Value> = sqlx::query_scalar(
        r#"SELECT jsonb_build_object('id',id,'calendar_id',calendar_id,'event_id',canonical_event_id,
            'external_calendar_id',external_calendar_id,'external_event_id',external_event_id,
            'conflict_state',conflict_state,'pending_resolution',pending_resolution,'local_deleted',local_deleted)
            FROM external_event_mappings WHERE user_id=$1 AND canonical_event_id=$2 FOR UPDATE"#,
    ).bind(user_id).bind(event_id).fetch_optional(connection).await?;
    if let Some(value) = &guard
        && (value["conflict_state"] != "none"
            || !value["pending_resolution"].is_null()
            || value["local_deleted"] != false)
    {
        return Err(changed());
    }
    Ok(guard.unwrap_or(Value::Null))
}

type TaskSchedule = (Uuid, Option<DateTime<Utc>>, Option<DateTime<Utc>>);

async fn write_schedule(
    connection: &mut PgConnection,
    user_id: Uuid,
    event_id: Uuid,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    task: Option<TaskSchedule>,
) -> AppResult<CalendarEvent> {
    if let Some((id, start, end)) = task {
        sqlx::query("UPDATE tasks SET scheduled_start=$3,scheduled_end=$4,updated_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND id=$2")
            .bind(user_id).bind(id).bind(start).bind(end).execute(&mut *connection).await?;
    }
    let event = sqlx::query_as::<_, CalendarEvent>(
        "UPDATE calendar_events SET starts_at=$3,ends_at=$4,updated_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND id=$2 RETURNING id,calendar_id,linked_task_id,title,description,starts_at,ends_at,all_day,timezone,location,attendees,recurrence,recurrence_until,created_at,updated_at,version",
    ).bind(user_id).bind(event_id).bind(starts_at).bind(ends_at).fetch_one(connection).await?;
    Ok(event)
}
