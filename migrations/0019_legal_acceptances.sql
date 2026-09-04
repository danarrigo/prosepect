ALTER TABLE oauth_login_attempts
    ADD COLUMN terms_version TEXT,
    ADD COLUMN privacy_version TEXT,
    ADD COLUMN age_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT oauth_login_attempts_legal_versions_check CHECK (
        (terms_version IS NULL AND privacy_version IS NULL AND NOT age_confirmed)
        OR (
            char_length(terms_version) BETWEEN 1 AND 40
            AND char_length(privacy_version) BETWEEN 1 AND 40
            AND age_confirmed
        )
    );

CREATE TABLE legal_acceptances (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    terms_version TEXT NOT NULL CHECK (char_length(terms_version) BETWEEN 1 AND 40),
    privacy_version TEXT NOT NULL CHECK (char_length(privacy_version) BETWEEN 1 AND 40),
    age_confirmed BOOLEAN NOT NULL CHECK (age_confirmed),
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, terms_version, privacy_version)
);

CREATE INDEX legal_acceptances_user_accepted_idx
    ON legal_acceptances (user_id, accepted_at DESC);
