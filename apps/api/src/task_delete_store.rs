use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{TaskDeleteUndo, TaskDeleteUndoList},
    store::Store,
    sync_service::SyncService,
};

const SNAPSHOT_BYTES: usize = 1024 * 1024;
const OWNER_BYTES: i64 = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Snapshot {
    task: Value,
    event: Option<Value>,
    notes: Vec<Value>,
    files: Vec<Value>,
    focus: Vec<Value>,
    successors: Vec<Value>,
    projects: Vec<Value>,
    task_dependencies: Vec<Value>,
    calendar: Option<Value>,
    mapping: Option<Value>,
    google_account: Option<Value>,
    revisions: Vec<(String, i64)>,
}

enum DeletePreparation {
    Deleted(TaskDeleteUndo),
    Legacy(Box<Snapshot>),
}

pub(crate) fn changed() -> AppError {
    AppError::Conflict("Deletion Undo is no longer safe because a dependency changed or the 60-second window expired. Refresh and try again.".into())
}

fn retry_error(error: AppError) -> AppError {
    if let AppError::Database(ref db) = error
        && matches!(
            db.as_database_error().and_then(|e| e.code()).as_deref(),
            Some("55P03" | "23505" | "23503")
        )
    {
        return changed();
    }
    error
}

fn id(row: &Value, field: &str) -> AppResult<Uuid> {
    row[field]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(changed)
}
fn optional_id(row: &Value, field: &str) -> AppResult<Option<Uuid>> {
    if row[field].is_null() {
        Ok(None)
    } else {
        id(row, field).map(Some)
    }
}
fn encode(snapshot: &Snapshot) -> AppResult<Value> {
    serde_json::to_value(snapshot).map_err(|_| changed())
}
fn decode(value: Value) -> AppResult<Snapshot> {
    serde_json::from_value(value).map_err(|_| changed())
}

impl Store {
    pub(crate) async fn bump_focus_revision(
        connection: &mut PgConnection,
        user: Uuid,
        date: NaiveDate,
    ) -> AppResult<()> {
        sqlx::query("INSERT INTO task_delete_guard_revisions(user_id,scope,revision) VALUES ($1,$2,1) ON CONFLICT(user_id,scope) DO UPDATE SET revision=task_delete_guard_revisions.revision+1")
            .bind(user).bind(format!("focus:{date}")).execute(connection).await?;
        Ok(())
    }

    pub async fn cleanup_task_delete_undos(&self) -> AppResult<u64> {
        Ok(sqlx::query("DELETE FROM task_delete_undos WHERE id IN (SELECT id FROM task_delete_undos WHERE expires_at <= clock_timestamp() ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED)")
            .execute(&self.pool).await?.rows_affected())
    }

    pub async fn list_task_delete_undos(&self, user: Uuid) -> AppResult<TaskDeleteUndoList> {
        let items = sqlx::query_as("SELECT id,task_id,task_title,expires_at FROM task_delete_undos WHERE user_id=$1 AND expires_at > clock_timestamp() ORDER BY expires_at DESC,id DESC LIMIT 100")
            .bind(user).fetch_all(&self.pool).await?;
        Ok(TaskDeleteUndoList { items })
    }

    pub async fn delete_task_with_undo(
        &self,
        user: Uuid,
        task: Uuid,
        expected_version: i32,
    ) -> AppResult<TaskDeleteUndo> {
        self.delete_task_with_undo_validated(user, task, expected_version, None)
            .await
    }

    pub async fn delete_task_with_undo_validated(
        &self,
        user: Uuid,
        task: Uuid,
        expected_version: i32,
        service: Option<&SyncService>,
    ) -> AppResult<TaskDeleteUndo> {
        let prepared = self
            .delete_task_with_undo_inner(user, task, expected_version, None)
            .await
            .map_err(retry_error)?;
        let snapshot = match prepared {
            DeletePreparation::Deleted(receipt) => return Ok(receipt),
            DeletePreparation::Legacy(snapshot) => snapshot,
        };
        // The preparation transaction has rolled back and released its connection.
        // Validate the complete current write shape, not the incomplete legacy hash.
        let mut mapping = snapshot.mapping.clone().ok_or_else(changed)?;
        mapping["base_fingerprint"] = json!(crate::sync_service::snapshot_event_fingerprint(
            snapshot.event.as_ref().ok_or_else(changed)?
        )?);
        service
            .ok_or(AppError::NotConfigured("Google Calendar validation"))?
            .validate_task_delete_undo(user, &mapping)
            .await?;
        match self
            .delete_task_with_undo_inner(user, task, expected_version, Some(&snapshot))
            .await
            .map_err(retry_error)?
        {
            DeletePreparation::Deleted(receipt) => Ok(receipt),
            DeletePreparation::Legacy(_) => Err(changed()),
        }
    }

