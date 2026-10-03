//! Google Tasks reconciliation under the dispatcher's existing owner exclusion.
//! Provider requests never hold a task row/graph transaction or reserve a pool connection.
use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, bail};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    google_tasks::{
        GoogleTaskConflict, TaskConflictChoice, TaskFields, reconcile, resolve_conflicting_fields,
    },
    google_tasks_client::{GoogleTask, TasksError},
    models::{Task, TaskStatus, UpdateTaskRequest},
    store::Store,
    sync_service::SyncService,
};

#[derive(FromRow)]
struct Link {
    id: Uuid,
    task_id: Uuid,
    external_task_id: Option<String>,
    baseline: Option<Value>,
    phase: String,
    create_reference: Option<String>,
    conflict: Option<Value>,
    resolution: Option<String>,
}

struct TaskSyncContext<'a> {
    user: Uuid,
    list: &'a str,
    timezone: &'a str,
    token: &'a str,
    snapshot: &'a HashMap<&'a str, &'a GoogleTask>,
    remote: &'a [GoogleTask],
}

impl SyncService {
    pub(crate) async fn sync_google_tasks(&self, user: Uuid) -> Result<()> {
        let result = self.sync_google_tasks_inner(user).await;
        // Public status contains only a fixed, sanitized message; never provider bodies.
        let message = result.as_ref().err().map(
            |_| "Google Tasks sync needs attention. Check permission, task conflicts, and retry.",
        );
        sqlx::query("UPDATE google_task_connections SET last_error=$2,last_synced_at=CASE WHEN $2::TEXT IS NULL THEN NOW() ELSE last_synced_at END WHERE user_id=$1")
            .bind(user).bind(message).execute(&self.store.pool).await?;
        result
    }

    async fn sync_google_tasks_inner(&self, user: Uuid) -> Result<()> {
        let connection = self.store.google_tasks_status(user).await?;
        if !connection.enabled {
            return Ok(());
        }
        if !connection.authorized {
            bail!("Google Tasks permission is required");
        }
        let list = connection
            .task_list_id
            .context("Missing Google Tasks list")?;
        let timezone = connection
            .timezone
            .context("Missing Google Tasks timezone")?;
        let token = self.access_token(user).await?;
        // Obtain a COMPLETE bounded snapshot before mutation. Missing pages must
        // never be interpreted as remote deletion or a missing create outcome.
        let remote = self.tasks_client.tasks(&token, &list).await?;
        let by_id: HashMap<_, _> = remote.iter().map(|task| (task.id.as_str(), task)).collect();
        let local: Vec<Task> =
            sqlx::query_as("SELECT * FROM tasks WHERE user_id=$1 ORDER BY id LIMIT 20001")
                .bind(user)
                .fetch_all(&self.store.pool)
                .await?;
        if local.len() > 20_000 {
            bail!("Too many tasks to synchronize safely");
        }
        // Prepare durably BEFORE sending POST. Existing creating intents are never
        // blindly retried; recovery first looks for the exact provenance marker.
        for task in &local {
            let fields = self.store.google_task_fields(task, &timezone).await?;
            let id = Uuid::now_v7();
            sqlx::query("INSERT INTO google_task_links(id,user_id,task_list_id,task_id,baseline,phase,create_reference) VALUES($1,$2,$3,$4,$5,'prepared',$6) ON CONFLICT(user_id,task_list_id,task_id) DO NOTHING")
                .bind(id).bind(user).bind(&list).bind(task.id).bind(serde_json::to_value(fields)?)
                .bind(format!("prosepect task reference: {id}")).execute(&self.store.pool).await?;
        }
        let links: Vec<Link> = sqlx::query_as("SELECT id,task_id,external_task_id,baseline,phase,create_reference,conflict,resolution FROM google_task_links WHERE user_id=$1 AND task_list_id=$2 ORDER BY id")
            .bind(user).bind(&list).fetch_all(&self.store.pool).await?;
        let mut known: HashSet<String> = links
            .iter()
            .filter_map(|link| link.external_task_id.clone())
            .collect();
        let mut unresolved = false;
        // Any provenance-bearing remote must be reconciled as an intent, never
        // silently imported if the outgoing mapping's final INSERT failed.
        let references: HashSet<_> = links
            .iter()
            .filter_map(|link| link.create_reference.as_deref())
            .collect();
        let context = TaskSyncContext {
            user,
            list: &list,
            timezone: &timezone,
            token: &token,
            snapshot: &by_id,
            remote: &remote,
        };
        for link in &links {
            let outcome = self.sync_google_task_link(&context, link).await;
            match outcome {
                Ok(Some(id)) => {
                    known.insert(id);
                }
                Ok(None) => {}
                Err(_) => {
                    unresolved = true;
                    sqlx::query("UPDATE google_task_links SET last_error='Task synchronization paused. Resolve conflicting edits or an uncertain creation before retrying.',updated_at=NOW() WHERE id=$1 AND user_id=$2")
                        .bind(link.id).bind(user).execute(&self.store.pool).await?;
                }
            }
        }
        for task in &remote {
            if task.deleted
                || task.assignment_info.is_some()
                || known.contains(&task.id)
                || task
                    .notes
                    .as_deref()
                    .is_some_and(|notes| references.contains(notes))
            {
                continue;
            }
            // Validate BEFORE import; never coerce unsupported titles/statuses.
            let fields = match task.fields() {
                Ok(fields) => fields,
                Err(_) => {
                    unresolved = true;
                    continue;
                }
            };
            let Some(etag) = task.etag.as_deref().filter(|etag| !etag.is_empty()) else {
                unresolved = true;
                continue;
            };
            self.store
                .import_google_task(user, &list, &timezone, task, etag, &fields)
                .await?;
        }
        if unresolved {
            bail!("Google Tasks has unresolved task changes or uncertain creations");
        }
        Ok(())
    }

