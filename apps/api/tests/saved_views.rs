use prosepect_api::{
    error::AppError,
    saved_views::{CreateSavedTaskView, SavedTaskSort, SavedTaskStatus},
    store::Store,
};
use sqlx::PgPool;
use uuid::Uuid;

async fn user(pool: &PgPool) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Views fixture')")
        .bind(id)
        .bind(format!("{id}@example.test"))
        .execute(pool)
        .await?;
    Ok(id)
}

fn request(name: &str) -> CreateSavedTaskView {
    CreateSavedTaskView {
        name: name.into(),
        project_id: None,
        search: "report".into(),
        status: SavedTaskStatus::Open,
        priority: None,
        label: Some("work".into()),
        sort: SavedTaskSort::Due,
    }
}

#[sqlx::test(migrations = "../../migrations")]
async fn views_are_private_and_project_deletion_never_broadens_scope(
    pool: PgPool,
) -> anyhow::Result<()> {
    let owner = user(&pool).await?;
    let other = user(&pool).await?;
    let project = Uuid::now_v7();
    sqlx::query("INSERT INTO projects(id,user_id,name) VALUES($1,$2,'Work')")
        .bind(project)
        .bind(owner)
        .execute(&pool)
        .await?;
    let store = Store::from_pool(pool.clone());
    let mut scoped = request(" Reports ");
    scoped.project_id = Some(project);
    let view = store.create_saved_task_view(owner, scoped).await?;
    assert_eq!(view.name, "Reports");
    assert_eq!(view.project_id, Some(project));
    assert_eq!(store.saved_task_views(owner).await?.len(), 1);
    assert!(store.saved_task_views(other).await?.is_empty());
    let exported: serde_json::Value = serde_json::from_slice(&store.export_json(owner).await?)?;
    assert_eq!(exported["saved_task_views"][0]["id"], view.id.to_string());
    let foreign_export: serde_json::Value =
        serde_json::from_slice(&store.export_json(other).await?)?;
    assert_eq!(foreign_export["saved_task_views"], serde_json::json!([]));
    assert!(matches!(
        store.delete_saved_task_view(other, view.id).await,
        Err(AppError::NotFound(_))
    ));
    let mut foreign = request("Foreign");
    foreign.project_id = Some(project);
    assert!(matches!(
        store.create_saved_task_view(other, foreign).await,
        Err(AppError::NotFound(_))
    ));
    assert!(matches!(
        store
            .create_saved_task_view(owner, request("reports"))
            .await,
        Err(AppError::Conflict(_))
    ));
    // A rejected duplicate must release its transaction's lock before return.
    let independent = Store::from_pool(pool.clone());
    let global = independent
        .create_saved_task_view(owner, request("Global"))
        .await?;
    sqlx::query("DELETE FROM projects WHERE id=$1")
        .bind(project)
        .execute(&pool)
        .await?;
    let remaining = store.saved_task_views(owner).await?;
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, global.id);
    store.delete_saved_task_view(owner, global.id).await?;
    assert!(store.saved_task_views(owner).await?.is_empty());
    Ok(())
}

#[sqlx::test(migrations = "../../migrations")]
async fn view_validation_and_concurrent_capacity_are_bounded(pool: PgPool) -> anyhow::Result<()> {
    let owner = user(&pool).await?;
    let store = Store::from_pool(pool.clone());
    for invalid in [request(" "), request(&"x".repeat(81))] {
        assert!(matches!(
            store.create_saved_task_view(owner, invalid).await,
            Err(AppError::Validation(_))
        ));
    }
    let mut invalid = request("Search");
    invalid.search = "x".repeat(501);
    assert!(matches!(
        store.create_saved_task_view(owner, invalid).await,
        Err(AppError::Validation(_))
    ));
    let mut invalid = request("Label");
    invalid.label = Some(" ".into());
    assert!(matches!(
        store.create_saved_task_view(owner, invalid).await,
        Err(AppError::Validation(_))
    ));
    for i in 0..49 {
        store
            .create_saved_task_view(owner, request(&format!("View {i}")))
            .await?;
    }
    let independent = Store::from_pool(pool.clone());
    let (first, second) = tokio::join!(
        store.create_saved_task_view(owner, request("First")),
        independent.create_saved_task_view(owner, request("Second"))
    );
    assert_eq!(usize::from(first.is_ok()) + usize::from(second.is_ok()), 1);
    assert_eq!(store.saved_task_views(owner).await?.len(), 50);
    assert!(matches!(
        store
            .create_saved_task_view(owner, request("Overflow"))
            .await,
        Err(AppError::Validation(_))
    ));
    Ok(())
}
