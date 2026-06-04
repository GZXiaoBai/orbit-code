#[derive(Debug, Clone, PartialEq, Eq)]
struct BridgeHttpResponse {
    status: String,
    content_type: String,
    body: Vec<u8>,
}

#[derive(Debug, Default)]
struct DeepSeekToolCallAccumulator {
    id: String,
    call_type: String,
    function_name: String,
    function_arguments: String,
}

impl BridgeHttpResponse {
    fn json(status: &str, payload: Value) -> Self {
        let body = serde_json::to_vec(&payload)
            .unwrap_or_else(|_| b"{\"error\":\"serialization failed\"}".to_vec());
        Self {
            status: status.to_string(),
            content_type: "application/json".to_string(),
            body,
        }
    }

    fn sse(status: &str, frames: Vec<Value>) -> Self {
        Self {
            status: status.to_string(),
            content_type: "text/event-stream".to_string(),
            body: encode_sse_frames(&frames).into_bytes(),
        }
    }

    fn json_value(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }

    fn body_text(&self) -> String {
        String::from_utf8_lossy(&self.body).to_string()
    }
}

struct CodexSidecarState {
    child: Option<Child>,
    bridge_base_url: Option<String>,
    codex_home: Option<String>,
    last_error: Option<String>,
    last_stderr_tail: Option<String>,
    last_exit_code: Option<i32>,
}

struct OrbitResponsesBridgeState {
    listener: Option<TcpListener>,
    status: CodexBridgeStatus,
}

#[derive(Debug, Clone)]
struct PendingServerRequest {
    request_id: u64,
    method: String,
    params: Option<Value>,
    action_id: String,
    orbit_thread_id: String,
    orbit_turn_id: Option<String>,
}

struct ActiveAppServerState {
    connection_id: Option<String>,
    stdin: Option<ChildStdin>,
    child: Option<Child>,
    pending_requests: HashMap<String, PendingServerRequest>,
    app_thread_id: Option<String>,
    app_turn_id: Option<String>,
    provider_id: Option<String>,
    next_request_id: u64,
    pending_responses: HashMap<u64, mpsc::Sender<Result<Value, String>>>,
    orbit_to_app_thread: HashMap<String, String>,
    app_to_orbit_thread: HashMap<String, String>,
    active_context: Option<AppServerRunContext>,
    active_operation: Option<RuntimeOperationSnapshot>,
    sequence: u64,
    last_event_at: Option<String>,
    stale_event_count: u64,
    last_stage: Option<String>,
    last_stage_at: Option<String>,
    last_stage_metadata: Option<Value>,
}

static CODEX_STATE: OnceLock<Mutex<CodexSidecarState>> = OnceLock::new();
static BRIDGE_STATE: OnceLock<Mutex<OrbitResponsesBridgeState>> = OnceLock::new();
static ACTIVE_APP_SERVER: OnceLock<Mutex<ActiveAppServerState>> = OnceLock::new();

fn state() -> &'static Mutex<CodexSidecarState> {
    CODEX_STATE.get_or_init(|| {
        Mutex::new(CodexSidecarState {
            child: None,
            bridge_base_url: None,
            codex_home: None,
            last_error: None,
            last_stderr_tail: None,
            last_exit_code: None,
        })
    })
}

fn bridge_state() -> &'static Mutex<OrbitResponsesBridgeState> {
    BRIDGE_STATE.get_or_init(|| {
        Mutex::new(OrbitResponsesBridgeState {
            listener: None,
            status: CodexBridgeStatus {
                status: "stopped".to_string(),
                base_url: None,
                active_provider: None,
                blocked_reason: None,
            },
        })
    })
}

fn active_app_server() -> &'static Mutex<ActiveAppServerState> {
    ACTIVE_APP_SERVER.get_or_init(|| {
        Mutex::new(ActiveAppServerState {
            stdin: None,
            connection_id: None,
            child: None,
            pending_requests: HashMap::new(),
            app_thread_id: None,
            app_turn_id: None,
            provider_id: None,
            next_request_id: 1,
            pending_responses: HashMap::new(),
            orbit_to_app_thread: HashMap::new(),
            app_to_orbit_thread: HashMap::new(),
            active_context: None,
            active_operation: None,
            sequence: 0,
            last_event_at: None,
            stale_event_count: 0,
            last_stage: None,
            last_stage_at: None,
            last_stage_metadata: None,
        })
    })
}

fn active_connection_id() -> Option<String> {
    active_app_server()
        .lock()
        .ok()
        .and_then(|guard| guard.connection_id.clone())
}

fn active_operation_id() -> Option<String> {
    active_app_server()
        .lock()
        .ok()
        .and_then(|guard| guard.active_operation.as_ref().map(|operation| operation.id.clone()))
}