    async fn delete_task_with_undo_inner(
        &self,
        user: Uuid,
        task_id: Uuid,
        expected_version: i32,
        validated: Option<&Snapshot>,
    ) -> AppResult<DeletePreparation> {
        if expected_version < 1 {
            return Err(AppError::Validation(
                "expected_version must be greater than zero".into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        lock(&mut tx, user).await?;
        let task = row(&mut tx, "tasks", user, task_id)
            .await?
            .ok_or(AppError::NotFound("task"))?;
        if task["version"] != expected_version {
            return Err(changed());
        }
        let children: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE user_id=$1 AND parent_task_id=$2)",
        )
        .bind(user)
        .bind(task_id)
        .fetch_one(&mut *tx)
        .await?;
        if children {
            return Err(AppError::Conflict(
                "task cannot be deleted while it has subtasks".into(),
            ));
        }
        let (count, bytes): (i64,i64) = sqlx::query_as("SELECT count(*),COALESCE(sum(octet_length(snapshot::text)),0)::bigint FROM task_delete_undos WHERE user_id=$1 AND expires_at > clock_timestamp()")
            .bind(user).fetch_one(&mut *tx).await?;
        if count >= 100 {
            return Err(capacity());
        }
        let event: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(e) FROM calendar_events e WHERE user_id=$1 AND linked_task_id=$2 FOR UPDATE NOWAIT")
            .bind(user).bind(task_id).fetch_optional(&mut *tx).await?;
        let event_id = event.as_ref().map(|e| id(e, "id")).transpose()?;
        // Lock FK parents before discovering children; concurrent note/file insertion must
        // finish first or wait until this transaction has committed, then fail its FK.
        let notes = sqlx::query_scalar::<_,Value>("SELECT to_jsonb(n) FROM notes n WHERE user_id=$1 AND (task_id=$2 OR event_id=$3) ORDER BY id LIMIT 65 FOR UPDATE NOWAIT")
            .bind(user).bind(task_id).bind(event_id).fetch_all(&mut *tx).await?;
        cap(&notes, 64)?;
        let note_ids = notes
            .iter()
            .map(|n| id(n, "id"))
            .collect::<AppResult<Vec<_>>>()?;
        let files = sqlx::query_scalar::<_,Value>("SELECT to_jsonb(f) FROM files f WHERE user_id=$1 AND (task_id=$2 OR event_id=$3 OR note_id=ANY($4)) ORDER BY id LIMIT 129 FOR UPDATE NOWAIT")
            .bind(user).bind(task_id).bind(event_id).bind(&note_ids).fetch_all(&mut *tx).await?;
        cap(&files, 128)?;
        let focus = sqlx::query_scalar::<_,Value>("SELECT to_jsonb(f) FROM daily_focus_tasks f WHERE user_id=$1 AND task_id=$2 ORDER BY focus_date LIMIT 33 FOR UPDATE NOWAIT")
            .bind(user).bind(task_id).fetch_all(&mut *tx).await?;
        cap(&focus, 32)?;
        let successors = sqlx::query_scalar::<_,Value>("SELECT to_jsonb(t) FROM tasks t WHERE user_id=$1 AND recurrence_source_id=$2 ORDER BY id LIMIT 2 FOR UPDATE NOWAIT")
            .bind(user).bind(task_id).fetch_all(&mut *tx).await?;
        cap(&successors, 1)?;
        let mut snapshot = Snapshot {
            task,
            event,
            notes,
            files,
            focus,
            successors,
            projects: vec![],
            task_dependencies: vec![],
            calendar: None,
            mapping: None,
            google_account: None,
            revisions: vec![],
        };
        if let Some(project) = optional_id(&snapshot.task, "project_id")? {
            snapshot.projects.push(
                row(&mut tx, "projects", user, project)
                    .await?
                    .ok_or_else(changed)?,
            );
        }
        for field in ["parent_task_id", "recurrence_source_id"] {
            if let Some(dep) = optional_id(&snapshot.task, field)? {
                snapshot.task_dependencies.push(
                    row(&mut tx, "tasks", user, dep)
                        .await?
                        .ok_or_else(changed)?,
                );
            }
        }
        if !snapshot.focus.is_empty() {
            let rev = revision(&mut tx, user, "review-selection").await?;
            snapshot.revisions.push(("review-selection".into(), rev));
        }
        for focus in &snapshot.focus {
            let scope = format!(
                "focus:{}",
                focus["focus_date"].as_str().ok_or_else(changed)?
            );
            let revision = revision(&mut tx, user, &scope).await?;
            snapshot.revisions.push((scope, revision));
        }
        let mut legacy = false;
        if let Some(event) = &snapshot.event {
            let calendar_id = id(event, "calendar_id")?;
            // Serialize preference changes even when the preferred calendar changes to a
            // newly inserted row, not merely when this event's calendar row is edited.
            let rev = revision(&mut tx, user, "calendars").await?;
            snapshot.revisions.push(("calendars".into(), rev));
            let calendar = row(&mut tx, "calendars", user, calendar_id)
                .await?
                .ok_or_else(changed)?;
            let mapping: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(m) FROM external_event_mappings m WHERE canonical_event_id=$1 FOR UPDATE NOWAIT")
                .bind(id(event,"id")?).fetch_optional(&mut *tx).await?;
            if calendar["source"] == "google" {
                snapshot.google_account = Some(google_account_guard(&mut tx, user).await?);
                let preferred: Option<Uuid> = sqlx::query_scalar("SELECT id FROM calendars WHERE user_id=$1 AND source='google' AND selected AND provider_primary AND access_role IN ('writer','owner') ORDER BY id LIMIT 1")
                    .bind(user).fetch_optional(&mut *tx).await?;
                let Some(ref m) = mapping else {
                    return Err(google_refusal());
                };
                if preferred != Some(calendar_id)
                    || m["user_id"] != json!(user)
                    || m["calendar_id"] != json!(calendar_id)
                    || m["provider"] != "google"
                    || m["external_calendar_id"] != calendar["external_id"]
                    || m["external_event_id"].as_str().is_none_or(str::is_empty)
                    || m["external_etag"].as_str().is_none_or(str::is_empty)
                    || m["local_dirty"] != false
                    || m["local_deleted"] != false
                    || m["conflict_state"] != "none"
                    || !m["pending_resolution"].is_null()
                    || m["delete_resolution_pending"] != false
                    || m["reversible_tombstone"] != false
                    || !m["deletion_hold_until"].is_null()
                {
                    return Err(google_refusal());
                }
                let unresolved: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sync_conflicts WHERE mapping_id=$1 AND status='unresolved')")
                    .bind(id(m,"id")?).fetch_one(&mut *tx).await?;
                if unresolved {
                    return Err(google_refusal());
                }
                if m["base_fingerprint"].as_str()
                    != Some(crate::sync_service::snapshot_event_fingerprint(event)?.as_str())
                {
                    if m["base_fingerprint"].as_str()
                        != Some(
                            crate::sync_service::legacy_snapshot_event_fingerprint(event)?.as_str(),
                        )
                    {
                        return Err(google_refusal());
                    }
                    legacy = true;
                }
            } else if mapping.is_some() {
                return Err(google_refusal());
            }
            snapshot.calendar = Some(calendar_guard(calendar));
            snapshot.mapping = mapping;
        }
        let value = encode(&snapshot)?;
        // PostgreSQL's JSON text is the durable size, not the more compact serde encoding.
        let size: i64 = sqlx::query_scalar("SELECT octet_length($1::jsonb::text)::bigint")
            .bind(&value)
            .fetch_one(&mut *tx)
            .await?;
        if size + 512 > SNAPSHOT_BYTES as i64 || bytes + size + 512 > OWNER_BYTES {
            return Err(capacity());
        }
        if let Some(validated) = validated {
            // Rebuilt under synchronization exclusion: compare every dependency, clean
            // mapping field, account identity and preference/focus revision before repair.
            if value != encode(validated)? || !legacy {
                return Err(changed());
            }
            let fingerprint = crate::sync_service::snapshot_event_fingerprint(
                snapshot.event.as_ref().ok_or_else(changed)?,
            )?;
            let mapping = snapshot.mapping.as_mut().ok_or_else(changed)?;
            sqlx::query("UPDATE external_event_mappings SET base_fingerprint=$2 WHERE id=$1")
                .bind(id(mapping, "id")?)
                .bind(&fingerprint)
                .execute(&mut *tx)
                .await?;
            mapping["base_fingerprint"] = json!(fingerprint);
        } else if legacy {
            tx.rollback().await?;
            return Ok(DeletePreparation::Legacy(Box::new(snapshot)));
        }
        let value = encode(&snapshot)?;
        let receipt: TaskDeleteUndo = sqlx::query_as("INSERT INTO task_delete_undos(id,user_id,task_id,task_title,snapshot,expires_at) VALUES ($1,$2,$3,$4,$5,clock_timestamp()+INTERVAL '60 seconds') RETURNING id,task_id,task_title,expires_at")
            .bind(Uuid::now_v7()).bind(user).bind(task_id).bind(snapshot.task["title"].as_str().ok_or_else(changed)?).bind(value).fetch_one(&mut *tx).await?;
        if let Some(mapping) = &snapshot.mapping {
            sqlx::query("UPDATE external_event_mappings SET canonical_event_id=NULL,local_deleted=TRUE,local_dirty=FALSE,reversible_tombstone=TRUE,deletion_hold_until=$2 WHERE id=$1")
                .bind(id(mapping,"id")?).bind(receipt.expires_at).execute(&mut *tx).await?;
            sqlx::query("INSERT INTO sync_jobs(id,user_id,calendar_id,kind,idempotency_key,available_at) VALUES ($1,$2,$3,'calendar_sync',$4,$5)")
                .bind(Uuid::now_v7()).bind(user).bind(id(mapping,"calendar_id")?).bind(format!("task-delete-expiry:{}",receipt.id)).bind(receipt.expires_at).execute(&mut *tx).await?;
        }
        sqlx::query("DELETE FROM tasks WHERE id=$1 AND user_id=$2")
            .bind(task_id)
            .bind(user)
            .execute(&mut *tx)
            .await?;
        // Cascade deletion increments focus revisions. Store expected *detached* state.
        for (scope, expected) in &mut snapshot.revisions {
            *expected = revision(&mut tx, user, scope).await?;
        }
        sqlx::query("UPDATE task_delete_undos SET snapshot=$2 WHERE id=$1")
            .bind(receipt.id)
            .bind(encode(&snapshot)?)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(DeletePreparation::Deleted(receipt))
    }

