-- In-flight attempts from the previous release fail closed and expire normally.
-- New attempts always store a browser-secret hash. Neither the browser secret
-- nor its hash is sent to Google or exposed in the redirect URL.
ALTER TABLE oauth_login_attempts
    ADD COLUMN browser_binding_hash BYTEA
    CHECK (octet_length(browser_binding_hash) = 32);