    async fn sync_google_task_link(
        &self,
        context: &TaskSyncContext<'_>,
        link: &Link,
    ) -> Result<Option<String>> {
        let user = context.user;
        let list = context.list;
        let timezone = context.timezone;
        let token = context.token;
        let snapshot = context.snapshot;
        let remote = context.remote;
        if link.phase == "detached" {
            return Ok(None);
        }
        let holding: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM task_delete_undos WHERE user_id=$1 AND task_id=$2 AND expires_at>clock_timestamp())")
            .bind(user).bind(link.task_id).fetch_one(&self.store.pool).await?;
        if holding {
            return Ok(None);
        }
        let task: Option<Task> = sqlx::query_as("SELECT * FROM tasks WHERE user_id=$1 AND id=$2")
            .bind(user)
            .bind(link.task_id)
            .fetch_optional(&self.store.pool)
            .await?;
        let Some(task) = task else {
            // Deletion is unlinking, not destructive propagation. Preserve the
            // remote copy and retain its identity to prevent later resurrection.
            self.detach_google_task(user, link.id).await?;
            return Ok(None);
        };
        if link.phase == "creating" {
            let reference = link
                .create_reference
                .as_deref()
                .context("Missing create reference")?;
            let candidates: Vec<_> = remote
                .iter()
                .filter(|task| task.notes.as_deref() == Some(reference))
                .collect();
            if candidates.len() != 1 {
                bail!("Uncertain create requires explicit recovery");
            }
            let candidate = candidates[0];
            let sent: TaskFields =
                serde_json::from_value(link.baseline.clone().context("Missing create baseline")?)?;
            if candidate.fields()? != sent {
                bail!("Uncertain created task changed");
            }
            self.record_google_task_link(user, link.id, candidate, &sent)
                .await?;
            return Ok(Some(candidate.id.clone()));
        }
        let local = self.store.google_task_fields(&task, timezone).await?;
        if link.phase == "prepared" {
            // Capture the latest shared fields at the claim, not the old prepared
            // snapshot. Exactly one claim can send the create request.
            let claimed = sqlx::query("UPDATE google_task_links SET phase='creating',baseline=$3,updated_at=NOW() WHERE id=$1 AND user_id=$2 AND phase='prepared'")
                .bind(link.id).bind(user).bind(serde_json::to_value(&local)?).execute(&self.store.pool).await?;
            if claimed.rows_affected() != 1 {
                bail!("Create already claimed");
            }
            let reference = link
                .create_reference
                .as_deref()
                .context("Missing create reference")?;
            let created = self
                .tasks_client
                .create(token, list, &local, reference)
                .await;
            let created = match created {
                Ok(created) => created,
                Err(error) => {
                    // Only proven request rejections are safe to retry. Network,
                    // server and malformed-success outcomes remain 'creating'.
                    if matches!(
                        error,
                        TasksError::Authorization
                            | TasksError::NotFound
                            | TasksError::InvalidInput
                            | TasksError::RateLimited
                            | TasksError::Conflict
                    ) {
                        sqlx::query("UPDATE google_task_links SET phase='prepared',updated_at=NOW() WHERE id=$1 AND user_id=$2 AND phase='creating'")
                            .bind(link.id).bind(user).execute(&self.store.pool).await?;
                    }
                    return Err(error.into());
                }
            };
            if created.fields()? != local {
                bail!("Created task did not match requested fields");
            }
            self.record_google_task_link(user, link.id, &created, &local)
                .await?;
            return Ok(Some(created.id));
        }
        let identity = link
            .external_task_id
            .as_deref()
            .context("Missing remote identity")?;
        // A missing list entry is not sufficient evidence of deletion. Confirm
        // identity directly (including entries hidden/cleared by Google's UI).
        let fetched;
        let remote = match snapshot.get(identity) {
            Some(task) => *task,
            None => match self.tasks_client.get(token, list, identity).await {
                Ok(task) => {
                    fetched = task;
                    &fetched
                }
                Err(TasksError::NotFound) => {
                    self.detach_google_task(user, link.id).await?;
                    return Ok(None);
                }
                Err(error) => return Err(error.into()),
            },
        };
        if remote.deleted {
            self.detach_google_task(user, link.id).await?;
            return Ok(None);
        }
        let remote_fields = remote.fields()?;
        let baseline: TaskFields =
            serde_json::from_value(link.baseline.clone().context("Missing baseline")?)?;
        let merged = match reconcile(&baseline, &local, &remote_fields) {
            Ok(merged) => merged,
            Err(_) => {
                let previous = link
                    .conflict
                    .as_ref()
                    .map(|value| serde_json::from_value::<GoogleTaskConflict>(value.clone()))
                    .transpose()?;
                let current = previous.as_ref().is_some_and(|conflict| {
                    conflict.task_version == task.version
                        && conflict.local == local
                        && conflict.google == remote_fields
                        && Some(conflict.remote_etag.as_str()) == remote.etag.as_deref()
                });
                let choice = if current {
                    link.resolution.as_deref()
                } else {
                    None
                };
                match choice {
                    Some("google" | "prosepect") => resolve_conflicting_fields(
                        &baseline,
                        &local,
                        &remote_fields,
                        if choice == Some("google") {
                            TaskConflictChoice::Google
                        } else {
                            TaskConflictChoice::Prosepect
                        },
                    ),
                    _ => {
                        if !current {
                            let conflict = GoogleTaskConflict {
                                id: Uuid::now_v7(),
                                link_id: link.id,
                                task_id: task.id,
                                task_version: task.version,
                                remote_etag: remote
                                    .etag
                                    .clone()
                                    .context("Missing conflict ETag")?,
                                local,
                                google: remote_fields,
                            };
                            sqlx::query("UPDATE google_task_links SET conflict=$3,resolution=NULL,updated_at=NOW() WHERE user_id=$1 AND id=$2")
                                .bind(user).bind(link.id).bind(serde_json::to_value(conflict)?)
                                .execute(&self.store.pool).await?;
                        }
                        bail!("Both apps changed the same task field");
                    }
                }
            }
        };
        let mut acknowledged = remote.clone();
        if merged != remote_fields {
            let etag = remote.etag.as_deref().context("Missing provider ETag")?;
            acknowledged = self
                .tasks_client
                .update(token, list, identity, etag, &merged)
                .await?;
            if acknowledged.fields()? != merged {
                bail!("Provider did not acknowledge merged task fields");
            }
        }
        if merged != local {
            let due_at = if merged.date == local.date {
                task.due_at
            } else {
                self.store
                    .google_task_deadline(merged.date, task.due_at, timezone)
                    .await?
            };
            let status = if merged.completed == local.completed {
                task.status
            } else if merged.completed {
                TaskStatus::Completed
            } else {
                TaskStatus::Todo
            };
            // Use the existing versioned task path to preserve recurrence,
            // calendar mirrors, labels, parents and all non-synchronized fields.
            self.store
                .update_task(
                    user,
                    task.id,
                    UpdateTaskRequest {
                        project_id: task.project_id,
                        parent_task_id: task.parent_task_id,
                        title: merged.title.clone(),
                        description: task.description,
                        due_at,
                        scheduled_start: task.scheduled_start,
                        scheduled_end: task.scheduled_end,
                        status,
                        priority: task.priority,
                        recurrence: task.recurrence,
                        labels: task.labels,
                        remind_at: task.remind_at,
                        expected_version: task.version,
                    },
                )
                .await?;
        }
        self.record_google_task_link(user, link.id, &acknowledged, &merged)
            .await?;
        Ok(Some(identity.to_owned()))
    }

    async fn record_google_task_link(
        &self,
        user: Uuid,
        link: Uuid,
        task: &GoogleTask,
        fields: &TaskFields,
    ) -> Result<()> {
        let etag = task
            .etag
            .as_deref()
            .filter(|etag| !etag.is_empty())
            .context("Missing acknowledged ETag")?;
        sqlx::query("UPDATE google_task_links SET phase='linked',external_task_id=$3,external_etag=$4,baseline=$5,conflict=NULL,resolution=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1 AND user_id=$2")
            .bind(link).bind(user).bind(&task.id).bind(etag).bind(serde_json::to_value(fields)?).execute(&self.store.pool).await?;
        Ok(())
    }

    async fn detach_google_task(&self, user: Uuid, link: Uuid) -> Result<()> {
        sqlx::query("UPDATE google_task_links SET phase='detached',conflict=NULL,resolution=NULL,last_error=NULL,updated_at=NOW() WHERE id=$1 AND user_id=$2")
            .bind(link).bind(user).execute(&self.store.pool).await?;
        Ok(())
    }
}

