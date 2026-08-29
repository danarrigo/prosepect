FROM rust:1.94-slim-bookworm AS builder

WORKDIR /workspace
COPY Cargo.toml Cargo.lock ./
COPY apps/api/Cargo.toml apps/api/Cargo.toml
COPY apps/api/src apps/api/src
COPY migrations migrations

RUN cargo build --locked --release -p prosepect-api --bin prosepect-api

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system prosepect \
    && useradd --system --gid prosepect --home-dir /nonexistent prosepect

COPY --from=builder /workspace/target/release/prosepect-api /usr/local/bin/prosepect-api

USER prosepect
EXPOSE 3000
ENTRYPOINT ["prosepect-api"]
