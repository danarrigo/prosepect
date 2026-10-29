# rakkio domain and brand cutover

The productivity application formerly named prosepect is now **rakkio**, hosted at `https://rakkio.com` with API `https://api.rakkio.com`. The existing wardrobe/laundry website on that domain is replaced with the operator's approval. Its Vercel project and local source are not deleted.

## Preserve identity and data

Keep the same GitHub repository ID, Vercel project ID, Render service ID, Neon database, R2 bucket, encryption key and Google OAuth client. No database migrations, account transfers or provider rewrites are needed. Existing Google subjects identify the same accounts after signing in on the new site.

Legacy Rust crate/binary names, metrics, database identifiers, session-cookie names, browser-storage keys, Google provenance markers, API conflict-choice values and ICS UIDs deliberately retain `prosepect` identifiers. Renaming these blindly could lose preferences, duplicate provider objects or break recovery. New exports, new default Google Tasks lists and public copy use rakkio. Existing Google list names are not changed remotely.

The local working directory remains `prosepect` because a different local `rakkio` directory contains uncommitted work. The Git remote points to `danarrigo/rakkio`.

## Ordered hosted transition

1. Add `api.rakkio.com` to the **existing** Render service. Add its CNAME through the authoritative Vercel DNS zone, retaining mail and other records. Verify HTTPS `/ready` before switching clients.
2. In the existing Google client, add `rakkio.com`, origin `https://rakkio.com`, and redirect `https://api.rakkio.com/api/v1/auth/google/callback`. Retain old domains/redirects while transitioning. Do not replace credentials.
3. Release the reviewed code. The Render Blueprint keeps its legacy service name to avoid provisioning a replacement, and changes APP_URL, redirect/webhook URLs and the exact CORS allowlist to the new host. Verify the actual runtime; if Blueprint environment changes were not synchronized, update those four public settings on the existing service. Keep the database, storage and all credential values unchanged.
4. Set the existing Vercel project's production `VITE_API_URL` to `https://api.rakkio.com`, redeploy the reviewed SHA, then transfer `rakkio.com` and `www.rakkio.com` from the wardrobe project to this existing project. Redirect www and former prosepect.com hostnames to the canonical host, retaining paths/query strings. Do not delete either Vercel project.
5. Verify real homepage/legal pages, CSS/script CSP, consent gate, API readiness, denied anonymous access and both exact allowed origins. Update the worker's `RENDER_API_URL` secret to the new API host only after it is healthy.
6. Update Google consent-screen branding to rakkio and the new homepage/privacy/terms URLs; publish/verify if Google requires it. Update UptimeRobot monitor URLs/names and its status-page title, keeping existing monitor IDs/history. These dashboard-only settings require operator access; deployed code does not prove they changed.

CORS temporarily accepts exactly `https://rakkio.com` and `https://prosepect.com`; it never accepts wildcard origins. The frontend CSP allows both API hosts during transition. Retain the old API hostname so old tabs can finish writes; remove compatibility only as a later, reviewed change.

Cookies, local preferences and unsaved browser drafts cannot move across registrable domains automatically. Users must sign in on rakkio.com. Save/export unsaved work from existing tabs before closing them. Do not put session tokens into redirect URLs to transfer sessions.

Rollback uses the preserved Vercel projects/domains and former public environment settings, not a new database or new OAuth client. Production backup/restore verification remains a separate operational prerequisite, not established by this branding change.
