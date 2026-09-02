use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    google_auth::GoogleCredentials,
    models::{
        ActivityEntry, ActivityList, GoogleIntegrationStatus, SyncConflict, SyncConflictList,
        Synchronization,
    },
    store::Store,
};

impl Store {
    pub async fn google_credentials(&self, user_id: Uuid) -> AppResult<GoogleCredentials> {
        sqlx::query_as::<_, GoogleCredentialRow>(
            r#"
            SELECT encrypted_access_token, encrypted_refresh_token,
                   access_token_expires_at, scopes
            FROM google_accounts WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .map(GoogleCredentialRow::into_credentials)
        .ok_or(AppError::NotConfigured("Google Calendar integration"))
    }

    pub async fn google_integration_status(
        &self,
        user_id: Uuid,
    ) -> AppResult<GoogleIntegrationStatus> {
        let credentials = sqlx::query_as::<_, GoogleCredentialStatus>(
            "SELECT scopes, access_token_expires_at FROM google_accounts WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(match credentials {
            Some(credentials) => GoogleIntegrationStatus {
                connected: credentials
                    .scopes
                    .iter()
                    .any(|scope| scope.contains("/auth/calendar")),
                scopes: credentials.scopes,
                expires_at: credentials.access_token_expires_at,
            },
            None => GoogleIntegrationStatus {
                connected: false,
                scopes: Vec::new(),
                expires_at: None,
            },
        })
    }

