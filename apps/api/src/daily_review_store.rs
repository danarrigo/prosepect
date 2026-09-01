use std::collections::{HashMap, HashSet};

use chrono::{NaiveDate, Utc};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{
        CompleteDailyReviewRequest, DailyReview, DailyReviewResponse, DailyReviewStatus,
        ReviewDecisionAction, Task,
    },
    store::Store,
};

impl Store {
    pub async fn start_daily_review(
        &self,
        user_id: Uuid,
        review_date: NaiveDate,
        manual: bool,
    ) -> AppResult<DailyReviewResponse> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query("INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .execute(&mut *transaction)
            .await?;
        let automatic = sqlx::query_scalar::<_, bool>(
            "SELECT automatic_daily_review FROM user_settings WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_one(&mut *transaction)
        .await?;
        if !manual && !automatic {
            transaction.commit().await?;
            return Ok(DailyReviewResponse { review: None });
        }

        let previous_date =
            previous_unfinished_focus_date(&mut transaction, user_id, review_date).await?;
        let Some(previous_date) = previous_date else {
            transaction.commit().await?;
            return Ok(DailyReviewResponse { review: None });
        };
        sqlx::query(
            r#"
            INSERT INTO daily_reviews (id, user_id, review_date)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, review_date) DO NOTHING
            "#,
        )
        .bind(Uuid::now_v7())
        .bind(user_id)
        .bind(review_date)
        .execute(&mut *transaction)
        .await?;
        let row = sqlx::query_as::<_, DailyReviewRow>(
            r#"
            SELECT id, review_date, status, started_at, completed_at, version
            FROM daily_reviews
            WHERE user_id = $1 AND review_date = $2
            "#,
        )
        .bind(user_id)
        .bind(review_date)
        .fetch_one(&mut *transaction)
        .await?;
        let unfinished_tasks =
            focus_tasks_for_date(&mut transaction, user_id, previous_date).await?;
        transaction.commit().await?;
        Ok(DailyReviewResponse {
            review: Some(row.with_tasks(unfinished_tasks)),
        })
    }

    pub async fn complete_daily_review(
        &self,
        user_id: Uuid,
        review_date: NaiveDate,
        request: CompleteDailyReviewRequest,
    ) -> AppResult<DailyReview> {
        let mut transaction = self.pool.begin().await?;
        let review = sqlx::query_as::<_, DailyReviewRow>(
            r#"
            SELECT id, review_date, status, started_at, completed_at, version
            FROM daily_reviews
            WHERE user_id = $1 AND review_date = $2
            FOR UPDATE
            "#,
        )
        .bind(user_id)
        .bind(review_date)
        .fetch_optional(&mut *transaction)
        .await?
        .ok_or(AppError::NotFound("daily review"))?;
        if review.status == DailyReviewStatus::Completed {
            return Err(AppError::Conflict(
                "daily review is already completed".to_owned(),
            ));
        }
        if review.version != request.expected_version {
            return Err(AppError::Conflict(format!(
                "daily review changed since version {}; current version is {}",
                request.expected_version, review.version
            )));
        }

        let previous_date = previous_unfinished_focus_date(&mut transaction, user_id, review_date)
            .await?
            .ok_or_else(|| AppError::Conflict("there are no unfinished focus tasks".to_owned()))?;
        let unfinished_tasks =
            focus_tasks_for_date(&mut transaction, user_id, previous_date).await?;
        let unfinished_ids: HashSet<_> = unfinished_tasks.iter().map(|task| task.id).collect();
        let decisions: HashMap<_, _> = request
            .decisions
            .iter()
            .map(|decision| (decision.task_id, decision))
            .collect();
        if decisions.len() != request.decisions.len()
            || decisions.keys().copied().collect::<HashSet<_>>() != unfinished_ids
        {
            return Err(AppError::Validation(
                "a decision is required for every unfinished focus task".to_owned(),
            ));
        }

        let mut carry_ids = Vec::new();
        for decision in request.decisions {
            match decision.action {
                ReviewDecisionAction::CarryForward => carry_ids.push(decision.task_id),
                ReviewDecisionAction::Reschedule => {
                    let due_at = decision.due_at.ok_or_else(|| {
                        AppError::Validation(
                            "rescheduled review tasks require a new deadline".to_owned(),
                        )
                    })?;
                    sqlx::query(
                        r#"
                        UPDATE tasks
                        SET due_at = $3, updated_at = NOW(), version = version + 1
                        WHERE id = $1 AND user_id = $2
                        "#,
                    )
                    .bind(decision.task_id)
                    .bind(user_id)
                    .bind(due_at)
                    .execute(&mut *transaction)
                    .await?;
                }
                ReviewDecisionAction::Remove => {}
            }
        }
        let existing_ids = sqlx::query_scalar::<_, Uuid>(
            r#"
            SELECT task_id
            FROM daily_focus_tasks
            WHERE user_id = $1 AND focus_date = $2
            ORDER BY position
            "#,
        )
        .bind(user_id)
        .bind(review_date)
        .fetch_all(&mut *transaction)
        .await?;
        for task_id in existing_ids {
            if !carry_ids.contains(&task_id) {
                carry_ids.insert(0, task_id);
            }
        }
        carry_ids.dedup();
        if carry_ids.len() > 3 {
            return Err(AppError::Validation(
                "carrying these tasks forward would exceed three focus tasks".to_owned(),
            ));
        }
        sqlx::query("DELETE FROM daily_focus_tasks WHERE user_id = $1 AND focus_date = $2")
            .bind(user_id)
            .bind(review_date)
            .execute(&mut *transaction)
            .await?;
        for (index, task_id) in carry_ids.iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO daily_focus_tasks (user_id, focus_date, task_id, position)
                VALUES ($1, $2, $3, $4)
                "#,
            )
            .bind(user_id)
            .bind(review_date)
            .bind(task_id)
            .bind(index as i16 + 1)
            .execute(&mut *transaction)
            .await?;
        }
        let completed = sqlx::query_as::<_, DailyReviewRow>(
            r#"
            UPDATE daily_reviews
            SET status = 'completed', completed_at = NOW(), version = version + 1
            WHERE id = $1 AND user_id = $2 AND version = $3
            RETURNING id, review_date, status, started_at, completed_at, version
            "#,
        )
        .bind(review.id)
        .bind(user_id)
        .bind(request.expected_version)
        .fetch_one(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(completed.with_tasks(unfinished_tasks))
    }
}