fn mark_runtime_event_sent() {
    if let Ok(mut guard) = active_app_server().lock() {
        let at = now_iso();
        guard.last_event_at = Some(at.clone());
        if let Some(operation) = guard.active_operation.as_mut() {
            operation.last_event_at = Some(at);
        }
    }
}

fn runtime_diagnostics_path() -> Option<PathBuf> {
    env::var_os("ORBIT_APP_DATA_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|path| path.join("orbit_codex_runtime_diagnostics.json"))
}

fn record_app_server_stage(stage: &str, metadata: Value) {
    let at = now_iso();
    let snapshot = active_app_server()
        .lock()
        .ok()
        .map(|mut guard| {
            guard.last_stage = Some(stage.to_string());
            guard.last_stage_at = Some(at.clone());
            guard.last_stage_metadata = Some(metadata.clone());
            json!({
                "stage": stage,
                "stageAt": at,
                "metadata": metadata,
                "connectionId": guard.connection_id,
                "providerId": guard.provider_id,
                "appThreadId": guard.app_thread_id,
                "appTurnId": guard.app_turn_id,
                "pendingResponseCount": guard.pending_responses.len(),
                "pendingRequestCount": guard.pending_requests.len(),
                "activeOperation": guard.active_operation,
                "lastEventAt": guard.last_event_at,
                "staleEventCount": guard.stale_event_count
            })
        });
    let Some(snapshot) = snapshot else {
        return;
    };
    if let Some(path) = runtime_diagnostics_path() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(body) = serde_json::to_vec_pretty(&snapshot) {
            let _ = fs::write(path, body);
        }
    }
}

fn trim_runtime_tail(text: &str, max_chars: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let tail = text
        .chars()
        .rev()
        .take(max_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("...{tail}")
}

fn record_sidecar_stderr(line: &str) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    if let Ok(mut guard) = state().lock() {
        let next = match guard.last_stderr_tail.as_deref() {
            Some(previous) if !previous.is_empty() => format!("{previous}\n{trimmed}"),
            _ => trimmed.to_string(),
        };
        guard.last_stderr_tail = Some(trim_runtime_tail(&next, 4000));
    }
}

fn runtime_error_with_diagnostics(
    message: &str,
    exit_code: Option<i32>,
    stderr_tail: Option<&str>,
) -> String {
    let mut parts = vec![message.to_string()];
    if let Some(code) = exit_code {
        parts.push(format!("exit code: {code}"));
    }
    if let Some(stderr) = stderr_tail
        .map(str::trim)
        .filter(|stderr| !stderr.is_empty())
    {
        parts.push(format!("stderr: {}", trim_runtime_tail(stderr, 1200)));
    }
    parts.join("\n")
}

fn now_iso() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("unix-ms:{millis}")
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn id(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("{prefix}-{millis}")
}

fn numeric_request_id() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(1)
}

fn emit_codex_item_event(app: &AppHandle, event: CodexItemEvent) {
    mark_runtime_event_sent();
    let _ = app.emit(CODEX_EVENT_ITEM, event);
}

fn emit_codex_item_upsert(app: &AppHandle, item: CodexItem) {
    emit_codex_item_event(
        app,
        CodexItemEvent {
            event_type: "upsert".to_string(),
            item: Some(item),
            item_id: None,
            thread_id: None,
            turn_id: None,
            kind: None,
            title: None,
            text_delta: None,
            sequence: None,
            status: None,
            metadata: None,
            error: None,
            created_at: None,
            operation_id: active_operation_id(),
            connection_id: active_connection_id(),
        },
    );
}

fn emit_codex_delta(
    app: &AppHandle,
    item_id: &str,
    thread_id: &str,
    turn_id: &str,
    kind: &str,
    title: &str,
    delta: &str,
    sequence: u64,
) {
    if delta.is_empty() {
        return;
    }
    emit_codex_item_event(
        app,
        CodexItemEvent {
            event_type: "delta".to_string(),
            item: None,
            item_id: Some(item_id.to_string()),
            thread_id: Some(thread_id.to_string()),
            turn_id: Some(turn_id.to_string()),
            kind: Some(kind.to_string()),
            title: Some(title.to_string()),
            text_delta: Some(delta.to_string()),
            sequence: Some(sequence),
            status: Some("running".to_string()),
            metadata: None,
            error: None,
            created_at: Some(now_iso()),
            operation_id: active_operation_id(),
            connection_id: active_connection_id(),
        },
    );
}

