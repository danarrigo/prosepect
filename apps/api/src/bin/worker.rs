use std::time::Duration;

use anyhow::{Context, bail};
use prosepect_api::{
    config::Config, google_auth::GoogleOAuth, store::Store, sync_service::SyncService,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "prosepect_api=info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    let once = std::env::args().any(|argument| argument == "--once");
    let config = Config::from_env()?;
    let store = Store::connect(&config)
        .await
        .context("failed to initialize PostgreSQL")?;
    let google = config
        .google_oauth
        .clone()
        .map(GoogleOAuth::new)
        .transpose()?;
    let Some(google) = google else {
        if once {
            bail!("Google OAuth is not configured");
        }
        tracing::warn!("Google OAuth is not configured; synchronization worker is idle");
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    };
    let service = SyncService::new(store, google, config.google_calendar_webhook_url.clone())?;

    loop {
        service.enqueue_periodic_work().await?;
        let processed = service.run_once().await?;
        if once {
            return Ok(());
        }
        if !processed {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }
}
