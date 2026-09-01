use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{HeaderName, HeaderValue, Method, header},
    middleware,
    routing::{get, post, put},
};
use tower_http::{
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    trace::TraceLayer,
};
use utoipa::{
    Modify, OpenApi,
    openapi::security::{ApiKey, ApiKeyValue, SecurityScheme},
};
use utoipa_swagger_ui::SwaggerUi;

use crate::{
    auth::{CSRF_HEADER, DEVELOPMENT_USER_HEADER, SESSION_COOKIE},
    calendar_routes,
    config::{Config, Environment},
    error::{ErrorBody, ErrorResponse},
    export_routes, file_routes,
    file_storage::FileStorage,
    google_auth::GoogleOAuth,
    import_routes,
    models::{
        ActivityEntry, ActivityList, Calendar, CalendarEvent, CalendarEventList, CalendarList,
        CalendarSource, CompleteDailyReviewRequest, CreateCalendarEventRequest,
        CreateCalendarRequest, CreateNoteRequest, CreateProjectRequest,
        CreateSynchronizationRequest, CreateTaskRequest, DailyPlan, DailyReview,
        DailyReviewResponse, DailyReviewStatus, DeleteAccountRequest, EventRecurrence, FileList,
        FileRecord, GoogleIntegrationStatus, HealthResponse, LabelList, Note, NoteList, Project,
        ProjectPage, ProjectStatus, ReorderTasksRequest, ResolveSyncConflictRequest,
        ReviewDecisionAction, ReviewTaskDecision, SearchResult, SearchResultKind, SearchResultList,
        SessionResponse, StartDailyReviewRequest, SyncConflict, SyncConflictList,
        SyncConflictPolicy, Synchronization, Task, TaskPage, TaskPriority, TaskRecurrence,
        TaskStatus, ThemePreference, TodoistImportRequest, TodoistImportResult, TodoistImportTask,
        UpdateCalendarEventRequest, UpdateCalendarRequest, UpdateDailyFocusRequest,
        UpdateNoteRequest, UpdateProjectRequest, UpdateTaskRequest, UpdateUserSettingsRequest,
        UserProfile, UserSettings,
    },
    note_routes, observability,
    rate_limit::LoginRateLimiter,
    routes,
    store::Store,
    sync_routes,
};