fn emit_codex_complete(app: &AppHandle, item: &CodexItem) {
    emit_codex_item_event(
        app,
        CodexItemEvent {
            event_type: "complete".to_string(),
            item: Some(item.clone()),
            item_id: Some(item.id.clone()),
            thread_id: Some(item.thread_id.clone()),
            turn_id: item.turn_id.clone(),
            kind: Some(item.kind.clone()),
            title: Some(item.title.clone()),
            text_delta: None,
            sequence: None,
            status: Some(item.status.clone()),
            metadata: item.metadata.clone(),
            error: None,
            created_at: Some(item.created_at.clone()),
            operation_id: active_operation_id(),
            connection_id: active_connection_id(),
        },
    );
}

fn emit_codex_turn(app: &AppHandle, turn: &CodexTurn) {
    mark_runtime_event_sent();
    let _ = app.emit(
        CODEX_EVENT_TURN,
        json!({
            "id": &turn.id,
            "threadId": &turn.thread_id,
            "status": &turn.status,
            "mode": &turn.mode,
            "startedAt": &turn.started_at,
            "completedAt": &turn.completed_at,
            "operationId": active_operation_id(),
            "connectionId": active_connection_id(),
        }),
    );
}

fn emit_runtime_status(
    app: &AppHandle,
    status: &str,
    error: Option<String>,
    operation_id: Option<String>,
    operation_kind: Option<String>,
) {
    mark_runtime_event_sent();
    let sidecar_status = codex_sidecar_status();
    let _ = app.emit(
        CODEX_EVENT_STATUS,
        json!({
            "status": status,
            "error": error,
            "operationId": operation_id,
            "connectionId": active_connection_id(),
            "operationKind": operation_kind,
            "sidecarStatus": sidecar_status,
        }),
    );
}

fn process_running(child: &mut Child) -> bool {
    match child.try_wait() {
        Ok(Some(_)) => false,
        Ok(None) => true,
        Err(_) => false,
    }
}

fn is_executable_file(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn codex_binary_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.extend(bundled_codex_binary_candidates());
    for key in ["ORBIT_CODEX_BINARY", "CODEX_BINARY"] {
        if let Some(path) = env::var_os(key).filter(|value| !value.is_empty()) {
            candidates.push(PathBuf::from(path));
        }
    }
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            candidates.push(dir.join(if cfg!(windows) { "codex.exe" } else { "codex" }));
        }
    }
    candidates.extend([
        PathBuf::from("/Applications/Codex.app/Contents/Resources/codex"),
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
        dirs_home().join(".local/bin/codex"),
        dirs_home().join(".cargo/bin/codex"),
    ]);
    candidates
}

fn bundled_codex_binary_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let build_target = option_env!("ORBIT_BUILD_TARGET").unwrap_or("");
    let mut names = Vec::new();
    if !build_target.is_empty() {
        names.push(format!("codex-{build_target}"));
        if cfg!(windows) {
            names.push(format!("codex-{build_target}.exe"));
        }
    }
    names.push(if cfg!(windows) {
        "codex.exe".to_string()
    } else {
        "codex".to_string()
    });

    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            dirs.push(exe_dir.to_path_buf());
            dirs.push(exe_dir.join("binaries"));
            if let Some(contents_dir) = exe_dir.parent() {
                dirs.push(contents_dir.join("Resources"));
                dirs.push(contents_dir.join("Resources").join("binaries"));
            }
        }
    }
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));

    let mut candidates = Vec::new();
    for dir in dirs {
        for name in &names {
            candidates.push(dir.join(name));
        }
    }
    candidates
}

fn dirs_home() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(""))
}

fn resolve_codex_binary() -> Result<PathBuf, String> {
    let candidates = codex_binary_candidates();
    candidates
        .iter()
        .find(|path| is_executable_file(path))
        .cloned()
        .ok_or_else(|| {
            let searched = candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            format!("Codex binary not found. Searched: {searched}")
        })
}

fn file_sha256_hex(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn codex_binary_source(path: &Path) -> String {
    let manifest_binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if path.starts_with(&manifest_binaries) {
        return "prepared-sidecar".to_string();
    }
    if let Some(path_text) = path.to_str() {
        if path_text.contains(".app/Contents/") || path_text.contains("/Resources/") {
            return "bundled-sidecar".to_string();
        }
    }
    "external-path".to_string()
}

#[tauri::command]
pub fn codex_sidecar_version_info() -> CodexSidecarVersionInfo {
    match resolve_codex_binary() {
        Ok(path) => {
            let version = Command::new(&path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|output| {
                    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if text.is_empty() {
                        None
                    } else {
                        Some(text)
                    }
                });
            let sha256 = file_sha256_hex(&path).ok();
            CodexSidecarVersionInfo {
                version,
                path: Some(path.display().to_string()),
                sha256,
                source: codex_binary_source(&path),
            }
        }
        Err(error) => CodexSidecarVersionInfo {
            version: None,
            path: None,
            sha256: None,
            source: format!("missing: {error}"),
        },
    }
}
