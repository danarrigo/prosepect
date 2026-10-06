use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    app::AppState,
    auth::CurrentUser,
    error::{AppError, AppResult, ErrorResponse},
    extract::ApiJson,
    models::TaskPriority,
    store::Store,
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum SavedTaskStatus {
    Open,
    All,
    Todo,
    InProgress,
    Blocked,
    Completed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, sqlx::Type, ToSchema)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum SavedTaskSort {
    Manual,
    Due,
    Priority,
    Title,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CreateSavedTaskView {
    pub name: String,
    pub project_id: Option<Uuid>,
    pub search: String,
    pub status: SavedTaskStatus,
    pub priority: Option<TaskPriority>,
    pub label: Option<String>,
    pub sort: SavedTaskSort,
}

#[derive(Debug, Serialize, FromRow, ToSchema)]
pub struct SavedTaskView {
    pub id: Uuid,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub search: String,
    pub status: SavedTaskStatus,
    pub priority: Option<TaskPriority>,
    pub label: Option<String>,
    pub sort: SavedTaskSort,
    pub created_at: DateTime<Utc>,
}

impl Store {
    pub async fn saved_task_views(&self, user: Uuid) -> AppResult<Vec<SavedTaskView>> {
        Ok(sqlx::query_as("SELECT id,project_id,name,search,status,priority,label,sort,created_at FROM saved_task_views WHERE user_id=$1 ORDER BY lower(name),id LIMIT 50")
            .bind(user).fetch_all(&self.pool).await?)
    }

    pub async fn create_saved_task_view(
        &self,
        user: Uuid,
        request: CreateSavedTaskView,
    ) -> AppResult<SavedTaskView> {
        let name = request.name.trim();
        let search = request.search.trim();
        let label = request.label.as_deref().map(str::trim);
        if name.contains('\0')
            || search.contains('\0')
            || label.is_some_and(|label| label.contains('\0'))
        {
            return Err(AppError::Validation(
                "Saved views cannot contain null characters.".into(),
            ));
        }
        if name.is_empty()
            || name.chars().count() > 80
            || search.chars().count() > 500
            || label.is_some_and(|label| label.is_empty() || label.chars().count() > 60)
        {
            return Err(AppError::Validation(
                "Use a name of 1-80 characters, a search of at most 500, and a label of 1-60."
                    .into(),
            ));
        }
        let mut tx = self.pool.begin().await?;
        let result: AppResult<SavedTaskView> = async {
            sqlx::query("SET LOCAL lock_timeout = '100ms'").execute(&mut *tx).await?;
            let acquired: bool = sqlx::query_scalar("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))")
                .bind(format!("saved-views:{user}")).fetch_one(&mut *tx).await?;
            if !acquired { return Err(AppError::Conflict("Saved views are busy. Try again shortly.".into())); }
            if let Some(project) = request.project_id {
                // Owner check and key lock prevent scope from disappearing between
                // validation and insert. Deletion removes the view, never broadens it.
                let exists: Option<Uuid> = sqlx::query_scalar("SELECT id FROM projects WHERE user_id=$1 AND id=$2 FOR KEY SHARE NOWAIT")
                    .bind(user).bind(project).fetch_optional(&mut *tx).await.map_err(saved_view_error)?;
                if exists.is_none() { return Err(AppError::NotFound("project")); }
            }
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM saved_task_views WHERE user_id=$1")
                .bind(user).fetch_one(&mut *tx).await?;
            if count>=50 { return Err(AppError::Validation("You can save up to 50 views. Delete one before adding another.".into())); }
            sqlx::query_as("INSERT INTO saved_task_views(id,user_id,project_id,name,search,status,priority,label,sort) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,project_id,name,search,status,priority,label,sort,created_at")
                .bind(Uuid::now_v7()).bind(user).bind(request.project_id).bind(name).bind(search)
                .bind(request.status).bind(request.priority).bind(label).bind(request.sort)
                .fetch_one(&mut *tx).await.map_err(saved_view_error)
        }.await;
        match result {
            Ok(view) => {
                tx.commit().await?;
                Ok(view)
            }
            Err(error) => {
                tx.rollback().await?;
                Err(error)
            }
        }
    }

    pub async fn delete_saved_task_view(&self, user: Uuid, id: Uuid) -> AppResult<()> {
        let deleted = sqlx::query("DELETE FROM saved_task_views WHERE user_id=$1 AND id=$2")
            .bind(user)
            .bind(id)
            .execute(&self.pool)
            .await?;
        if deleted.rows_affected() == 0 {
            return Err(AppError::NotFound("saved view"));
        }
        Ok(())
    }
}

fn saved_view_error(error: sqlx::Error) -> AppError {
    match error
        .as_database_error()
        .and_then(|error| error.code())
        .as_deref()
    {
        Some("23505") => AppError::Conflict("A saved view with that name already exists.".into()),
        Some("55P03") => {
            AppError::Conflict("Saved view dependencies are busy. Try again shortly.".into())
        }
        _ => error.into(),
    }
}

#[utoipa::path(get,path="/api/v1/saved-task-views",operation_id="list_saved_task_views",responses((status=200,body=Vec<SavedTaskView>),(status=401,body=ErrorResponse)),security(("session_cookie"=[]),("development_user"=[])),tag="tasks")]
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
) -> AppResult<Json<Vec<SavedTaskView>>> {
    Ok(Json(state.store.saved_task_views(user).await?))
}

#[utoipa::path(post,path="/api/v1/saved-task-views",operation_id="create_saved_task_view",request_body=CreateSavedTaskView,responses((status=201,body=SavedTaskView),(status=401,body=ErrorResponse),(status=404,body=ErrorResponse),(status=409,body=ErrorResponse),(status=422,body=ErrorResponse)),security(("session_cookie"=[]),("development_user"=[])),tag="tasks")]
pub async fn create(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    ApiJson(request): ApiJson<CreateSavedTaskView>,
) -> AppResult<(StatusCode, Json<SavedTaskView>)> {
    state
        .action_rate_limiter
        .check_key(&format!("saved-views:{user}"))?;
    Ok((
        StatusCode::CREATED,
        Json(state.store.create_saved_task_view(user, request).await?),
    ))
}

#[utoipa::path(delete,path="/api/v1/saved-task-views/{view_id}",operation_id="delete_saved_task_view",params(("view_id"=Uuid,Path)),responses((status=204),(status=401,body=ErrorResponse),(status=404,body=ErrorResponse)),security(("session_cookie"=[]),("development_user"=[])),tag="tasks")]
pub async fn delete(
    State(state): State<AppState>,
    CurrentUser(user): CurrentUser,
    Path(id): Path<Uuid>,
) -> AppResult<StatusCode> {
    state
        .action_rate_limiter
        .check_key(&format!("saved-views:{user}"))?;
    state.store.delete_saved_task_view(user, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
