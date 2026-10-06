# Recurring task edits

The editor offers two scopes for an unfinished recurring task:

- **This occurrence** (default): edit this task without changing the next task's original title, description, project, priority, labels, deadline, work block, reminder, or repeat rule. Changing or stopping the repeat rule requires the forward scope.
- **This and future occurrences**: use this editor's details and timing as the defaults going forward, including any one-off values already visible in the editor. This is a replacement of the defaults, not just a patch to changed fields. Completed history is not rewritten.

Only one unfinished occurrence is generated at a time. Completing it creates the next one using the existing recurrence rules. A one-off deadline postponement does not shift the series: the next deadline can therefore already be past when the postponed task is completed. Forward edits reanchor the next deadline to the edited task. Changing a deadline alone does not move its work block. Future work blocks and reminders retain their offsets from the source deadline.

Repeating tasks cannot have parents or subtasks. Next occurrences start to-do; completion status, attachments, notes, and daily-focus selection are not copied. Completed tasks keep their existing single-task editor; they cannot be used to edit a future series. Existing safe-reopen rules still apply: reopening a completed task can remove only its untouched successor.

## Storage and safety

`migrations/0024_recurring_task_edit_scopes.sql` adds nullable successor defaults to tasks. No backfill changes existing tasks. The default project's separate composite foreign key enforces ownership. Deleting that project unassigns the future defaults and increments the surviving occurrence's version, rather than keeping a dangling reference. Deleting the occurrence's own project retains existing project/task deletion behavior.

Task updates use the existing owner graph lock and optimistic version. Scope validation and successor creation are in the same transaction; rejected updates await rollback before returning. Repeated single-occurrence edits preserve the first baseline. Forward edits clear the override. Status updates and existing API clients do not discard an established override; an unscoped explicit repeat-rule change retains the legacy forward behavior. Calendar/provider paths otherwise keep their existing behavior rather than offering a new scope selector.

Deletion Undo preserves the raw task defaults and guards the future project's dependencies. Account JSON exports include `recurrence_templates`; database backups include the columns normally. The current task's public representation is unchanged.

`PUT /api/v1/tasks/{task_id}` accepts optional `recurrence_scope` (`this_occurrence` or `this_and_future`) in addition to existing fields. Omission remains compatible with existing clients. The frontend retains the task version, exact deadline and work-block timestamps captured when its editor opened, so background refreshes cannot silently rebase the draft.
