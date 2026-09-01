use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        CreateNoteRequest, Note, NoteList, SearchResult, SearchResultList, UpdateNoteRequest,
    },
    store::Store,
};

impl Store {
    pub async fn list_notes(&self, user_id: Uuid) -> AppResult<NoteList> {
        let items = sqlx::query_as::<_, Note>(
            r#"
            SELECT
                id, project_id, task_id, event_id, title, markdown,
                created_at, updated_at, version
            FROM notes
            WHERE user_id = $1
            ORDER BY updated_at DESC, id DESC
            LIMIT 200
            "#,
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(NoteList { items })
    }

    pub async fn create_note(&self, user_id: Uuid, request: CreateNoteRequest) -> AppResult<Note> {
        validate_note_fields(&request.title, &request.markdown)?;
        let mut transaction = self.pool.begin().await?;
        validate_note_link(
            &mut transaction,
            user_id,
            request.project_id,
            request.task_id,
            request.event_id,
        )
        .await?;
        let note = sqlx::query_as::<_, Note>(
            r#"
            INSERT INTO notes (
                id, user_id, project_id, task_id, event_id, title, markdown
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
                id, project_id, task_id, event_id, title, markdown,
                created_at, updated_at, version
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(request.project_id)
        .bind(request.task_id)
        .bind(request.event_id)
        .bind(request.title.trim())
        .bind(request.markdown)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(note)
    }

    pub async fn update_note(
        &self,
        user_id: Uuid,
        note_id: Uuid,
        request: UpdateNoteRequest,
    ) -> AppResult<Note> {
        validate_note_fields(&request.title, &request.markdown)?;
        let mut transaction = self.pool.begin().await?;
        validate_note_link(
            &mut transaction,
            user_id,
            request.project_id,
            request.task_id,
            request.event_id,
        )
        .await?;
        let note = sqlx::query_as::<_, Note>(
            r#"
            UPDATE notes
            SET
                project_id = $3,
                task_id = $4,
                event_id = $5,
                title = $6,
                markdown = $7,
                updated_at = NOW(),
                version = version + 1
            WHERE id = $1 AND user_id = $2 AND version = $8
            RETURNING
                id, project_id, task_id, event_id, title, markdown,
                created_at, updated_at, version
            "#,
        )
        .bind(note_id)
        .bind(user_id)
        .bind(request.project_id)
        .bind(request.task_id)
        .bind(request.event_id)
        .bind(request.title.trim())
        .bind(request.markdown)
        .bind(request.expected_version)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(note) = note else {
            transaction.rollback().await?;
            return self
                .note_error(user_id, note_id, request.expected_version)
                .await;
        };
        transaction.commit().await?;
        Ok(note)
    }

    pub async fn delete_note(
        &self,
        user_id: Uuid,
        note_id: Uuid,
        expected_version: i32,
    ) -> AppResult<()> {
        let result =
            sqlx::query("DELETE FROM notes WHERE id = $1 AND user_id = $2 AND version = $3")
                .bind(note_id)
                .bind(user_id)
                .bind(expected_version)
                .execute(&self.pool)
                .await?;
        if result.rows_affected() == 1 {
            return Ok(());
        }
        self.note_error::<Note>(user_id, note_id, expected_version)
            .await
            .map(|_| ())
    }

    pub async fn global_search(
        &self,
        user_id: Uuid,
        query: &str,
        limit: i64,
    ) -> AppResult<SearchResultList> {
        let query = query.trim();
        if query.is_empty() || query.chars().count() > 100 {
            return Err(AppError::Validation(
                "search query must contain between 1 and 100 characters".to_owned(),
            ));
        }
        let items = sqlx::query_as::<_, SearchResult>(
            r#"
            WITH search_query AS (
                SELECT WEBSEARCH_TO_TSQUERY('simple', $2) AS value
            ), matches AS (
                SELECT
                    'task'::TEXT AS kind,
                    tasks.id,
                    tasks.title,
                    LEFT(tasks.description, 240) AS excerpt,
                    tasks.updated_at
                FROM tasks, search_query
                WHERE tasks.user_id = $1
                    AND TO_TSVECTOR(
                        'simple',
                        tasks.title || ' ' || tasks.description || ' ' || ARRAY_TO_STRING(tasks.labels, ' ')
                    ) @@ search_query.value
                UNION ALL
                SELECT
                    'project'::TEXT,
                    projects.id,
                    projects.name,
                    LEFT(projects.outcome, 240),
                    projects.updated_at
                FROM projects, search_query
                WHERE projects.user_id = $1
                    AND TO_TSVECTOR('simple', projects.name || ' ' || projects.outcome)
                        @@ search_query.value
                UNION ALL
                SELECT
                    'note'::TEXT,
                    notes.id,
                    notes.title,
                    LEFT(notes.markdown, 240),
                    notes.updated_at
                FROM notes, search_query
                WHERE notes.user_id = $1
                    AND TO_TSVECTOR('simple', notes.title || ' ' || notes.markdown)
                        @@ search_query.value
                UNION ALL
                SELECT
                    'event'::TEXT,
                    events.id,
                    events.title,
                    LEFT(events.description || ' ' || events.location, 240),
                    events.updated_at
                FROM calendar_events events, search_query
                WHERE events.user_id = $1
                    AND TO_TSVECTOR(
                        'simple',
                        events.title || ' ' || events.description || ' ' || events.location
                    ) @@ search_query.value
            )
            SELECT kind, id, title, excerpt, updated_at
            FROM matches
            ORDER BY updated_at DESC, id DESC
            LIMIT $3
            "#,
        )
        .bind(user_id)
        .bind(query)
        .bind(limit.clamp(1, 50))
        .fetch_all(&self.pool)
        .await?;
        Ok(SearchResultList { items })
    }

    async fn note_error<T>(
        &self,
        user_id: Uuid,
        note_id: Uuid,
        expected_version: i32,
    ) -> AppResult<T> {
        let version = sqlx::query_scalar::<_, i32>(
            "SELECT version FROM notes WHERE id = $1 AND user_id = $2",
        )
        .bind(note_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        match version {
            Some(version) => Err(AppError::Conflict(format!(
                "note changed since version {expected_version}; current version is {version}"
            ))),
            None => Err(AppError::NotFound("note")),
        }
    }
}

fn validate_note_fields(title: &str, markdown: &str) -> AppResult<()> {
    if title.trim().is_empty() || title.trim().chars().count() > 240 {
        return Err(AppError::Validation(
            "note title must contain between 1 and 240 characters".to_owned(),
        ));
    }
    if markdown.chars().count() > 100_000 {
        return Err(AppError::Validation(
            "note Markdown cannot exceed 100000 characters".to_owned(),
        ));
    }
    Ok(())
}

async fn validate_note_link(
    connection: &mut sqlx::PgConnection,
    user_id: Uuid,
    project_id: Option<Uuid>,
    task_id: Option<Uuid>,
    event_id: Option<Uuid>,
) -> AppResult<()> {
    if [project_id, task_id, event_id]
        .into_iter()
        .flatten()
        .count()
        > 1
    {
        return Err(AppError::Validation(
            "a note can attach to only one project, task, or event".to_owned(),
        ));
    }
    let valid = match (project_id, task_id, event_id) {
        (Some(id), None, None) => {
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = $1 AND user_id = $2)",
            )
            .bind(id)
            .bind(user_id)
            .fetch_one(&mut *connection)
            .await?
        }
        (None, Some(id), None) => {
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM tasks WHERE id = $1 AND user_id = $2)",
            )
            .bind(id)
            .bind(user_id)
            .fetch_one(&mut *connection)
            .await?
        }
        (None, None, Some(id)) => {
            sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM calendar_events WHERE id = $1 AND user_id = $2)",
            )
            .bind(id)
            .bind(user_id)
            .fetch_one(&mut *connection)
            .await?
        }
        _ => true,
    };
    if !valid {
        return Err(AppError::Validation(
            "note attachment must belong to the current user".to_owned(),
        ));
    }
    Ok(())
}
