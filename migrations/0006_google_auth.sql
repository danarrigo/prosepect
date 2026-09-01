CREATE TABLE oauth_login_attempts (
    state_hash BYTEA PRIMARY KEY CHECK (OCTET_LENGTH(state_hash) = 32),
    nonce TEXT NOT NULL CHECK (LENGTH(nonce) BETWEEN 16 AND 256),
    pkce_verifier TEXT NOT NULL CHECK (LENGTH(pkce_verifier) BETWEEN 43 AND 128),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX oauth_login_attempts_expiry_idx ON oauth_login_attempts (expires_at);

CREATE TABLE google_accounts (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_access_token BYTEA NOT NULL,
    encrypted_refresh_token BYTEA,
    access_token_expires_at TIMESTAMPTZ,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
