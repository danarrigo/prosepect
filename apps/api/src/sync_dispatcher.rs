use tokio::sync::mpsc;

use crate::sync_service::SyncService;

#[derive(Clone, Default)]
pub struct SyncDispatcher {
    sender: Option<mpsc::Sender<()>>,
}

impl SyncDispatcher {
    pub fn start(service: SyncService) -> Self {
        let (sender, mut receiver) = mpsc::channel(1);
        tokio::spawn(async move {
            if let Err(error) = service.enqueue_periodic_work().await {
                tracing::error!(error = ?error, "startup synchronization enqueue failed");
            }
            while receiver.recv().await.is_some() {
                loop {
                    match service.run_once().await {
                        Ok(true) => {}
                        Ok(false) => break,
                        Err(error) => {
                            tracing::error!(error = ?error, "immediate synchronization dispatch failed");
                            break;
                        }
                    }
                }
            }
        });
        let dispatcher = Self {
            sender: Some(sender),
        };
        dispatcher.wake();
        dispatcher
    }

    pub fn wake(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(());
        }
    }
}
