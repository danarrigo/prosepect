use std::collections::HashSet;

use chrono::{DateTime, Utc};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        Calendar, CalendarEvent, CalendarEventList, CalendarEventQuery, CalendarList,
        CreateCalendarEventRequest, CreateCalendarRequest, EventRecurrence, Task,
        UpdateCalendarEventRequest, UpdateCalendarRequest,
    },
    store::Store,
};

impl Store {
    pub async fn list_calendars(&self, user_id: Uuid) -> AppResult<CalendarList> {
        let mut transaction = self.pool.begin().await?;
        Self::ensure_default_calendar(&mut transaction, user_id).await?;
        let items = sqlx::query_as::<_, Calendar>(
            r#"
            SELECT
                id, name, color, source, external_id, selected, is_default,
                created_at, updated_at, version
            FROM calendars
            WHERE user_id = $1
            ORDER BY is_default DESC, name, id
            "#,
        )
        .bind(user_id)
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(CalendarList { items })
    }

    pub async fn create_calendar(
        &self,
        user_id: Uuid,
        request: CreateCalendarRequest,
    ) -> AppResult<Calendar> {
        validate_calendar_fields(&request.name, &request.color)?;
        let calendar = sqlx::query_as::<_, Calendar>(
            r#"
            INSERT INTO calendars (id, user_id, name, color)
            VALUES ($1, $2, $3, $4)
            RETURNING
                id, name, color, source, external_id, selected, is_default,
                created_at, updated_at, version
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(request.name.trim())
        .bind(request.color.to_lowercase())
        .fetch_one(&self.pool)
        .await?;
        Ok(calendar)
    }

    pub async fn update_calendar(
        &self,
        user_id: Uuid,
        calendar_id: Uuid,
        request: UpdateCalendarRequest,
    ) -> AppResult<Calendar> {
        validate_calendar_fields(&request.name, &request.color)?;
        let calendar = sqlx::query_as::<_, Calendar>(
            r#"
            UPDATE calendars
            SET
                name = $3,
                color = $4,
                selected = $5,
                updated_at = NOW(),
                version = version + 1
            WHERE id = $1 AND user_id = $2 AND version = $6
            RETURNING
                id, name, color, source, external_id, selected, is_default,
                created_at, updated_at, version
            "#,
        )
        .bind(calendar_id)
        .bind(user_id)
        .bind(request.name.trim())
        .bind(request.color.to_lowercase())
        .bind(request.selected)
        .bind(request.expected_version)
        .fetch_optional(&self.pool)
        .await?;
        if let Some(calendar) = calendar {
            if calendar.source == crate::models::CalendarSource::Google && calendar.selected {
                self.enqueue_sync(
                    user_id,
                    Some(calendar.id),
                    "calendar_sync",
                    &format!("calendar-selection:{}:{}", calendar.id, calendar.version),
                )
                .await?;
            }
            return Ok(calendar);
        }
        self.calendar_error(user_id, calendar_id, request.expected_version)
            .await
    }

    pub async fn delete_calendar(
        &self,
        user_id: Uuid,
        calendar_id: Uuid,
        expected_version: i32,
    ) -> AppResult<()> {
        let result = sqlx::query(
            r#"
            DELETE FROM calendars
            WHERE id = $1 AND user_id = $2 AND version = $3 AND NOT is_default
            "#,
        )
        .bind(calendar_id)
        .bind(user_id)
        .bind(expected_version)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 1 {
            return Ok(());
        }
        let calendar = sqlx::query_as::<_, (i32, bool)>(
            "SELECT version, is_default FROM calendars WHERE id = $1 AND user_id = $2",
        )
        .bind(calendar_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        match calendar {
            Some((_, true)) => Err(AppError::Validation(
                "the default calendar cannot be deleted".to_owned(),
            )),
            Some((version, _)) => Err(AppError::Conflict(format!(
                "calendar changed since version {expected_version}; current version is {version}"
            ))),
            None => Err(AppError::NotFound("calendar")),
        }
    }

    pub async fn list_calendar_events(
        &self,
        user_id: Uuid,
        query: CalendarEventQuery,
    ) -> AppResult<CalendarEventList> {
        if query.starts_before <= query.ends_after {
            return Err(AppError::Validation(
                "starts_before must be after ends_after".to_owned(),
            ));
        }
        let items = sqlx::query_as::<_, CalendarEvent>(
            r#"
            SELECT
                id, calendar_id, linked_task_id, title, description, starts_at, ends_at,
                all_day, timezone, location, attendees, recurrence, recurrence_until,
                created_at, updated_at, version
            FROM calendar_events
            WHERE
                user_id = $1
                AND ($4::UUID IS NULL OR calendar_id = $4)
                AND (
                    (starts_at < $2 AND ends_at > $3)
                    OR (
                        recurrence <> 'none'
                        AND starts_at < $2
                        AND (recurrence_until IS NULL OR recurrence_until > $3)
                    )
                )
            ORDER BY starts_at, ends_at, id
            "#,
        )
        .bind(user_id)
        .bind(query.starts_before)
        .bind(query.ends_after)
        .bind(query.calendar_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(CalendarEventList { items })
    }

    pub async fn create_calendar_event(
        &self,
        user_id: Uuid,
        request: CreateCalendarEventRequest,
    ) -> AppResult<CalendarEvent> {
        validate_event_request(
            &request.title,
            &request.description,
            request.starts_at,
            request.ends_at,
            &request.timezone,
            &request.location,
            &request.attendees,
            request.recurrence,
            request.recurrence_until,
        )?;
        let mut transaction = self.pool.begin().await?;
        let event = sqlx::query_as::<_, CalendarEvent>(
            r#"
            INSERT INTO calendar_events (
                id, user_id, calendar_id, title, description, starts_at, ends_at,
                all_day, timezone, location, attendees, recurrence, recurrence_until
            )
            SELECT
                $1, $2, calendars.id, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
            FROM calendars
            WHERE calendars.id = $3 AND calendars.user_id = $2
            RETURNING
                id, calendar_id, linked_task_id, title, description, starts_at, ends_at,
                all_day, timezone, location, attendees, recurrence, recurrence_until,
                created_at, updated_at, version
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(request.calendar_id)
        .bind(request.title.trim())
        .bind(request.description.trim())
        .bind(request.starts_at)
        .bind(request.ends_at)
        .bind(request.all_day)
        .bind(request.timezone.trim())
        .bind(request.location.trim())
        .bind(normalize_attendees(request.attendees)?)
        .bind(request.recurrence)
        .bind(request.recurrence_until)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AppError::NotFound("calendar"))?;
        Self::mark_event_for_sync(&mut transaction, user_id, &event, false).await?;
        transaction.commit().await?;
        Ok(event)
    }

    pub async fn update_calendar_event(
        &self,
        user_id: Uuid,
        event_id: Uuid,
        request: UpdateCalendarEventRequest,
    ) -> AppResult<CalendarEvent> {
        validate_event_request(
            &request.title,
            &request.description,
            request.starts_at,
            request.ends_at,
            &request.timezone,
            &request.location,
            &request.attendees,
            request.recurrence,
            request.recurrence_until,
        )?;
        let mut transaction = self.pool.begin().await?;
        let event = sqlx::query_as::<_, CalendarEvent>(
            r#"
            UPDATE calendar_events events
            SET
                calendar_id = calendars.id,
                title = $4,
                description = $5,
                starts_at = $6,
                ends_at = $7,
                all_day = $8,
                timezone = $9,
                location = $10,
                attendees = $11,
                recurrence = $12,
                recurrence_until = $13,
                updated_at = NOW(),
                version = events.version + 1
            FROM calendars
            WHERE
                events.id = $1
                AND events.user_id = $2
                AND events.version = $14
                AND calendars.id = $3
                AND calendars.user_id = $2
            RETURNING
                events.id, events.calendar_id, events.linked_task_id, events.title,
                events.description, events.starts_at, events.ends_at, events.all_day,
                events.timezone, events.location, events.attendees, events.recurrence,
                events.recurrence_until, events.created_at, events.updated_at, events.version
            "#,
        )
        .bind(event_id)
        .bind(user_id)
        .bind(request.calendar_id)
        .bind(request.title.trim())
        .bind(request.description.trim())
        .bind(request.starts_at)
        .bind(request.ends_at)
        .bind(request.all_day)
        .bind(request.timezone.trim())
        .bind(request.location.trim())
        .bind(normalize_attendees(request.attendees)?)
        .bind(request.recurrence)
        .bind(request.recurrence_until)
        .bind(request.expected_version)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(event) = event else {
            transaction.rollback().await?;
            return self
                .event_error(user_id, event_id, request.expected_version)
                .await;
        };
        if let Some(task_id) = event.linked_task_id {
            sqlx::query(
                r#"
                UPDATE tasks
                SET
                    scheduled_start = $3,
                    scheduled_end = $4,
                    updated_at = NOW(),
                    version = version + 1
                WHERE id = $1 AND user_id = $2
                "#,
            )
            .bind(task_id)
            .bind(user_id)
            .bind(event.starts_at)
            .bind(event.ends_at)
            .execute(&mut *transaction)
            .await?;
        }
        Self::mark_event_for_sync(&mut transaction, user_id, &event, false).await?;
        transaction.commit().await?;
        Ok(event)
    }

    pub async fn delete_calendar_event(
        &self,
        user_id: Uuid,
        event_id: Uuid,
        expected_version: i32,
    ) -> AppResult<()> {
        let mut transaction = self.pool.begin().await?;
        let existing = sqlx::query_as::<_, CalendarEvent>(
            r#"
            SELECT id, calendar_id, linked_task_id, title, description, starts_at, ends_at,
                   all_day, timezone, location, attendees, recurrence, recurrence_until,
                   created_at, updated_at, version
            FROM calendar_events WHERE id = $1 AND user_id = $2 AND version = $3
            "#,
        )
        .bind(event_id)
        .bind(user_id)
        .bind(expected_version)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(existing) = existing else {
            transaction.rollback().await?;
            return self
                .event_error::<CalendarEvent>(user_id, event_id, expected_version)
                .await
                .map(|_| ());
        };
        Self::mark_event_for_sync(&mut transaction, user_id, &existing, true).await?;
        let linked_task_id = sqlx::query_scalar::<_, Option<Uuid>>(
            r#"
            DELETE FROM calendar_events
            WHERE id = $1 AND user_id = $2 AND version = $3
            RETURNING linked_task_id
            "#,
        )
        .bind(event_id)
        .bind(user_id)
        .bind(expected_version)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(linked_task_id) = linked_task_id else {
            transaction.rollback().await?;
            return self
                .event_error::<CalendarEvent>(user_id, event_id, expected_version)
                .await
                .map(|_| ());
        };
        if let Some(task_id) = linked_task_id {
            sqlx::query(
                r#"
                UPDATE tasks
                SET
                    scheduled_start = NULL,
                    scheduled_end = NULL,
                    updated_at = NOW(),
                    version = version + 1
                WHERE id = $1 AND user_id = $2
                "#,
            )
            .bind(task_id)
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    async fn mark_event_for_sync(
        connection: &mut PgConnection,
        user_id: Uuid,
        event: &CalendarEvent,
        deleted: bool,
    ) -> AppResult<()> {
        let source = sqlx::query_scalar::<_, String>(
            "SELECT source FROM calendars WHERE id = $1 AND user_id = $2",
        )
        .bind(event.calendar_id)
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?;
        if source.as_deref() != Some("google") {
            return Ok(());
        }
        sqlx::query(
            r#"
            UPDATE external_event_mappings
            SET local_dirty = NOT $3,
                local_deleted = $3,
                canonical_event_id = CASE WHEN $3 THEN NULL ELSE canonical_event_id END
            WHERE user_id = $1 AND canonical_event_id = $2
            "#,
        )
        .bind(user_id)
        .bind(event.id)
        .bind(deleted)
        .execute(&mut *connection)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO sync_jobs (
                id, user_id, calendar_id, kind, idempotency_key
            ) VALUES ($1, $2, $3, 'calendar_sync', $4)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(event.calendar_id)
        .bind(format!(
            "calendar-event:{}:{}:{}",
            event.id,
            event.version,
            if deleted { "deleted" } else { "changed" }
        ))
        .execute(&mut *connection)
        .await?;
        Ok(())
    }

    pub(crate) async fn sync_task_calendar_event(
        connection: &mut PgConnection,
        user_id: Uuid,
        task: &Task,
    ) -> AppResult<()> {
        match (task.scheduled_start, task.scheduled_end) {
            (Some(starts_at), Some(ends_at)) => {
                let calendar_id = Self::ensure_default_calendar(connection, user_id).await?;
                let timezone =
                    sqlx::query_scalar::<_, String>("SELECT timezone FROM users WHERE id = $1")
                        .bind(user_id)
                        .fetch_one(&mut *connection)
                        .await?;
                sqlx::query(
                    r#"
                    INSERT INTO calendar_events (
                        id, user_id, calendar_id, linked_task_id, title, description,
                        starts_at, ends_at, timezone
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (linked_task_id) DO UPDATE
                    SET
                        title = EXCLUDED.title,
                        description = EXCLUDED.description,
                        starts_at = EXCLUDED.starts_at,
                        ends_at = EXCLUDED.ends_at,
                        timezone = EXCLUDED.timezone,
                        updated_at = NOW(),
                        version = calendar_events.version + 1
                    "#,
                )
                .bind(Uuid::now_v7())
                .bind(user_id)
                .bind(calendar_id)
                .bind(task.id)
                .bind(&task.title)
                .bind(&task.description)
                .bind(starts_at)
                .bind(ends_at)
                .bind(timezone)
                .execute(&mut *connection)
                .await?;
            }
            _ => {
                sqlx::query(
                    "DELETE FROM calendar_events WHERE user_id = $1 AND linked_task_id = $2",
                )
                .bind(user_id)
                .bind(task.id)
                .execute(&mut *connection)
                .await?;
            }
        }
        Ok(())
    }

    async fn ensure_default_calendar(
        connection: &mut PgConnection,
        user_id: Uuid,
    ) -> AppResult<Uuid> {
        if let Some(id) = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM calendars WHERE user_id = $1 AND is_default FOR UPDATE",
        )
        .bind(user_id)
        .fetch_optional(&mut *connection)
        .await?
        {
            return Ok(id);
        }
        sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO calendars (id, user_id, name, is_default)
            VALUES ($1, $2, 'My calendar', TRUE)
            RETURNING id
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .fetch_one(&mut *connection)
        .await
        .map_err(AppError::from)
    }

    async fn calendar_error<T>(
        &self,
        user_id: Uuid,
        calendar_id: Uuid,
        expected_version: i32,
    ) -> AppResult<T> {
        let version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM calendars WHERE id = $1 AND user_id = $2",
        )
        .bind(calendar_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        match version {
            Some(version) => Err(AppError::Conflict(format!(
                "calendar changed since version {expected_version}; current version is {version}"
            ))),
            None => Err(AppError::NotFound("calendar")),
        }
    }

    async fn event_error<T>(
        &self,
        user_id: Uuid,
        event_id: Uuid,
        expected_version: i32,
    ) -> AppResult<T> {
        let version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM calendar_events WHERE id = $1 AND user_id = $2",
        )
        .bind(event_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        match version {
            Some(version) => Err(AppError::Conflict(format!(
                "calendar event changed since version {expected_version}; current version is {version}"
            ))),
            None => Err(AppError::NotFound("calendar event")),
        }
    }
}

fn validate_calendar_fields(name: &str, color: &str) -> AppResult<()> {
    if name.trim().is_empty() || name.trim().chars().count() > 120 {
        return Err(AppError::Validation(
            "calendar name must contain between 1 and 120 characters".to_owned(),
        ));
    }
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::Validation(
            "calendar color must be a six-digit hexadecimal color".to_owned(),
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_event_request(
    title: &str,
    description: &str,
    starts_at: DateTime<Utc>,
    ends_at: DateTime<Utc>,
    timezone: &str,
    location: &str,
    attendees: &[String],
    recurrence: EventRecurrence,
    recurrence_until: Option<DateTime<Utc>>,
) -> AppResult<()> {
    if title.trim().is_empty() || title.trim().chars().count() > 240 {
        return Err(AppError::Validation(
            "event title must contain between 1 and 240 characters".to_owned(),
        ));
    }
    if description.chars().count() > 10_000 || location.chars().count() > 500 {
        return Err(AppError::Validation(
            "event description or location is too long".to_owned(),
        ));
    }
    if ends_at <= starts_at {
        return Err(AppError::Validation(
            "event end must be after its start".to_owned(),
        ));
    }
    if timezone.trim().is_empty() || timezone.chars().count() > 64 {
        return Err(AppError::Validation("event timezone is invalid".to_owned()));
    }
    if attendees.len() > 100 {
        return Err(AppError::Validation(
            "an event cannot have more than 100 attendees".to_owned(),
        ));
    }
    match (recurrence, recurrence_until) {
        (EventRecurrence::None, Some(_)) => Err(AppError::Validation(
            "recurrence_until requires a recurring event".to_owned(),
        )),
        (_, Some(until)) if until <= starts_at => Err(AppError::Validation(
            "recurrence_until must be after the event start".to_owned(),
        )),
        _ => Ok(()),
    }
}

fn normalize_attendees(attendees: Vec<String>) -> AppResult<Vec<String>> {
    let mut normalized = Vec::new();
    let mut seen = HashSet::new();
    for attendee in attendees {
        let attendee = attendee.trim().to_lowercase();
        if attendee.is_empty() {
            continue;
        }
        if attendee.len() > 254 || !attendee.contains('@') {
            return Err(AppError::Validation(
                "event attendees must be valid email addresses".to_owned(),
            ));
        }
        if seen.insert(attendee.clone()) {
            normalized.push(attendee);
        }
    }
    Ok(normalized)
}