    pub async fn undo_task_delete(
        &self,
        user: Uuid,
        receipt: Uuid,
        service: Option<&SyncService>,
    ) -> AppResult<()> {
        self.undo_task_delete_inner(user, receipt, service)
            .await
            .map_err(retry_error)
    }

    async fn undo_task_delete_inner(
        &self,
        user: Uuid,
        receipt: Uuid,
        service: Option<&SyncService>,
    ) -> AppResult<()> {
        // fetch_optional releases its pool connection before any provider HTTP, including
        // token refresh. Never retain a transaction or pool lease across the fresh GET.
        let prepared: Option<(Value,DateTime<Utc>,bool)> = sqlx::query_as("SELECT snapshot,expires_at,expires_at > clock_timestamp() FROM task_delete_undos WHERE id=$1 AND user_id=$2")
            .bind(receipt).bind(user).fetch_optional(&self.pool).await?;
        let (value, expiry, active) = prepared.ok_or(AppError::NotFound("task deletion Undo"))?;
        if !active {
            return Err(changed());
        }
        let snapshot = decode(value.clone())?;
        if let Some(mapping) = &snapshot.mapping {
            service
                .ok_or(AppError::NotConfigured("Google Calendar validation"))?
                .validate_task_delete_undo(user, mapping)
                .await?;
        }
        let mut tx = self.pool.begin().await?;
        lock(&mut tx, user).await?;
        let current: Option<Value> = sqlx::query_scalar("SELECT snapshot FROM task_delete_undos WHERE id=$1 AND user_id=$2 AND expires_at > clock_timestamp() FOR UPDATE NOWAIT")
            .bind(receipt).bind(user).fetch_optional(&mut *tx).await?;
        if current.as_ref() != Some(&value) {
            return Err(changed());
        }
        for (scope, expected) in &snapshot.revisions {
            if revision(&mut tx, user, scope).await? != *expected {
                return Err(changed());
            }
        }
        for project in &snapshot.projects {
            guard(&mut tx, "projects", user, project).await?;
        }
        for dep in &snapshot.task_dependencies {
            guard(&mut tx, "tasks", user, dep).await?;
        }
        if let Some(calendar) = &snapshot.calendar {
            let current = row(&mut tx, "calendars", user, id(calendar, "id")?)
                .await?
                .map(calendar_guard);
            if current.as_ref() != Some(calendar) {
                return Err(changed());
            }
        }
        if let Some(account) = &snapshot.google_account
            && &google_account_guard(&mut tx, user).await? != account
        {
            return Err(changed());
        }
        for file in &snapshot.files {
            let mut detached = file.clone();
            detached["task_id"] = Value::Null;
            detached["event_id"] = Value::Null;
            detached["note_id"] = Value::Null;
            guard(&mut tx, "files", user, &detached).await?;
        }
        for successor in &snapshot.successors {
            let mut detached = successor.clone();
            detached["recurrence_source_id"] = Value::Null;
            guard(&mut tx, "tasks", user, &detached).await?;
        }
        if let Some(mapping) = &snapshot.mapping {
            let mut held = mapping.clone();
            held["canonical_event_id"] = Value::Null;
            held["local_deleted"] = json!(true);
            held["reversible_tombstone"] = json!(true);
            // Compare timestamp in PostgreSQL rather than JSON's alternate UTC spelling.
            let current: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(m)-'deletion_hold_until' FROM external_event_mappings m WHERE id=$1 AND user_id=$2 AND deletion_hold_until=$3 FOR UPDATE NOWAIT")
                .bind(id(mapping,"id")?).bind(user).bind(expiry).fetch_optional(&mut *tx).await?;
            held.as_object_mut()
                .ok_or_else(changed)?
                .remove("deletion_hold_until");
            if current != Some(held) {
                return Err(changed());
            }
            let unresolved: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sync_conflicts WHERE mapping_id=$1 AND status='unresolved')")
                .bind(id(mapping,"id")?).fetch_one(&mut *tx).await?;
            if unresolved {
                return Err(changed());
            }
        }
        insert_versioned(&mut tx, "tasks", &snapshot.task).await?;
        if let Some(event) = &snapshot.event {
            insert_versioned(&mut tx, "calendar_events", event).await?;
        }
        for note in &snapshot.notes {
            insert_versioned(&mut tx, "notes", note).await?;
        }
        for file in &snapshot.files {
            sqlx::query(
                "UPDATE files SET task_id=$3,event_id=$4,note_id=$5 WHERE user_id=$1 AND id=$2",
            )
            .bind(user)
            .bind(id(file, "id")?)
            .bind(optional_id(file, "task_id")?)
            .bind(optional_id(file, "event_id")?)
            .bind(optional_id(file, "note_id")?)
            .execute(&mut *tx)
            .await?;
        }
        for successor in &snapshot.successors {
            sqlx::query("UPDATE tasks SET recurrence_source_id=$3,version=version+1,updated_at=clock_timestamp() WHERE user_id=$1 AND id=$2")
                .bind(user).bind(id(successor,"id")?).bind(id(&snapshot.task,"id")?).execute(&mut *tx).await?;
        }
        for focus in &snapshot.focus {
            sqlx::query("INSERT INTO daily_focus_tasks SELECT * FROM jsonb_populate_record(NULL::daily_focus_tasks,$1)")
                .bind(focus).execute(&mut *tx).await?;
        }
        if let Some(mapping) = &snapshot.mapping {
            sqlx::query("UPDATE external_event_mappings SET canonical_event_id=$2,local_deleted=FALSE,local_dirty=FALSE,reversible_tombstone=FALSE,deletion_hold_until=NULL WHERE id=$1")
                .bind(id(mapping,"id")?).bind(id(snapshot.event.as_ref().ok_or_else(changed)?,"id")?).execute(&mut *tx).await?;
        }
        let consumed = sqlx::query("DELETE FROM task_delete_undos WHERE id=$1 AND user_id=$2 AND expires_at > clock_timestamp()")
            .bind(receipt).bind(user).execute(&mut *tx).await?;
        if consumed.rows_affected() != 1 {
            return Err(changed());
        }
        tx.commit().await?;
        Ok(())
    }
}