#[derive(Clone)]
pub struct AppState {
    pub store: Store,
    pub allow_insecure_dev_auth: bool,
    pub invite_only: bool,
    pub trust_proxy_headers: bool,
    pub login_rate_limiter: LoginRateLimiter,
    pub action_rate_limiter: LoginRateLimiter,
    pub secure_cookies: bool,
    pub app_url: String,
    pub google_oauth: Option<GoogleOAuth>,
    pub file_storage: FileStorage,
    pub max_file_size_bytes: usize,
    pub metrics: metrics_exporter_prometheus::PrometheusHandle,
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Prosepect API",
        version = "0.1.0",
        description = "Personal productivity API for Prosepect"
    ),
    paths(
        routes::health,
        routes::ready,
        routes::metrics,
        routes::development_session,
        routes::current_session,
        routes::logout,
        routes::get_settings,
        routes::update_settings,
        routes::record_reminder_delivery,
        routes::google_auth_start,
        routes::google_calendar_connect_start,
        routes::google_auth_callback,
        routes::get_daily_plan,
        routes::update_daily_focus,
        routes::start_daily_review,
        routes::complete_daily_review,
        routes::list_labels,
        routes::create_project,
        routes::list_projects,
        routes::update_project,
        routes::delete_project,
        routes::create_task,
        routes::list_tasks,
        routes::reorder_tasks,
        routes::update_task,
        routes::delete_task,
        calendar_routes::list_calendars,
        calendar_routes::create_calendar,
        calendar_routes::update_calendar,
        calendar_routes::delete_calendar,
        calendar_routes::list_events,
        calendar_routes::create_event,
        calendar_routes::update_event,
        calendar_routes::delete_event,
        note_routes::list_notes,
        note_routes::create_note,
        note_routes::update_note,
        note_routes::delete_note,
        note_routes::global_search,
        export_routes::export_json,
        export_routes::export_tasks_csv,
        export_routes::export_notes_markdown,
        export_routes::export_calendars_ics,
        export_routes::delete_account,
        import_routes::import_todoist,
        file_routes::list_files,
        file_routes::upload_file,
        file_routes::download_file,
        file_routes::delete_file,
        sync_routes::google_status,
        sync_routes::discover_google_calendars,
        sync_routes::revoke_google,
        sync_routes::create_synchronization,
        sync_routes::get_synchronization,
        sync_routes::list_conflicts,
        sync_routes::resolve_conflict,
        sync_routes::activity
    ),
    components(schemas(
        ErrorBody,
        ErrorResponse,
        HealthResponse,
        UserProfile,
        SessionResponse,
        ThemePreference,
        SyncConflictPolicy,
        UserSettings,
        UpdateUserSettingsRequest,
        DailyPlan,
        UpdateDailyFocusRequest,
        DailyReviewStatus,
        DailyReview,
        DailyReviewResponse,
        ReviewDecisionAction,
        ReviewTaskDecision,
        StartDailyReviewRequest,
        CompleteDailyReviewRequest,
        LabelList,
        CalendarSource,
        EventRecurrence,
        Calendar,
        CalendarList,
        CreateCalendarRequest,
        UpdateCalendarRequest,
        CalendarEvent,
        CalendarEventList,
        CreateCalendarEventRequest,
        UpdateCalendarEventRequest,
        Note,
        NoteList,
        CreateNoteRequest,
        UpdateNoteRequest,
        SearchResultKind,
        SearchResult,
        SearchResultList,
        DeleteAccountRequest,
        TodoistImportTask,
        TodoistImportRequest,
        TodoistImportResult,
        FileRecord,
        FileList,
        GoogleIntegrationStatus,
        Synchronization,
        CreateSynchronizationRequest,
        SyncConflict,
        SyncConflictList,
        ResolveSyncConflictRequest,
        ActivityEntry,
        ActivityList,
        ProjectStatus,
        Project,
        ProjectPage,
        CreateProjectRequest,
        UpdateProjectRequest,
        TaskStatus,
        TaskPriority,
        TaskRecurrence,
        Task,
        TaskPage,
        CreateTaskRequest,
        UpdateTaskRequest,
        ReorderTasksRequest
    )),
    modifiers(&DevelopmentSecurity),
    tags(
        (name = "system", description = "Health and readiness"),
        (name = "development", description = "Development-only session bootstrap"),
        (name = "settings", description = "User preferences"),
        (name = "projects", description = "Outcome-oriented projects"),
        (name = "tasks", description = "Project tasks"),
        (name = "calendars", description = "Native and connected calendars"),
        (name = "events", description = "Calendar events"),
        (name = "notes", description = "Markdown notes"),
        (name = "search", description = "Tenant-scoped global search"),
        (name = "exports", description = "Portable data exports"),
        (name = "imports", description = "Imports from other productivity tools"),
        (name = "account", description = "Account lifecycle"),
        (name = "files", description = "Authorized file attachments"),
        (name = "synchronization", description = "Google Calendar synchronization and activity")
    )
)]
pub struct ApiDoc;

struct DevelopmentSecurity;

impl Modify for DevelopmentSecurity {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "development_user",
                SecurityScheme::ApiKey(ApiKey::Header(ApiKeyValue::with_description(
                    DEVELOPMENT_USER_HEADER,
                    "Development-only user identifier.",
                ))),
            );
            components.add_security_scheme(
                "session_cookie",
                SecurityScheme::ApiKey(ApiKey::Cookie(ApiKeyValue::with_description(
                    SESSION_COOKIE,
                    "Secure HTTP-only user session cookie.",
                ))),
            );
        }
    }
}

