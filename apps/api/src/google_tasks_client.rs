//! Bounded Google Tasks transport. No automatic retries for provider writes.
//! A failed create may already exist remotely and must be reconciled by the caller.

use std::{collections::HashSet, fmt, time::Duration};

use chrono::DateTime;
use reqwest::{Client, Method, StatusCode, Url};
use serde::Deserialize;
use serde_json::Value;

use crate::google_tasks::TaskFields;

const API_BASE: &str = "https://tasks.googleapis.com/tasks/v1/";
const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_LIST_BYTES: usize = 32 * 1024 * 1024;
const MAX_ITEMS: usize = 20_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TasksError {
    Authorization,
    NotFound,
    Conflict,
    RateLimited,
    Unavailable,
    InvalidResponse,
    InvalidInput,
    Capacity,
    AmbiguousCreate,
}

impl fmt::Display for TasksError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Authorization => "Google Tasks access is unavailable. Check permission and API enablement.",
            Self::NotFound => "The Google task or list no longer exists.",
            Self::Conflict => "The Google task changed. Refresh before trying again.",
            Self::RateLimited => "Google Tasks is rate limited. Try again later.",
            Self::Unavailable => "Google Tasks is temporarily unavailable.",
            Self::InvalidResponse => "Google Tasks returned an incomplete or invalid response.",
            Self::InvalidInput => "The task cannot be represented safely in Google Tasks.",
            Self::Capacity => "The Google task list exceeds the supported synchronization size.",
            Self::AmbiguousCreate => "Google may have created the task or list. Reconcile it before creating another copy.",
        })
    }
}
impl std::error::Error for TasksError {}

type Result<T> = std::result::Result<T, TasksError>;

#[derive(Debug, Clone, Deserialize)]
pub struct GoogleTask {
    pub id: String,
    pub etag: Option<String>,
    #[serde(default)]
    pub title: String,
    pub due: Option<String>,
    pub status: Option<String>,
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub hidden: bool,
    pub notes: Option<String>,
    #[serde(rename = "assignmentInfo")]
    pub assignment_info: Option<Value>,
}

impl GoogleTask {
    pub fn fields(&self) -> Result<TaskFields> {
        if self.id.is_empty() || self.deleted || self.assignment_info.is_some() {
            return Err(TasksError::InvalidInput);
        }
        let completed = match self.status.as_deref() {
            Some("completed") => true,
            Some("needsAction") => false,
            _ => return Err(TasksError::InvalidResponse),
        };
        let date = self
            .due
            .as_deref()
            .map(|due| {
                DateTime::parse_from_rfc3339(due)
                    // This is a date, not an instant to convert to UTC/local time.
                    .map(|value| value.date_naive())
                    .map_err(|_| TasksError::InvalidResponse)
            })
            .transpose()?;
        let fields = TaskFields {
            title: self.title.trim().to_owned(),
            date,
            completed,
        };
        if !fields.valid() {
            return Err(TasksError::InvalidInput);
        }
        Ok(fields)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GoogleTaskList {
    pub id: String,
    pub title: String,
}

#[derive(Deserialize)]
struct Page<T> {
    #[serde(default = "Vec::new")]
    items: Vec<T>,
    #[serde(rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Clone)]
pub struct GoogleTasksClient {
    http: Client,
    base: Url,
}

impl GoogleTasksClient {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            http: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                .build()?,
            base: Url::parse(API_BASE)?,
        })
    }

    /// Explicit fixture endpoint, never populated from user/API input.
    pub fn with_api_base(mut self, base: Url) -> Self {
        self.base = base;
        self
    }

    fn url(&self, segments: &[&str]) -> Result<Url> {
        let mut url = self.base.clone();
        url.set_query(None);
        url.set_fragment(None);
        let mut path = url
            .path_segments_mut()
            .map_err(|_| TasksError::InvalidInput)?;
        path.pop_if_empty();
        for segment in segments {
            if segment.is_empty() || matches!(*segment, "." | "..") {
                return Err(TasksError::InvalidInput);
            }
            path.push(segment);
        }
        drop(path);
        Ok(url)
    }

