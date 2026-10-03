//! Shared Google Tasks fields and conservative three-way reconciliation.
//!
//! Google's `due` is a calendar day, not a precise deadline. Date projection
//! belongs at the persistence boundary, using the connection's fixed timezone.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

pub const TASKS_SCOPE: &str = "https://www.googleapis.com/auth/tasks";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
pub struct TaskFields {
    pub title: String,
    pub date: Option<NaiveDate>,
    pub completed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictField {
    Title,
    Date,
    Completion,
}

/// Merge independent changes, never silently choose a winner for the same field.
/// Identical edits on both sides converge without a write-back loop.
pub fn reconcile(
    baseline: &TaskFields,
    local: &TaskFields,
    remote: &TaskFields,
) -> Result<TaskFields, ConflictField> {
    Ok(TaskFields {
        title: merge(&baseline.title, &local.title, &remote.title).ok_or(ConflictField::Title)?,
        date: merge(&baseline.date, &local.date, &remote.date).ok_or(ConflictField::Date)?,
        completed: merge(&baseline.completed, &local.completed, &remote.completed)
            .ok_or(ConflictField::Completion)?,
    })
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TaskConflictChoice {
    Google,
    Prosepect,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct GoogleTaskConflict {
    pub id: uuid::Uuid,
    pub link_id: uuid::Uuid,
    pub task_id: uuid::Uuid,
    pub task_version: i32,
    pub remote_etag: String,
    pub local: TaskFields,
    pub google: TaskFields,
}

/// Resolve only divergent fields; independent edits still merge normally.
pub fn resolve_conflicting_fields(
    baseline: &TaskFields,
    local: &TaskFields,
    remote: &TaskFields,
    choice: TaskConflictChoice,
) -> TaskFields {
    let preferred = match choice {
        TaskConflictChoice::Google => remote,
        TaskConflictChoice::Prosepect => local,
    };
    TaskFields {
        title: merge(&baseline.title, &local.title, &remote.title)
            .unwrap_or_else(|| preferred.title.clone()),
        date: merge(&baseline.date, &local.date, &remote.date).unwrap_or(preferred.date),
        completed: merge(&baseline.completed, &local.completed, &remote.completed)
            .unwrap_or(preferred.completed),
    }
}

fn merge<T: Clone + PartialEq>(baseline: &T, local: &T, remote: &T) -> Option<T> {
    if local == remote || remote == baseline {
        Some(local.clone())
    } else if local == baseline {
        Some(remote.clone())
    } else {
        None
    }
}

impl TaskFields {
    /// Validate before touching either app. Google allows longer titles than
    /// prosepect; truncation would silently destroy the user's remote content.
    pub fn valid(&self) -> bool {
        !self.title.trim().is_empty() && self.title.trim().chars().count() <= 240
    }

    pub fn google_body(&self) -> serde_json::Value {
        serde_json::json!({
            "title": self.title,
            "due": self.date.map(|date| format!("{date}T00:00:00.000Z")),
            "status": if self.completed { "completed" } else { "needsAction" },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original() -> TaskFields {
        TaskFields {
            title: "Proposal".into(),
            date: Some(NaiveDate::from_ymd_opt(2026, 10, 2).unwrap()),
            completed: false,
        }
    }

    #[test]
    fn unchanged_fields_do_not_generate_spurious_updates() {
        let base = original();
        assert_eq!(reconcile(&base, &base, &base), Ok(base));
    }

    #[test]
    fn independent_changes_merge_in_both_directions() {
        let base = original();
        let local = TaskFields {
            title: "Revised proposal".into(),
            ..base.clone()
        };
        let remote = TaskFields {
            date: None,
            completed: true,
            ..base.clone()
        };
        let expected = TaskFields {
            title: local.title.clone(),
            ..remote.clone()
        };
        assert_eq!(reconcile(&base, &local, &remote), Ok(expected.clone()));
        assert_eq!(reconcile(&base, &remote, &local), Ok(expected));
    }

    #[test]
    fn concurrent_title_or_date_edits_require_resolution() {
        let base = original();
        let local = TaskFields {
            title: "Local title".into(),
            ..base.clone()
        };
        let remote = TaskFields {
            title: "Remote title".into(),
            ..base.clone()
        };
        assert_eq!(reconcile(&base, &local, &remote), Err(ConflictField::Title));
        let local = TaskFields {
            date: None,
            ..base.clone()
        };
        let remote = TaskFields {
            date: Some(NaiveDate::from_ymd_opt(2026, 10, 3).unwrap()),
            ..base.clone()
        };
        assert_eq!(reconcile(&base, &local, &remote), Err(ConflictField::Date));
    }

    #[test]
    fn matching_edits_converge_and_google_reopening_is_supported() {
        let base = original();
        let completed = TaskFields {
            completed: true,
            ..base.clone()
        };
        assert_eq!(
            reconcile(&base, &completed, &completed),
            Ok(completed.clone())
        );
        assert_eq!(reconcile(&completed, &completed, &base), Ok(base));
    }

    #[test]
    fn google_projection_contains_no_calendar_block_or_private_metadata() {
        let fields = original();
        assert_eq!(
            fields.google_body(),
            serde_json::json!({
                "title": "Proposal", "due": "2026-10-02T00:00:00.000Z", "status": "needsAction"
            })
        );
        let cleared = TaskFields {
            date: None,
            ..fields
        };
        assert!(cleared.google_body()["due"].is_null());
    }

    #[test]
    fn invalid_remote_titles_are_not_truncated() {
        let mut fields = original();
        fields.title = " ".into();
        assert!(!fields.valid());
        fields.title = "a".repeat(241);
        assert!(!fields.valid());
        fields.title = "é".repeat(240);
        assert!(fields.valid());
    }
}
