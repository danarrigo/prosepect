# Prosepect

Prosepect is a self-hostable personal productivity web application that brings tasks, projects, notes, and calendars into one daily command center.

> **Project status:** active development. The current executable vertical slice includes complete task and project workflows, tenant isolation, optimistic concurrency, an OpenAPI contract, in-app reminders, and responsive Today, Projects, and task-calendar views. Calendar event storage, notes, Google OAuth, synchronization, files, and background notifications are specified in [PRD.md](PRD.md) but are not implemented yet.

## Current architecture

- Rust, Axum, Tokio, and SQLx API
- PostgreSQL canonical datastore
- Vue 3, TypeScript, Vite, and Tailwind CSS frontend
- REST API with generated OpenAPI TypeScript types
- Docker Compose self-hosting foundation

MongoDB, S3-compatible object storage, Google Calendar, Web Push, AWS Lambda, and EventBridge are introduced only in the milestones that need them.

## Repository layout

```text
apps/api/       Axum API and PostgreSQL adapter
apps/web/       Vue single-page application
migrations/     PostgreSQL migrations
openapi/        Generated API contract
PRD.md          Authoritative product requirements
```

## Run with Docker Compose

Prerequisites: Docker with Compose support.

```bash
docker compose up --build
```

Open:

- Application: <http://localhost:8080>
- OpenAPI documentation: <http://localhost:8080/docs/>

The current development build uses an intentionally insecure local user header. Compose binds the web port to `127.0.0.1` so it is not reachable from the LAN, and the API refuses to enable this mode when `APP_ENV=production`.

## Run locally

Prerequisites:

- Rust 1.94 or newer
- Node.js 22.13 or newer
- PostgreSQL 16 or newer

Create a database and configure the environment:

```bash
cp .env.example .env
export DATABASE_URL=postgres://prosepect:prosepect@localhost:5432/prosepect
```

Install frontend dependencies and start both processes:

```bash
npm install
cargo run -p prosepect-api --bin prosepect-api
npm run dev:web
```

The frontend runs at <http://localhost:5173>. Swagger UI runs at <http://localhost:3000/docs/>.

## Implemented workflows

- Standalone and project tasks with descriptions, priorities, statuses, deadlines, labels, and reminders
- Nested subtasks with atomic cycle protection
- Daily, weekly, monthly, and yearly recurrence anchored to the prior scheduled deadline
- Search, status/priority/label filters, multiple sort modes, drag ordering, and keyboard-accessible ordering controls
- Project editing, status changes, progress, archiving and restoration, and completed-task views
- Responsive seven-day and monthly task calendars with system-aware dark mode

## Keyboard shortcuts

- `N` opens the new-task dialog when focus is not in an editable field.
- `Ctrl+Enter` or `Cmd+Enter` creates the task from the dialog.
- `Escape` closes the dialog.

## Quality checks

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
DATABASE_URL=postgres://prosepect:prosepect@localhost:5432/postgres cargo test --workspace

npm run typecheck:web
npm run lint:web
npm run test:web
npm run build:web
```

Browser tests require the API and PostgreSQL to be running:

```bash
npm run test:e2e
```

## API contract

Regenerate the OpenAPI document and frontend types after changing API schemas or routes:

```bash
npm run generate:api
```

Commit both `openapi/openapi.json` and `apps/web/src/api/schema.d.ts` with the API change.

## Security status

Google OAuth and production sessions are not implemented yet. Do not expose the current API publicly with development authentication enabled. See [PRD.md](PRD.md) for the intended production security model.

## License

Prosepect is licensed under the [GNU Affero General Public License v3.0](LICENSE). AGPL requires network users to be offered the source of modified deployed versions. It does not prohibit third parties from providing paid hosting.