    async fn request(
        &self,
        token: &str,
        method: Method,
        url: Url,
        body: Option<&Value>,
        etag: Option<&str>,
    ) -> Result<Vec<u8>> {
        if token.is_empty() {
            return Err(TasksError::Authorization);
        }
        let creating = method == Method::POST;
        let mut request = self.http.request(method, url).bearer_auth(token);
        if let Some(body) = body {
            request = request.json(body);
        }
        if let Some(etag) = etag {
            request = request.header(reqwest::header::IF_MATCH, etag);
        }
        // Do not log provider bodies, token-bearing requests, or resource URLs.
        let mut response = request.send().await.map_err(|_| {
            if creating {
                TasksError::AmbiguousCreate
            } else {
                TasksError::Unavailable
            }
        })?;
        let status = response.status();
        if !status.is_success() {
            return Err(match status {
                StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => TasksError::Authorization,
                StatusCode::NOT_FOUND | StatusCode::GONE => TasksError::NotFound,
                StatusCode::PRECONDITION_FAILED | StatusCode::CONFLICT => TasksError::Conflict,
                StatusCode::TOO_MANY_REQUESTS => TasksError::RateLimited,
                _ if status.is_client_error() => TasksError::InvalidInput,
                _ if creating => TasksError::AmbiguousCreate,
                _ => TasksError::Unavailable,
            });
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            if creating {
                TasksError::AmbiguousCreate
            } else {
                TasksError::Unavailable
            }
        })? {
            if bytes.len() + chunk.len() > MAX_PAGE_BYTES {
                return Err(if creating {
                    TasksError::AmbiguousCreate
                } else {
                    TasksError::Capacity
                });
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    async fn pages<T: serde::de::DeserializeOwned>(&self, token: &str, url: Url) -> Result<Vec<T>> {
        tokio::time::timeout(Duration::from_secs(120), self.pages_inner(token, url))
            .await
            .map_err(|_| TasksError::Unavailable)?
    }

    async fn pages_inner<T: serde::de::DeserializeOwned>(
        &self,
        token: &str,
        url: Url,
    ) -> Result<Vec<T>> {
        let mut items = Vec::new();
        let mut seen = HashSet::new();
        let mut next = None;
        let mut bytes_read = 0;
        loop {
            let mut page_url = url.clone();
            page_url.query_pairs_mut().append_pair("maxResults", "100");
            if let Some(cursor) = next.as_deref() {
                page_url.query_pairs_mut().append_pair("pageToken", cursor);
            }
            let bytes = self
                .request(token, Method::GET, page_url, None, None)
                .await?;
            bytes_read += bytes.len();
            if bytes_read > MAX_LIST_BYTES {
                return Err(TasksError::Capacity);
            }
            let page: Page<T> =
                serde_json::from_slice(&bytes).map_err(|_| TasksError::InvalidResponse)?;
            if items.len() + page.items.len() > MAX_ITEMS {
                return Err(TasksError::Capacity);
            }
            items.extend(page.items);
            match page.next_page_token {
                None => return Ok(items),
                Some(cursor) if !cursor.is_empty() && seen.insert(cursor.clone()) => {
                    next = Some(cursor)
                }
                _ => return Err(TasksError::InvalidResponse),
            }
            if seen.len() > 1000 {
                return Err(TasksError::Capacity);
            }
        }
    }

    pub async fn lists(&self, token: &str) -> Result<Vec<GoogleTaskList>> {
        self.pages(token, self.url(&["users", "@me", "lists"])?)
            .await
    }

    pub async fn tasks(&self, token: &str, list: &str) -> Result<Vec<GoogleTask>> {
        let mut url = self.url(&["lists", list, "tasks"])?;
        url.query_pairs_mut()
            .append_pair("showCompleted", "true")
            .append_pair("showHidden", "true")
            .append_pair("showDeleted", "true")
            .append_pair("showAssigned", "false");
        let tasks: Vec<GoogleTask> = self.pages(token, url).await?;
        let mut identities = HashSet::new();
        if tasks
            .iter()
            .any(|task| task.id.is_empty() || !identities.insert(task.id.as_str()))
        {
            return Err(TasksError::InvalidResponse);
        }
        Ok(tasks)
    }

    pub async fn get(&self, token: &str, list: &str, task: &str) -> Result<GoogleTask> {
        let bytes = self
            .request(
                token,
                Method::GET,
                self.url(&["lists", list, "tasks", task])?,
                None,
                None,
            )
            .await?;
        let remote: GoogleTask =
            serde_json::from_slice(&bytes).map_err(|_| TasksError::InvalidResponse)?;
        if remote.id != task {
            return Err(TasksError::InvalidResponse);
        }
        Ok(remote)
    }

    pub async fn create_list(&self, token: &str) -> Result<GoogleTaskList> {
        let body = serde_json::json!({"title":"prosepect"});
        let bytes = self
            .request(
                token,
                Method::POST,
                self.url(&["users", "@me", "lists"])?,
                Some(&body),
                None,
            )
            .await?;
        let list: GoogleTaskList =
            serde_json::from_slice(&bytes).map_err(|_| TasksError::AmbiguousCreate)?;
        if list.id.is_empty() {
            return Err(TasksError::AmbiguousCreate);
        }
        Ok(list)
    }

    pub async fn create(
        &self,
        token: &str,
        list: &str,
        fields: &TaskFields,
        reference: &str,
    ) -> Result<GoogleTask> {
        if !fields.valid() || reference.chars().count() > 8192 {
            return Err(TasksError::InvalidInput);
        }
        let mut body = fields.google_body();
        // A human-readable provenance link permits recovery of an uncertain create.
        // Subsequent patches never overwrite the user's Google notes.
        body["notes"] = Value::String(reference.to_owned());
        let bytes = self
            .request(
                token,
                Method::POST,
                self.url(&["lists", list, "tasks"])?,
                Some(&body),
                None,
            )
            .await?;
        let remote: GoogleTask =
            serde_json::from_slice(&bytes).map_err(|_| TasksError::AmbiguousCreate)?;
        if remote.id.is_empty() || remote.etag.as_deref().is_none_or(str::is_empty) {
            return Err(TasksError::AmbiguousCreate);
        }
        Ok(remote)
    }

    pub async fn update(
        &self,
        token: &str,
        list: &str,
        task: &str,
        etag: &str,
        fields: &TaskFields,
    ) -> Result<GoogleTask> {
        if etag.trim().is_empty() || etag.trim() == "*" || !fields.valid() {
            return Err(TasksError::InvalidInput);
        }
        let bytes = self
            .request(
                token,
                Method::PATCH,
                self.url(&["lists", list, "tasks", task])?,
                Some(&fields.google_body()),
                Some(etag),
            )
            .await?;
        let remote: GoogleTask =
            serde_json::from_slice(&bytes).map_err(|_| TasksError::InvalidResponse)?;
        if remote.id != task || remote.etag.as_deref().is_none_or(str::is_empty) {
            return Err(TasksError::InvalidResponse);
        }
        Ok(remote)
    }
}