    pub async fn update_google_access_token(
        &self,
        user_id: Uuid,
        encrypted_token: Vec<u8>,
        expires_at: Option<DateTime<Utc>>,
    ) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE google_accounts SET encrypted_access_token = $2,
                access_token_expires_at = $3, updated_at = NOW()
            WHERE user_id = $1
            "#,
        )
        .bind(user_id)
        .bind(encrypted_token)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn revoke_google_integration(&self, user_id: Uuid) -> AppResult<()> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("DELETE FROM calendars WHERE user_id = $1 AND source = 'google'")
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM google_accounts WHERE user_id = $1")
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn enqueue_sync(
        &self,
        user_id: Uuid,
        calendar_id: Option<Uuid>,
        kind: &str,
        idempotency_key: &str,
    ) -> AppResult<Synchronization> {
        if idempotency_key.trim().is_empty() || idempotency_key.chars().count() > 200 {
            return Err(AppError::Validation(
                "idempotency key must contain between 1 and 200 characters".to_owned(),
            ));
        }
        sqlx::query_as::<_, Synchronization>(
            r#"
            INSERT INTO sync_jobs (id, user_id, calendar_id, kind, idempotency_key)
            SELECT $1, $2, $3, $4, $5
            WHERE $3::UUID IS NULL OR EXISTS (
                SELECT 1 FROM calendars WHERE id = $3 AND user_id = $2
            )
            ON CONFLICT (user_id, idempotency_key) DO UPDATE
                SET idempotency_key = EXCLUDED.idempotency_key
            RETURNING id, calendar_id, kind, status, attempt_count, available_at,
                      last_error, created_at, updated_at
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(calendar_id)
        .bind(kind)
        .bind(idempotency_key.trim())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound("calendar"))
    }

    pub async fn synchronization(
        &self,
        user_id: Uuid,
        synchronization_id: Uuid,
    ) -> AppResult<Synchronization> {
        sqlx::query_as::<_, Synchronization>(
            r#"
            SELECT id, calendar_id, kind, status, attempt_count, available_at,
                   last_error, created_at, updated_at
            FROM sync_jobs WHERE id = $1 AND user_id = $2
            "#,
        )
        .bind(synchronization_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound("synchronization"))
    }

    pub async fn enqueue_periodic_synchronizations(&self) -> AppResult<u64> {
        let bucket = Utc::now().timestamp() / 300;
        let result = sqlx::query(
            r#"
            INSERT INTO sync_jobs (id, user_id, calendar_id, kind, idempotency_key)
            SELECT gen_random_uuid(), user_id, id, 'calendar_sync',
                   'periodic:' || id::TEXT || ':' || $1::TEXT
            FROM calendars
            WHERE source = 'google' AND selected
              AND (last_synced_at IS NULL OR last_synced_at < NOW() - INTERVAL '5 minutes')
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            "#,
        )
        .bind(bucket)
        .execute(&self.pool)
        .await?;
        sqlx::query("DELETE FROM oauth_login_attempts WHERE expires_at <= NOW()")
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected())
    }

    pub async fn enqueue_expiring_calendar_watches(
        &self,
        only_user: Option<Uuid>,
    ) -> AppResult<u64> {
        sqlx::query("DELETE FROM google_watch_channels WHERE expires_at <= NOW()")
            .execute(&self.pool)
            .await?;
        let bucket = Utc::now().timestamp() / (6 * 60 * 60);
        let result = sqlx::query(
            r#"
            INSERT INTO sync_jobs (id, user_id, calendar_id, kind, idempotency_key)
            SELECT gen_random_uuid(), calendars.user_id, calendars.id, 'calendar_watch',
                   'calendar-watch:' || calendars.id::TEXT || ':' || $1::TEXT
            FROM calendars
            WHERE calendars.source = 'google' AND calendars.selected
              AND calendars.access_role IN ('writer', 'owner')
              AND ($2::UUID IS NULL OR calendars.user_id = $2)
              AND NOT EXISTS (
                  SELECT 1 FROM google_watch_channels channels
                  WHERE channels.calendar_id = calendars.id
                    AND channels.expires_at > NOW() + INTERVAL '24 hours'
              )
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            "#,
        )
        .bind(bucket)
        .bind(only_user)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn replace_google_watch_channel(
        &self,
        user_id: Uuid,
        calendar_id: Uuid,
        channel_id: Uuid,
        resource_id: &str,
        token_hash: &[u8],
        expires_at: DateTime<Utc>,
    ) -> AppResult<Vec<GoogleWatchChannel>> {
        let mut transaction = self.pool.begin().await?;
        let old_channels = sqlx::query_as::<_, GoogleWatchChannel>(
            r#"
            SELECT channel_id, resource_id
            FROM google_watch_channels
            WHERE user_id = $1 AND calendar_id = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(calendar_id)
        .fetch_all(&mut *transaction)
        .await?;
        sqlx::query("DELETE FROM google_watch_channels WHERE user_id = $1 AND calendar_id = $2")
            .bind(user_id)
            .bind(calendar_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            r#"
            INSERT INTO google_watch_channels (
                channel_id, user_id, calendar_id, resource_id, token_hash, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(channel_id)
        .bind(user_id)
        .bind(calendar_id)
        .bind(resource_id)
        .bind(token_hash)
        .bind(expires_at)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(old_channels)
    }

    pub async fn google_watch_channels_for_user(
        &self,
        user_id: Uuid,
    ) -> AppResult<Vec<GoogleWatchChannel>> {
        sqlx::query_as::<_, GoogleWatchChannel>(
            "SELECT channel_id, resource_id FROM google_watch_channels WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await
        .map_err(AppError::from)
    }

    pub async fn enqueue_google_watch_notification(
        &self,
        channel_id: Uuid,
        resource_id: &str,
        token_hash: &[u8],
        message_number: &str,
    ) -> AppResult<bool> {
        let accepted = sqlx::query_scalar::<_, bool>(
            r#"
            WITH channel AS (
                SELECT user_id, calendar_id
                FROM google_watch_channels
                WHERE channel_id = $1 AND resource_id = $2 AND token_hash = $3
                  AND expires_at > NOW()
            ), inserted AS (
                INSERT INTO sync_jobs (id, user_id, calendar_id, kind, idempotency_key)
                SELECT $4, user_id, calendar_id, 'calendar_sync', $5 FROM channel
                ON CONFLICT (user_id, idempotency_key) DO NOTHING
                RETURNING id
            )
            SELECT EXISTS(SELECT 1 FROM channel)
            "#,
        )
        .bind(channel_id)
        .bind(resource_id)
        .bind(token_hash)
        .bind(Uuid::now_v7())
        .bind(format!("google-watch:{channel_id}:{message_number}"))
        .fetch_one(&self.pool)
        .await?;
        Ok(accepted)
    }

    pub async fn claim_sync_job(&self) -> AppResult<Option<ClaimedSyncJob>> {
        let mut transaction = self.pool.begin().await?;
        let job = sqlx::query_as::<_, ClaimedSyncJob>(
            r#"
            SELECT id, user_id, calendar_id, kind, attempt_count
            FROM sync_jobs
            WHERE status IN ('pending', 'failed')
              AND available_at <= NOW()
              AND (leased_until IS NULL OR leased_until < NOW())
              AND attempt_count < 8
            ORDER BY available_at, created_at
            LIMIT 1 FOR UPDATE SKIP LOCKED
            "#,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(job) = &job {
            sqlx::query(
                r#"
                UPDATE sync_jobs SET status = 'running', attempt_count = attempt_count + 1,
                    leased_until = NOW() + INTERVAL '2 minutes', updated_at = NOW()
                WHERE id = $1
                "#,
            )
            .bind(job.id)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(job)
    }

    pub async fn complete_sync_job(&self, job_id: Uuid) -> AppResult<()> {
        sqlx::query(
            r#"
            UPDATE sync_jobs SET status = 'succeeded', leased_until = NULL,
                last_error = NULL, updated_at = NOW() WHERE id = $1
            "#,
        )
        .bind(job_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fail_sync_job(
        &self,
        job_id: Uuid,
        attempt_count: i32,
        error: &str,
    ) -> AppResult<()> {
        let delay_seconds = 2_i64.pow(attempt_count.clamp(1, 8) as u32).min(300);
        sqlx::query(
            r#"
            UPDATE sync_jobs SET status = 'failed', leased_until = NULL,
                available_at = NOW() + ($2 * INTERVAL '1 second'),
                last_error = LEFT($3, 2000), updated_at = NOW() WHERE id = $1
            "#,
        )
        .bind(job_id)
        .bind(delay_seconds)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn record_activity(&self, user_id: Uuid, kind: &str, message: &str) -> AppResult<()> {
        sqlx::query(
            r#"
            INSERT INTO activity_entries (id, user_id, kind, message)
            VALUES ($1, $2, $3, $4)
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(kind)
        .bind(message)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn activity_for_user(&self, user_id: Uuid) -> AppResult<ActivityList> {
        let items = sqlx::query_as::<_, ActivityEntry>(
            r#"
            SELECT kind, message, created_at
            FROM activity_entries
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 100
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(ActivityList { items })
    }

    pub async fn list_sync_conflicts(&self, user_id: Uuid) -> AppResult<SyncConflictList> {
        let items = sqlx::query_as::<_, SyncConflict>(
            r#"
            SELECT id, canonical_event_id, title, status, resolution, created_at, resolved_at
            FROM sync_conflicts WHERE user_id = $1 AND status = 'unresolved'
            ORDER BY created_at DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(SyncConflictList { items })
    }

    pub async fn resolve_sync_conflict(
        &self,
        user_id: Uuid,
        conflict_id: Uuid,
        resolution: &str,
    ) -> AppResult<SyncConflict> {
        if !matches!(resolution, "google" | "prosepect" | "latest") {
            return Err(AppError::Validation(
                "resolution must be google, prosepect, or latest".to_owned(),
            ));
        }
        let mut transaction = self.pool.begin().await?;
        let conflict = sqlx::query_as::<_, SyncConflict>(
            r#"
            UPDATE sync_conflicts SET status = 'resolved', resolution = $3, resolved_at = NOW()
            WHERE id = $1 AND user_id = $2 AND status = 'unresolved'
            RETURNING id, canonical_event_id, title, status, resolution, created_at, resolved_at
            "#,
        )
        .bind(conflict_id)
        .bind(user_id)
        .bind(resolution)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AppError::NotFound("sync conflict"))?;
        let calendar_id = sqlx::query_scalar::<_, Uuid>(
            r#"
            UPDATE external_event_mappings SET conflict_state = 'none',
                local_dirty = CASE WHEN $3 = 'google' THEN FALSE ELSE TRUE END,
                local_deleted = CASE WHEN $3 = 'google' THEN FALSE ELSE local_deleted END,
                external_etag = CASE WHEN $3 = 'google' THEN NULL ELSE external_etag END,
                pending_resolution = $3
            WHERE id = (SELECT mapping_id FROM sync_conflicts WHERE id = $1 AND user_id = $2)
            RETURNING calendar_id
            "#,
        )
        .bind(conflict_id)
        .bind(user_id)
        .bind(resolution)
        .fetch_one(&mut *transaction)
        .await?;
        sqlx::query(
            r#"
            INSERT INTO sync_jobs (id, user_id, calendar_id, kind, idempotency_key)
            VALUES ($1, $2, $3, 'calendar_sync', $4)
            ON CONFLICT (user_id, idempotency_key) DO NOTHING
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(calendar_id)
        .bind(format!("conflict-resolution:{conflict_id}:{resolution}"))
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(conflict)
    }
}

#[derive(sqlx::FromRow)]
struct GoogleCredentialRow {
    encrypted_access_token: Vec<u8>,
    encrypted_refresh_token: Option<Vec<u8>>,
    access_token_expires_at: Option<DateTime<Utc>>,
    scopes: Vec<String>,
}

impl GoogleCredentialRow {
    fn into_credentials(self) -> GoogleCredentials {
        GoogleCredentials {
            encrypted_access_token: self.encrypted_access_token,
            encrypted_refresh_token: self.encrypted_refresh_token,
            access_token_expires_at: self.access_token_expires_at,
            scopes: self.scopes,
        }
    }
}

#[derive(sqlx::FromRow)]
struct GoogleCredentialStatus {
    scopes: Vec<String>,
    access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GoogleWatchChannel {
    pub channel_id: Uuid,
    pub resource_id: String,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedSyncJob {
    pub id: Uuid,
    pub user_id: Uuid,
    pub calendar_id: Option<Uuid>,
    pub kind: String,
    pub attempt_count: i32,
}