async fn google_account_guard(connection: &mut PgConnection, user: Uuid) -> AppResult<Value> {
    // Never copy credentials into the receipt. Token refresh does not change identity.
    sqlx::query_scalar("SELECT jsonb_build_object('user_id',user_id,'connected_at',connected_at,'scopes',scopes) FROM google_accounts WHERE user_id=$1 FOR SHARE NOWAIT")
        .bind(user).fetch_optional(connection).await?.ok_or_else(changed)
}

fn calendar_guard(mut value: Value) -> Value {
    if let Some(row) = value.as_object_mut() {
        for key in [
            "sync_token",
            "last_synced_at",
            "last_sync_error",
            "updated_at",
        ] {
            row.remove(key);
        }
    }
    value
}

fn capacity() -> AppError {
    AppError::Validation("Reversible deletion exceeds its safety limits (100 active receipts, 4 MiB per owner, 1 MiB per snapshot, 64 notes, 128 attachments, 32 focus dates). Nothing was deleted.".into())
}
fn google_refusal() -> AppError {
    AppError::Conflict("This Google-linked task cannot be reversibly deleted. Synchronize it, resolve conflicts, and use the selected writable preferred time-block calendar before retrying. Nothing was deleted.".into())
}
fn cap(rows: &[Value], max: usize) -> AppResult<()> {
    if rows.len() > max {
        Err(capacity())
    } else {
        Ok(())
    }
}

