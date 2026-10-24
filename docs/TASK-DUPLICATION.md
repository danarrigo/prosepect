# Duplicate a task

Open a task's editor and choose **Duplicate saved task**. Review or change the copy, then choose **Create task** (or Ctrl/Cmd+Enter). Canceling creates nothing. Unsaved edits to the original remain separate and are not copied.

The copy includes the saved title, description, priority, labels and active project. An archived or missing project becomes **No project**, visible before saving. Titles are literal: dates, project markers and priority tokens in copied titles are not reinterpreted by Quick Add.

The copy is a fresh to-do task with no parent, deadline, work block, reminder, or recurrence. Subtasks, notes, attachments, focus selection, recurrence defaults and provider mappings are not copied. Optional timing can be entered explicitly in the review form. The source task is never modified.

This uses the existing create-task API and authorization. Normal synchronization settings still apply to the newly created task; duplication does not bypass or change them. No database or API contract changes.
