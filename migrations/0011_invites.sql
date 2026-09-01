CREATE TABLE account_invites (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL CHECK (email = LOWER(email)),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    used_at TIMESTAMPTZ,
    used_by UUID REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX account_invites_email_idx ON account_invites (LOWER(email));
CREATE INDEX account_invites_available_idx
    ON account_invites (LOWER(email))
    WHERE used_at IS NULL;
