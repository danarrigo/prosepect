use chrono::{DateTime, Utc};
use prosepect_api::{error::AppError, google_tasks::TASKS_SCOPE, store::Store};
use sqlx::PgPool;
use uuid::Uuid;

async fn user(pool: &PgPool) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Tasks fixture')")
        .bind(id)
        .bind(format!("{id}@example.test"))
        .execute(pool)
        .await?;
    Ok(id)
}

#[sqlx::test(migrations = "../../migrations")]
async fn tasks_configuration_requires_permission_and_is_owner_scoped(
    pool: PgPool,
) -> anyhow::Result<()> {
    let owner = user(&pool).await?;
    let other = user(&pool).await?;
    let store = Store::from_pool(pool.clone());
    assert!(!store.google_tasks_status(owner).await?.authorized);
    assert!(matches!(
        store
            .configure_google_tasks(owner, true, Some(("list", "Asia/Jakarta")), 0)
            .await,
        Err(AppError::Forbidden(_))
    ));
    sqlx::query(
        "INSERT INTO google_accounts(user_id,encrypted_access_token,scopes) VALUES($1,$2,$3)",
    )
    .bind(owner)
    .bind(vec![1_u8])
    .bind(vec![TASKS_SCOPE])
    .execute(&pool)
    .await?;
    let enabled = store
        .configure_google_tasks(owner, true, Some(("list", "Asia/Jakarta")), 0)
        .await?;
    assert!(enabled.enabled && enabled.authorized);
    assert_eq!(enabled.version, 1);
    assert_eq!(store.google_tasks_status(other).await?.version, 0);
    assert!(matches!(
        store.configure_google_tasks(owner, false, None, 0).await,
        Err(AppError::Conflict(_))
    ));
    sqlx::query("UPDATE google_accounts SET scopes=ARRAY['https://www.googleapis.com/auth/calendar.events'] WHERE user_id=$1")
        .bind(owner).execute(&pool).await?;
    let disabled = store.configure_google_tasks(owner, false, None, 1).await?;
    assert!(!disabled.enabled);
    assert_eq!(disabled.task_list_id.as_deref(), Some("list"));
    let scopes: Vec<String> =
        sqlx::query_scalar("SELECT scopes FROM google_accounts WHERE user_id=$1")
            .bind(owner)
            .fetch_one(&pool)
            .await?;
    assert_eq!(scopes, ["https://www.googleapis.com/auth/calendar.events"]);
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn tasks_settings_exclude_active_sync_without_waiting(pool: PgPool) -> anyhow::Result<()> {
    let owner = user(&pool).await?;
    let store = Store::from_pool(pool.clone());
    let mut lock = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
        .bind(format!("prosepect-sync:{owner}"))
        .execute(&mut *lock)
        .await?;
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        store.configure_google_tasks(owner, false, None, 0),
    )
    .await?;
    assert!(matches!(result, Err(AppError::Conflict(_))));
    lock.rollback().await?;
    assert_eq!(
        store
            .configure_google_tasks(owner, false, None, 0)
            .await?
            .version,
        1
    );
    Ok(())
}

fn instant(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

#[sqlx::test(migrations = "../../migrations")]
async fn remote_dates_preserve_deadline_wall_time_and_reject_dst_gaps(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool);
    let date = Some("2026-10-03".parse()?);
    let changed = store
        .google_task_deadline(date, Some(instant("2026-10-02T08:30:00Z")), "Asia/Jakarta")
        .await?;
    assert_eq!(changed, Some(instant("2026-10-03T08:30:00Z")));
    let imported = store
        .google_task_deadline(date, None, "Asia/Jakarta")
        .await?;
    assert_eq!(imported, Some(instant("2026-10-03T16:59:59Z")));
    assert_eq!(
        store
            .google_task_deadline(None, changed, "Asia/Jakarta")
            .await?,
        None
    );
    // 02:30 does not exist on the spring transition day in New York.
    assert!(matches!(
        store
            .google_task_deadline(
                Some("2026-03-08".parse()?),
                Some(instant("2026-03-07T07:30:00Z")),
                "America/New_York"
            )
            .await,
        Err(AppError::Conflict(_))
    ));
    // An unchanged ambiguous autumn time must preserve its original instant.
    let earlier = instant("2026-11-01T05:30:00Z");
    assert_eq!(
        store
            .google_task_deadline(
                Some("2026-11-01".parse()?),
                Some(earlier),
                "America/New_York"
            )
            .await?,
        Some(earlier)
    );
    Ok(())
}