impl Store {
    async fn google_task_fields(&self, task: &Task, timezone: &str) -> Result<TaskFields> {
        let date = sqlx::query_scalar("SELECT ($1::TIMESTAMPTZ AT TIME ZONE $2)::DATE")
            .bind(task.due_at)
            .bind(timezone)
            .fetch_one(&self.pool)
            .await?;
        Ok(TaskFields {
            title: task.title.clone(),
            date,
            completed: task.status == TaskStatus::Completed,
        })
    }

    async fn import_google_task(
        &self,
        user: Uuid,
        list: &str,
        timezone: &str,
        remote: &GoogleTask,
        etag: &str,
        fields: &TaskFields,
    ) -> Result<()> {
        let deadline = self
            .google_task_deadline(fields.date, None, timezone)
            .await?;
        let mut tx = self.pool.begin().await?;
        Self::lock_task_graph(&mut tx, user).await?;
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM google_task_links WHERE user_id=$1 AND task_list_id=$2 AND external_task_id=$3)")
            .bind(user).bind(list).bind(&remote.id).fetch_one(&mut *tx).await?;
        if exists {
            tx.rollback().await?;
            return Ok(());
        }
        let task = Uuid::now_v7();
        sqlx::query("INSERT INTO tasks(id,user_id,title,due_at,status,completed_at,position) VALUES($1,$2,$3,$4,$5,CASE WHEN $5='completed' THEN NOW() ELSE NULL END,(SELECT COALESCE(MAX(position),0)+1 FROM tasks WHERE user_id=$2))")
            .bind(task).bind(user).bind(fields.title.trim()).bind(deadline)
            .bind(if fields.completed { "completed" } else { "todo" }).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO google_task_links(id,user_id,task_list_id,task_id,external_task_id,external_etag,baseline,phase) VALUES($1,$2,$3,$4,$5,$6,$7,'linked')")
            .bind(Uuid::now_v7()).bind(user).bind(list).bind(task).bind(&remote.id).bind(etag)
            .bind(serde_json::to_value(fields)?).execute(&mut *tx).await?;
        // Canonical import and mapping are one transaction: no persistence gap.
        tx.commit().await?;
        Ok(())
    }
}
