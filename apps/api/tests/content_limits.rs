use prosepect_api::store::{DEVELOPMENT_USER_ID, Store};
use sqlx::PgPool;
use uuid::Uuid;

async fn insert_note(pool: &PgPool, owner: Uuid, markdown: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO notes (id, user_id, title, markdown) VALUES ($1, $2, 'Quota test', $3)",
    )
    .bind(Uuid::now_v7())
    .bind(owner)
    .bind(markdown)
    .execute(pool)
    .await?;
    Ok(())
}

async fn assert_counters(pool: &PgPool) -> anyhow::Result<()> {
    let mut bytes = 0_i64;
    let mut records = 0_i64;
    for table in [
        "projects",
        "tasks",
        "calendars",
        "calendar_events",
        "notes",
        "files",
        "labels",
        "saved_task_views",
    ] {
        // Relation names are a fixed test fixture, never request input.
        let (row_bytes, row_count): (i64, i64) = sqlx::query_as(&format!("SELECT COALESCE(SUM(octet_length(to_jsonb(row_data)::text)), 0)::BIGINT, COUNT(*) FROM {table} row_data"))
            .fetch_one(pool).await?;
        bytes += row_bytes;
        records += row_count;
    }
    let total: (i64, i64) = sqlx::query_as("SELECT bytes, records FROM workspace_content_total")
        .fetch_one(pool)
        .await?;
    let owners: (i64, i64) = sqlx::query_as("SELECT COALESCE(SUM(bytes), 0)::BIGINT, COALESCE(SUM(records), 0)::BIGINT FROM workspace_content_usage").fetch_one(pool).await?;
    assert_eq!(total, (bytes, records));
    assert_eq!(owners, total);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn quota_writes_and_counter_updates_rollback_together(pool: PgPool) -> anyhow::Result<()> {
    Store::from_pool(pool.clone())
        .ensure_development_user(DEVELOPMENT_USER_ID)
        .await?;
    sqlx::query("UPDATE workspace_content_limits SET user_records = 1")
        .execute(&pool)
        .await?;
    let mut transaction = pool.begin().await?;
    sqlx::query("INSERT INTO projects (id, user_id, name) VALUES ($1, $2, 'Atomic')")
        .bind(Uuid::now_v7())
        .bind(DEVELOPMENT_USER_ID)
        .execute(&mut *transaction)
        .await?;
    let result = sqlx::query("INSERT INTO notes (id, user_id, title) VALUES ($1, $2, 'Rejected')")
        .bind(Uuid::now_v7())
        .bind(DEVELOPMENT_USER_ID)
        .execute(&mut *transaction)
        .await;
    assert_eq!(
        result
            .unwrap_err()
            .as_database_error()
            .unwrap()
            .constraint(),
        Some("workspace_content_quota")
    );
    transaction.rollback().await?;
    assert_counters(&pool).await?;
    let total: i64 = sqlx::query_scalar("SELECT records FROM workspace_content_total")
        .fetch_one(&pool)
        .await?;
    assert_eq!(total, 0);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn quota_allows_shrinking_and_account_deletion_when_over_budget(
    pool: PgPool,
) -> anyhow::Result<()> {
    Store::from_pool(pool.clone())
        .ensure_development_user(DEVELOPMENT_USER_ID)
        .await?;
    insert_note(&pool, DEVELOPMENT_USER_ID, &"x".repeat(4096)).await?;
    sqlx::query("UPDATE workspace_content_limits SET user_bytes = 1, total_bytes = 1")
        .execute(&pool)
        .await?;
    assert!(
        insert_note(&pool, DEVELOPMENT_USER_ID, "More")
            .await
            .is_err()
    );
    sqlx::query("UPDATE notes SET markdown = ''")
        .execute(&pool)
        .await?;
    assert_counters(&pool).await?;
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(DEVELOPMENT_USER_ID)
        .execute(&pool)
        .await?;
    assert_counters(&pool).await?;
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn concurrent_writers_cannot_overrun_shared_or_owner_budgets(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    let other = Uuid::now_v7();
    store.ensure_development_user(DEVELOPMENT_USER_ID).await?;
    store.ensure_development_user(other).await?;
    sqlx::query("UPDATE workspace_content_limits SET user_records = 1, total_records = 1")
        .execute(&pool)
        .await?;
    let mut handles = Vec::new();
    for index in 0..8 {
        let pool = pool.clone();
        let owner = if index % 2 == 0 {
            DEVELOPMENT_USER_ID
        } else {
            other
        };
        handles.push(tokio::spawn(async move {
            insert_note(&pool, owner, "Concurrent").await
        }));
    }
    let mut succeeded = 0;
    for handle in handles {
        match handle.await? {
            Ok(()) => succeeded += 1,
            Err(error) => assert_eq!(
                error.as_database_error().unwrap().constraint(),
                Some("workspace_content_quota")
            ),
        }
    }
    assert_eq!(succeeded, 1);
    assert_counters(&pool).await?;
    Ok(())
}

#[sqlx::test(migrations = false)]
async fn migration_backfills_existing_content_without_removing_it(
    pool: PgPool,
) -> anyhow::Result<()> {
    let migrator = sqlx::migrate!("../../migrations");
    for migration in migrator.iter().filter(|migration| migration.version < 26) {
        sqlx::raw_sql(&migration.sql).execute(&pool).await?;
    }
    Store::from_pool(pool.clone())
        .ensure_development_user(DEVELOPMENT_USER_ID)
        .await?;
    insert_note(&pool, DEVELOPMENT_USER_ID, "Existing content").await?;
    sqlx::raw_sql(include_str!(
        "../../../migrations/0026_workspace_content_limits.sql"
    ))
    .execute(&pool)
    .await?;
    assert_counters(&pool).await?;
    let markdown: String = sqlx::query_scalar("SELECT markdown FROM notes")
        .fetch_one(&pool)
        .await?;
    assert_eq!(markdown, "Existing content");
    Ok(())
}
