# Saved task views

In Projects, set task filters and choose **Save current view**. Give the view a name. Open **Saved views** to reopen or delete one.

A view stores project scope, search, status, priority, label, and sort order. It does not copy tasks or freeze results. Task changes are reflected when the view is reopened; opening it replaces the current filters. Hierarchies remain intact: sorting orders roots and siblings, keeping children with their parents. Filters do not create or schedule tasks.

Views belong to the signed-in account and are available across devices. Names must be unique within the account, ignoring case. There is a limit of 50 views per account. To change a saved definition, save a new view and delete the old one.

Deleting a view never deletes tasks. Deleting its project also deletes that project's saved views, rather than silently changing their scope to all projects. Archived projects retain their views. Account JSON exports include `saved_task_views`; database backups include the table normally.

## Implementation

- `apps/api/src/saved_views.rs`: validated, authenticated list/create/delete API with CSRF middleware and owner-bound project references.
- `migrations/0023_saved_views.sql`: private metadata with composite project ownership foreign key and unique owner/name index.
- `apps/web/src/components/SavedTaskViews.vue`: loading/retry, named capture, opening, confirmed deletion, cancellation and focus restoration.
- `apps/web/src/views/ProjectsView.vue`: existing filters applied after project selection settles; missing projects fail closed.
- `apps/web/src/components/TaskList.vue`: opt-in preservation of externally selected sort order.

API routes are `/api/v1/saved-task-views` (GET/POST) and `/api/v1/saved-task-views/{view_id}` (DELETE). Definitions are immutable, so delete needs no optimistic version. Create capacity checks are serialized per account with a nonblocking transaction lock; rejected operations await rollback before returning. Create operations cap database lock waits, but this is not a universal request-time deadline.
