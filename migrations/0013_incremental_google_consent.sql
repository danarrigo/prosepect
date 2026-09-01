ALTER TABLE oauth_login_attempts
    ADD COLUMN user_id UUID REFERENCES users (id) ON DELETE CASCADE,
    ADD COLUMN purpose TEXT NOT NULL DEFAULT 'login'
        CHECK (purpose IN ('login', 'calendar_connect'));
