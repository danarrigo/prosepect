# Google Tasks sync (in development)

This integration is not enabled or deployed yet. Existing Google Calendar sync is unchanged.

## Agreed behavior

- One-time additional Google Tasks permission, then automatic two-way title, date and completion synchronization in a dedicated prosepect list.
- A prosepect deadline's date is projected onto Google's task calendar date. Google does **not** expose a true deadline or time through this API. Exact deadline times remain in prosepect; a remote date change must preserve an existing deadline's local time.
- Scheduled work blocks continue through Google Calendar, independently of Google Tasks.
- Google-side deletion must not delete or automatically recreate the prosepect task. Deletion is not ordinary field synchronization; explicit unlinking and existing deletion Undo must be respected.
- Merge changes to different fields. If both sides change the same field differently, retain both versions and require resolution instead of silently choosing a winner.
- Do not silently truncate Google's longer titles to prosepect's 240-character limit.
- Never import other Google lists, assigned tasks or unrelated Google account data automatically.

## Implementation gates

1. Shared field reconciliation and incremental OAuth consent, including tests that sign-in does not request Tasks permission. Calendar reconnection must preserve previously granted Tasks access.
2. Durable owner-scoped mappings, fixed date timezone, safe create-intent recovery, bounded pagination including hidden/completed/deleted entries, and optimistic-concurrency checks. Unknown outcomes must not trigger duplicate POSTs or destructive retries.
3. Existing dispatcher integration and settings controls, with explicit enable/disable and actionable conflict/authorization status. Disabling Tasks must not revoke Calendar access.
4. PostgreSQL/mock-provider tests, real-backend browser acceptance and normal generated API contracts. Rust/container execution stays remote. No live-provider writes or production configuration changes during development.
5. Live opt-in acceptance after the operator enables the Google Tasks API and approves its OAuth scope. Calendar permission alone does not authorize Tasks.

The current source checkpoint implements shared field rules, incremental consent, the bounded API transport and owner-scoped settings persistence. The consent callback stores verified permission without enabling copying. The transport is not wired to sync jobs yet; Settings enablement and reconciliation remain in development.

## Primary API references

Checked against Google's current documentation:

- [Task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks): `due` is a calendar day, not a deadline; time is discarded. Title limit 1024; notes limit 8192. Parent/position and assignment metadata are separate from the fields being synced.
- [Authorization](https://developers.google.com/workspace/tasks/auth): write access requires `https://www.googleapis.com/auth/tasks`.
- [Task listing](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks/list): max 100 per page; `showHidden=true` is necessary to see tasks completed in Google's clients, alongside `showCompleted=true`; deleted entries require `showDeleted=true`.
- [Read-modify-write guidance](https://developers.google.com/workspace/tasks/performance): use resource ETags/If-Match rather than unconditional overwrites. Actual provider behavior still needs acceptance testing; fake-provider tests are not live Google evidence.