async fn lock(connection: &mut PgConnection, user: Uuid) -> AppResult<()> {
    // Lock order: synchronization, task graph, owner, task/event, dependents,
    // revisions/dependency rows, mapping, receipt. All new waits are bounded.
    sqlx::query("SET LOCAL lock_timeout='100ms'")
        .execute(&mut *connection)
        .await?;
    for namespace in [format!("prosepect-sync:{user}"), user.to_string()] {
        let available: bool =
            sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))")
                .bind(namespace)
                .fetch_one(&mut *connection)
                .await?;
        if !available {
            return Err(changed());
        }
    }
    let owner: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM users WHERE id=$1 FOR UPDATE NOWAIT")
            .bind(user)
            .fetch_optional(connection)
            .await?;
    if owner.is_none() {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}
async fn revision(connection: &mut PgConnection, user: Uuid, scope: &str) -> AppResult<i64> {
    sqlx::query("INSERT INTO task_delete_guard_revisions(user_id,scope) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(user).bind(scope).execute(&mut *connection).await?;
    Ok(sqlx::query_scalar("SELECT revision FROM task_delete_guard_revisions WHERE user_id=$1 AND scope=$2 FOR UPDATE NOWAIT")
        .bind(user).bind(scope).fetch_one(connection).await?)
}
async fn row(
    connection: &mut PgConnection,
    table: &str,
    user: Uuid,
    key: Uuid,
) -> AppResult<Option<Value>> {
    let query = match table {
        "tasks" => "SELECT to_jsonb(r) FROM tasks r WHERE user_id=$1 AND id=$2 FOR UPDATE NOWAIT",
        "projects" => {
            "SELECT to_jsonb(r) FROM projects r WHERE user_id=$1 AND id=$2 FOR UPDATE NOWAIT"
        }
        "calendars" => {
            "SELECT to_jsonb(r) FROM calendars r WHERE user_id=$1 AND id=$2 FOR UPDATE NOWAIT"
        }
        "files" => "SELECT to_jsonb(r) FROM files r WHERE user_id=$1 AND id=$2 FOR UPDATE NOWAIT",
        _ => return Err(changed()),
    };
    Ok(sqlx::query_scalar(query)
        .bind(user)
        .bind(key)
        .fetch_optional(connection)
        .await?)
}
async fn guard(
    connection: &mut PgConnection,
    table: &str,
    user: Uuid,
    expected: &Value,
) -> AppResult<()> {
    if row(connection, table, user, id(expected, "id")?)
        .await?
        .as_ref()
        != Some(expected)
    {
        return Err(changed());
    }
    Ok(())
}
async fn insert_versioned(
    connection: &mut PgConnection,
    table: &str,
    value: &Value,
) -> AppResult<()> {
    let query = match table {
        "tasks" => {
            "INSERT INTO tasks SELECT * FROM jsonb_populate_record(NULL::tasks,$1 || jsonb_build_object('version',($1->>'version')::integer+1,'updated_at',clock_timestamp()))"
        }
        "calendar_events" => {
            "INSERT INTO calendar_events SELECT * FROM jsonb_populate_record(NULL::calendar_events,$1 || jsonb_build_object('version',($1->>'version')::integer+1,'updated_at',clock_timestamp()))"
        }
        "notes" => {
            "INSERT INTO notes SELECT * FROM jsonb_populate_record(NULL::notes,$1 || jsonb_build_object('version',($1->>'version')::integer+1,'updated_at',clock_timestamp()))"
        }
        _ => return Err(changed()),
    };
    sqlx::query(query).bind(value).execute(connection).await?;
    Ok(())
}
