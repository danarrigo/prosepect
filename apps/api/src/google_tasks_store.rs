use chrono::{DateTime, NaiveDate, Utc};
use serde::Serialize;
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    google_tasks::TASKS_SCOPE,
    store::Store,
};

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct GoogleTasksStatus {
    pub authorized: bool,
    pub enabled: bool,
    pub task_list_id: Option<String>,
    pub timezone: Option<String>,
    pub list_create_attempted: bool,
    pub last_synced_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub version: i32,
}

impl Store {
    pub async fn google_tasks_status(&self, user: Uuid) -> AppResult<GoogleTasksStatus> {
        sqlx::query_as(
            "SELECT EXISTS(SELECT 1 FROM google_accounts g WHERE g.user_id=u.id AND $2=ANY(g.scopes)) AS authorized,
             COALESCE(c.enabled,FALSE) AS enabled, c.task_list_id, c.timezone,
             COALESCE(c.list_create_attempted,FALSE) AS list_create_attempted,
             c.last_synced_at, c.last_error, COALESCE(c.version,0) AS version
             FROM users u LEFT JOIN google_task_connections c ON c.user_id=u.id WHERE u.id=$1",
        ).bind(user).bind(TASKS_SCOPE).fetch_optional(&self.pool).await?
            .ok_or(AppError::NotFound("user"))
    }

    /// The service must first verify access to the selected list using Google's
    /// API. This final transaction rechecks authorization and excludes sync work.
    pub async fn configure_google_tasks(
        &self,
        user: Uuid,
        enabled: bool,
        selected: Option<(&str, &str)>,
        expected_version: i32,
    ) -> AppResult<GoogleTasksStatus> {
        let mut tx = self.pool.begin().await?;
        let result: AppResult<()> = async {
        sqlx::query("SET LOCAL lock_timeout = '100ms'").execute(&mut *tx).await?;
        let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!("prosepect-sync:{user}")).fetch_one(&mut *tx).await?;
        if !acquired { return Err(AppError::Conflict("Synchronization is active. Try again shortly.".into())); }
        let previous: Option<(i32, Option<String>)> = sqlx::query_as(
            "SELECT version,timezone FROM google_task_connections WHERE user_id=$1 FOR UPDATE NOWAIT"
        ).bind(user).fetch_optional(&mut *tx).await.map_err(config_error)?;
        if previous.as_ref().map_or(0, |row| row.0) != expected_version {
            return Err(AppError::Conflict("Google Tasks settings changed. Refresh before saving.".into()));
        }
        let (list, timezone) = if enabled {
            let (list, timezone) = selected.ok_or_else(|| AppError::Validation("Choose a Google Tasks list and timezone.".into()))?;
            if list.trim().is_empty() || list.len() > 2048 || timezone.len() > 128 {
                return Err(AppError::Validation("Invalid Google Tasks list or timezone.".into()));
            }
            let authorized: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM google_accounts WHERE user_id=$1 AND $2=ANY(scopes))")
                .bind(user).bind(TASKS_SCOPE).fetch_one(&mut *tx).await?;
            if !authorized { return Err(AppError::Forbidden("Google Tasks permission is required")); }
            let valid_zone: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=$1)")
                .bind(timezone).fetch_one(&mut *tx).await?;
            if !valid_zone { return Err(AppError::Validation("Choose a valid IANA timezone.".into())); }
            if previous.as_ref().and_then(|row| row.1.as_deref()).is_some_and(|old| old != timezone) {
                let linked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM google_task_links WHERE user_id=$1)")
                    .bind(user).fetch_one(&mut *tx).await?;
                if linked { return Err(AppError::Conflict("Keep the current sync timezone while tasks are linked.".into())); }
            }
            (Some(list), Some(timezone))
        } else {
            // Disable is always possible, even if Google permission was revoked.
            // Keep identities and date interpretation for a safe later reconnect.
            (None, None)
        };
        sqlx::query(
            "INSERT INTO google_task_connections(user_id,enabled,task_list_id,timezone)
             VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET
             enabled=EXCLUDED.enabled,
             task_list_id=COALESCE(EXCLUDED.task_list_id,google_task_connections.task_list_id),
             timezone=COALESCE(EXCLUDED.timezone,google_task_connections.timezone),
             version=google_task_connections.version+1"
        ).bind(user).bind(enabled).bind(list).bind(timezone).execute(&mut *tx).await.map_err(config_error)?;
        Ok(())
        }.await;
        match result {
            Ok(()) => tx.commit().await?,
            Err(error) => {
                tx.rollback().await?;
                return Err(error);
            }
        }
        self.google_tasks_status(user).await
    }

    /// Convert a remote calendar day without replacing an existing deadline's
    /// wall-clock time. A newly imported date means end-of-day. Reject DST gaps.
    pub async fn google_task_deadline(
        &self,
        date: Option<NaiveDate>,
        existing: Option<DateTime<Utc>>,
        timezone: &str,
    ) -> AppResult<Option<DateTime<Utc>>> {
        let Some(date) = date else {
            return Ok(None);
        };
        let resolved: Option<DateTime<Utc>> = sqlx::query_scalar(
            "WITH requested AS (
                SELECT $1::DATE + COALESCE(($2::TIMESTAMPTZ AT TIME ZONE $3)::TIME,TIME '23:59:59') AS wall
             ), candidates AS (
                SELECT wall, wall AT TIME ZONE $3 AS standard,
                (wall - (($2::TIMESTAMPTZ AT TIME ZONE $3) - ($2::TIMESTAMPTZ AT TIME ZONE 'UTC'))) AT TIME ZONE 'UTC' AS same_offset
                FROM requested
             ), chosen AS (
                SELECT wall, CASE WHEN same_offset AT TIME ZONE $3 = wall THEN same_offset ELSE standard END AS instant
                FROM candidates
             ) SELECT instant FROM chosen WHERE instant AT TIME ZONE $3 = wall"
        ).bind(date).bind(existing).bind(timezone).fetch_optional(&self.pool).await?;
        resolved.map(Some).ok_or_else(|| {
            AppError::Conflict(
                "That date has no matching local deadline time. Choose a deadline in prosepect."
                    .into(),
            )
        })
    }
}

fn config_error(error: sqlx::Error) -> AppError {
    if error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
        == Some("55P03")
    {
        AppError::Conflict("Google Tasks settings are busy. Try again shortly.".into())
    } else {
        error.into()
    }
}