pub fn build(config: &Config, store: Store) -> anyhow::Result<Router> {
    let origin: HeaderValue = config.cors_allowed_origin.parse()?;
    let request_id_header = HeaderName::from_static("x-request-id");
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE])
        .allow_headers([
            header::CONTENT_TYPE,
            HeaderName::from_static(DEVELOPMENT_USER_HEADER),
            HeaderName::from_static(CSRF_HEADER),
        ])
        .allow_credentials(true);
    let google_oauth = config
        .google_oauth
        .clone()
        .map(GoogleOAuth::new)
        .transpose()?;
    let file_storage = FileStorage::new(&config.object_storage)?;
    let state = AppState {
        store,
        allow_insecure_dev_auth: config.allow_insecure_dev_auth,
        invite_only: config.invite_only,
        trust_proxy_headers: config.trust_proxy_headers,
        login_rate_limiter: LoginRateLimiter::default(),
        action_rate_limiter: LoginRateLimiter::with_limit(60),
        secure_cookies: config.environment == Environment::Production,
        app_url: config.app_url.clone(),
        google_oauth,
        file_storage,
        max_file_size_bytes: config.max_file_size_bytes,
        metrics: observability::initialize_metrics(),
    };

    let api = Router::new()
        .route("/development/session", post(routes::development_session))
        .route("/session", get(routes::current_session))
        .route("/session/logout", post(routes::logout))
        .route(
            "/settings",
            get(routes::get_settings).put(routes::update_settings),
        )
        .route(
            "/telemetry/reminder-delivered",
            post(routes::record_reminder_delivery),
        )
        .route("/auth/google/start", get(routes::google_auth_start))
        .route(
            "/auth/google/calendar/start",
            get(routes::google_calendar_connect_start),
        )
        .route("/auth/google/callback", get(routes::google_auth_callback))
        .route("/daily-plans/{date}", get(routes::get_daily_plan))
        .route("/daily-plans/{date}/focus", put(routes::update_daily_focus))
        .route(
            "/daily-reviews/{date}/start",
            post(routes::start_daily_review),
        )
        .route(
            "/daily-reviews/{date}/complete",
            post(routes::complete_daily_review),
        )
        .route("/labels", get(routes::list_labels))
        .route(
            "/calendars",
            get(calendar_routes::list_calendars).post(calendar_routes::create_calendar),
        )
        .route(
            "/calendars/{calendar_id}",
            put(calendar_routes::update_calendar).delete(calendar_routes::delete_calendar),
        )
        .route(
            "/events",
            get(calendar_routes::list_events).post(calendar_routes::create_event),
        )
        .route(
            "/events/{event_id}",
            put(calendar_routes::update_event).delete(calendar_routes::delete_event),
        )
        .route(
            "/notes",
            get(note_routes::list_notes).post(note_routes::create_note),
        )
        .route(
            "/notes/{note_id}",
            put(note_routes::update_note).delete(note_routes::delete_note),
        )
        .route("/search", get(note_routes::global_search))
        .route("/exports/json", get(export_routes::export_json))
        .route("/exports/tasks.csv", get(export_routes::export_tasks_csv))
        .route("/imports/todoist", post(import_routes::import_todoist))
        .route(
            "/exports/notes.md",
            get(export_routes::export_notes_markdown),
        )
        .route(
            "/exports/calendars.ics",
            get(export_routes::export_calendars_ics),
        )
        .route(
            "/integrations/google",
            get(sync_routes::google_status).delete(sync_routes::revoke_google),
        )
        .route(
            "/integrations/google/calendars/discover",
            post(sync_routes::discover_google_calendars),
        )
        .route(
            "/synchronizations",
            post(sync_routes::create_synchronization),
        )
        .route(
            "/synchronizations/{synchronization_id}",
            get(sync_routes::get_synchronization),
        )
        .route("/sync-conflicts", get(sync_routes::list_conflicts))
        .route(
            "/sync-conflicts/{conflict_id}/resolve",
            post(sync_routes::resolve_conflict),
        )
        .route("/activity", get(sync_routes::activity))
        .route(
            "/account",
            axum::routing::delete(export_routes::delete_account),
        )
        .route(
            "/files",
            get(file_routes::list_files).post(file_routes::upload_file),
        )
        .route("/files/{file_id}/download", get(file_routes::download_file))
        .route(
            "/files/{file_id}",
            axum::routing::delete(file_routes::delete_file),
        )
        .route(
            "/projects",
            get(routes::list_projects).post(routes::create_project),
        )
        .route(
            "/projects/{project_id}",
            put(routes::update_project).delete(routes::delete_project),
        )
        .route("/tasks", get(routes::list_tasks).post(routes::create_task))
        .route("/tasks/order", put(routes::reorder_tasks))
        .route(
            "/tasks/{task_id}",
            put(routes::update_task).delete(routes::delete_task),
        );

    Ok(Router::new()
        .route("/health", get(routes::health))
        .route("/ready", get(routes::ready))
        .route("/metrics", get(routes::metrics))
        .nest("/api/v1", api)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", ApiDoc::openapi()))
        .fallback(routes::route_not_found)
        .method_not_allowed_fallback(routes::method_not_allowed)
        .with_state(state)
        .layer(DefaultBodyLimit::max(101 * 1024 * 1024))
        .layer(PropagateRequestIdLayer::new(request_id_header.clone()))
        .layer(SetRequestIdLayer::new(request_id_header, MakeRequestUuid))
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn(observability::track_http_metrics))
        .layer(cors))
}