#[derive(FromRow)]
struct DailyReviewRow {
    id: Uuid,
    review_date: NaiveDate,
    status: DailyReviewStatus,
    started_at: chrono::DateTime<Utc>,
    completed_at: Option<chrono::DateTime<Utc>>,
    version: i32,
}

impl DailyReviewRow {
    fn with_tasks(self, unfinished_tasks: Vec<Task>) -> DailyReview {
        DailyReview {
            id: self.id,
            review_date: self.review_date,
            status: self.status,
            unfinished_tasks,
            started_at: self.started_at,
            completed_at: self.completed_at,
            version: self.version,
        }
    }
}

async fn previous_unfinished_focus_date(
    connection: &mut sqlx::PgConnection,
    user_id: Uuid,
    review_date: NaiveDate,
) -> AppResult<Option<NaiveDate>> {
    sqlx::query_scalar::<_, Option<NaiveDate>>(
        r#"
        SELECT MAX(focus.focus_date)
        FROM daily_focus_tasks focus
        JOIN tasks ON tasks.id = focus.task_id AND tasks.user_id = focus.user_id
        WHERE
            focus.user_id = $1
            AND focus.focus_date < $2
            AND tasks.status <> 'completed'
        "#,
    )
    .bind(user_id)
    .bind(review_date)
    .fetch_one(connection)
    .await
    .map_err(AppError::from)
}

async fn focus_tasks_for_date(
    connection: &mut sqlx::PgConnection,
    user_id: Uuid,
    focus_date: NaiveDate,
) -> AppResult<Vec<Task>> {
    sqlx::query_as::<_, Task>(
        r#"
        SELECT
            tasks.id, tasks.project_id, tasks.parent_task_id, tasks.title, tasks.description,
            tasks.due_at, tasks.scheduled_start, tasks.scheduled_end, tasks.status,
            tasks.priority, tasks.recurrence, tasks.labels, tasks.remind_at, tasks.position,
            tasks.completed_at, tasks.created_at, tasks.updated_at, tasks.version
        FROM daily_focus_tasks focus
        JOIN tasks ON tasks.id = focus.task_id AND tasks.user_id = focus.user_id
        WHERE
            focus.user_id = $1
            AND focus.focus_date = $2
            AND tasks.status <> 'completed'
        ORDER BY focus.position
        "#,
    )
    .bind(user_id)
    .bind(focus_date)
    .fetch_all(connection)
    .await
    .map_err(AppError::from)
}
