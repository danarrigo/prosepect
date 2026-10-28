use super::*;
use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

#[sqlx::test(migrations = "../../migrations")]
async fn oversized_upload_stops_before_consuming_the_stream_tail(
    pool: PgPool,
) -> anyhow::Result<()> {
    let store = Store::from_pool(pool.clone());
    store.ensure_development_user(DEVELOPMENT_USER_ID).await?;
    let mut config = test_config();
    config.max_file_size_bytes = 8;
    let router = app::build(&config, store)?;
    let reads = Arc::new(AtomicUsize::new(0));
    let chunks = VecDeque::from([
        bytes::Bytes::from_static(b"--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"stream.txt\"\r\n\r\n"),
        bytes::Bytes::from(vec![b'x'; 1024]),
        bytes::Bytes::from_static(b"tail-must-not-be-consumed\r\n--boundary--\r\n"),
    ]);
    let stream =
        futures_util::stream::unfold((chunks, reads.clone()), |(mut chunks, reads)| async move {
            chunks.pop_front().map(|chunk| {
                reads.fetch_add(1, Ordering::SeqCst);
                (Ok::<_, std::io::Error>(chunk), (chunks, reads))
            })
        });
    let response = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/v1/files")
                .header(DEVELOPMENT_USER_HEADER, DEVELOPMENT_USER_ID.to_string())
                .header(
                    header::CONTENT_TYPE,
                    "multipart/form-data; boundary=boundary",
                )
                .body(Body::from_stream(stream))?,
        )
        .await?;
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(
        reads.load(Ordering::SeqCst) < 3,
        "the oversized field tail was consumed before rejection"
    );
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM files")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}
