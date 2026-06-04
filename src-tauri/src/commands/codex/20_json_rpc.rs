pub struct CodexConfigWriter {
    base_url: String,
}

impl CodexConfigWriter {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
        }
    }

    pub fn config_toml(&self) -> String {
        format!(
            "model_provider = \"orbit-bridge\"\n\n[model_providers.orbit-bridge]\nname = \"Orbit Responses Bridge\"\nbase_url = \"{}\"\nwire_api = \"responses\"\n",
            self.base_url
        )
    }

    pub fn write_temp_home(&self) -> Result<PathBuf, String> {
        let path = std::env::temp_dir().join(format!("orbit-codex-home-{}", id("config")));
        fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        fs::write(path.join("config.toml"), self.config_toml()).map_err(|e| e.to_string())?;
        Ok(path)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CodexJsonRpcDispatch {
    Response {
        id: u64,
        result: Value,
    },
    Error {
        id: Option<u64>,
        error: Value,
    },
    Notification {
        method: String,
        params: Option<Value>,
    },
    ServerRequest {
        id: u64,
        method: String,
        params: Option<Value>,
    },
    Invalid(String),
}

pub struct CodexJsonRpcClient {
    next_request_id: u64,
    pending: HashMap<u64, String>,
}

impl CodexJsonRpcClient {
    pub fn new() -> Self {
        Self {
            next_request_id: 1,
            pending: HashMap::new(),
        }
    }

    pub fn request(&mut self, method: &str, params: Value) -> Result<(u64, String), String> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        self.pending.insert(request_id, method.to_string());
        let payload = json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        });
        let mut raw = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
        raw.push('\n');
        Ok((request_id, raw))
    }

    pub fn handle_line(&mut self, line: &str) -> CodexJsonRpcDispatch {
        let parsed = match serde_json::from_str::<Value>(line.trim()) {
            Ok(value) => value,
            Err(error) => return CodexJsonRpcDispatch::Invalid(error.to_string()),
        };
        let id = parsed.get("id").and_then(Value::as_u64);
        if let Some(method) = parsed.get("method").and_then(Value::as_str) {
            if id.is_none() {
                return CodexJsonRpcDispatch::Notification {
                    method: method.to_string(),
                    params: parsed.get("params").cloned(),
                };
            }
            if parsed.get("result").is_none() && parsed.get("error").is_none() {
                return CodexJsonRpcDispatch::ServerRequest {
                    id: id.unwrap_or(0),
                    method: method.to_string(),
                    params: parsed.get("params").cloned(),
                };
            }
        }
        if let Some(error) = parsed.get("error") {
            if let Some(id) = id {
                self.pending.remove(&id);
            }
            return CodexJsonRpcDispatch::Error {
                id,
                error: error.clone(),
            };
        }
        if let Some(result) = parsed.get("result") {
            if let Some(id) = id {
                self.pending.remove(&id);
                return CodexJsonRpcDispatch::Response {
                    id,
                    result: result.clone(),
                };
            }
        }
        CodexJsonRpcDispatch::Invalid("Unsupported JSON-RPC message".to_string())
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }
}

pub fn codex_event_for_notification(method: &str) -> &'static str {
    match method {
        "item"
        | "codex/item"
        | "codex.item"
        | "thread/item"
        | "item/started"
        | "item/completed"
        | "rawResponseItem/completed"
        | "item/agentMessage/delta"
        | "item/plan/delta"
        | "item/reasoning/textDelta"
        | "item/reasoning/summaryTextDelta"
        | "item/commandExecution/outputDelta"
        | "command/exec/outputDelta"
        | "process/outputDelta"
        | "item/fileChange/outputDelta"
        | "item/fileChange/patchUpdated"
        | "thread/tokenUsage/updated"
        | "error"
        | "warning"
        | "guardianWarning"
        | "configWarning" => CODEX_EVENT_ITEM,
        "turn"
        | "codex/turn"
        | "codex.turn"
        | "thread/turn"
        | "turn/started"
        | "turn/completed"
        | "thread/status/changed" => CODEX_EVENT_TURN,
        "status" | "codex/status" | "codex.status" | "thread/started" => CODEX_EVENT_STATUS,
        _ => CODEX_EVENT_ERROR,
    }
}

pub struct CodexSidecarManager;

impl CodexSidecarManager {
    pub fn status() -> CodexSidecarStatus {
        codex_sidecar_status()
    }

    pub fn start(provider_id: &str) -> CodexSidecarStatus {
        ensure_sidecar(provider_id)
    }

    pub fn stop() -> Result<(), String> {
        let mut guard = state().lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = guard.child.take() {
            child.kill().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct AppServerRunContext {
    orbit_thread_id: String,
    orbit_turn_id: Option<String>,
    app_thread_id: String,
    app_turn_id: Option<String>,
    mode: String,
}

impl AppServerRunContext {
    fn effective_turn_id(&self) -> Option<&str> {
        self.app_turn_id
            .as_deref()
            .or(self.orbit_turn_id.as_deref())
    }
}

fn json_error_message(error: &Value) -> String {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| {
            error
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .or_else(|| error.get("error").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| error.to_string());
    if let Some(details) = error.get("additionalDetails").and_then(Value::as_str) {
        if !details.trim().is_empty() && !message.contains(details) {
            return format!("{message}\n{details}");
        }
    }
    message
}

fn app_server_notification_message(method: &str, params: &Value) -> String {
    let message = params
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| json_error_message(params))
        .trim()
        .to_string()
        .trim_matches('"')
        .to_string()
        .chars()
        .collect::<String>()
        .trim()
        .to_string();
    if message.is_empty() {
        method.to_string()
    } else {
        message
    }
}

fn app_server_json_rpc_payload(payload: &Value) -> Value {
    let Some(object) = payload.as_object() else {
        return payload.clone();
    };
    let is_json_rpc_shape = object.contains_key("id")
        || object.contains_key("method")
        || object.contains_key("result")
        || object.contains_key("error");
    if !is_json_rpc_shape || object.contains_key("jsonrpc") {
        return payload.clone();
    }
    let mut next = object.clone();
    next.insert("jsonrpc".to_string(), json!("2.0"));
    Value::Object(next)
}

fn write_active_app_server_payload(payload: &Value) -> Result<(), String> {
    let payload = app_server_json_rpc_payload(payload);
    let raw = format!(
        "{}\n",
        serde_json::to_string(&payload).map_err(|e| e.to_string())?
    );
    let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
    let stdin = guard
        .stdin
        .as_mut()
        .ok_or_else(|| "No active Codex app-server stdin is available".to_string())?;
    stdin
        .write_all(raw.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())
}

struct PersistentAppServerRequest {
    id: u64,
    rx: mpsc::Receiver<Result<Value, String>>,
}

fn clear_active_app_server_after_failure(message: &str, kill_child: bool) {
    clear_active_app_server_after_failure_for_connection(message, kill_child, None);
}

fn clear_active_app_server_after_failure_for_connection(
    message: &str,
    kill_child: bool,
    expected_connection_id: Option<&str>,
) {
    let mut exit_code = None;
    let mut pending_responses = HashMap::new();
    let mut child_to_stop = None;
    if let Ok(mut guard) = active_app_server().lock() {
        if let Some(expected) = expected_connection_id {
            if guard.connection_id.as_deref() != Some(expected) {
                return;
            }
        }
        pending_responses = std::mem::take(&mut guard.pending_responses);
        guard.stdin = None;
        guard.connection_id = None;
        guard.pending_requests.clear();
        guard.app_thread_id = None;
        guard.app_turn_id = None;
        guard.provider_id = None;
        guard.orbit_to_app_thread.clear();
        guard.app_to_orbit_thread.clear();
        guard.active_context = None;
        guard.last_stage = Some("failure-cleanup".to_string());
        guard.last_stage_at = Some(now_iso());
        guard.last_stage_metadata = Some(json!({ "message": message }));
        if let Some(operation) = guard.active_operation.as_mut() {
            operation.status = "failed".to_string();
            operation.final_state = Some("failed".to_string());
            operation.error = Some(message.to_string());
            operation.last_event_at = Some(now_iso());
        }
        guard.sequence = 0;
        guard.last_event_at = Some(now_iso());
        if let Some(mut child) = guard.child.take() {
            if let Ok(Some(status)) = child.try_wait() {
                exit_code = status.code();
            }
            child_to_stop = Some(child);
        }
    }
    if kill_child {
        if let Some(mut child) = child_to_stop {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    for (_, tx) in pending_responses {
        let _ = tx.send(Err(message.to_string()));
    }
    if let Ok(mut guard) = state().lock() {
        if exit_code.is_some() {
            guard.last_exit_code = exit_code;
        }
        guard.last_error = Some(runtime_error_with_diagnostics(
            message,
            guard.last_exit_code,
            guard.last_stderr_tail.as_deref(),
        ));
    }
}

fn remove_pending_app_server_response(request_id: u64) {
    if let Ok(mut guard) = active_app_server().lock() {
        guard.pending_responses.remove(&request_id);
    }
}

fn persistent_app_server_request(
    method: &str,
    params: Value,
) -> Result<PersistentAppServerRequest, String> {
    let (tx, rx) = mpsc::channel();
    let raw = {
        let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
        let request_id = guard.next_request_id;
        guard.next_request_id += 1;
        guard.pending_responses.insert(request_id, tx);
        let payload = json!({
            "id": request_id,
            "method": method,
            "params": params,
        });
        let raw = format!(
            "{}\n",
            serde_json::to_string(&payload).map_err(|e| e.to_string())?
        );
        let Some(stdin) = guard.stdin.as_mut() else {
            guard.pending_responses.remove(&request_id);
            let message = "No active Codex app-server stdin is available".to_string();
            drop(guard);
            clear_active_app_server_after_failure(&message, true);
            return Err(message);
        };
        if let Err(error) = stdin.write_all(raw.as_bytes()).and_then(|_| stdin.flush()) {
            guard.pending_responses.remove(&request_id);
            let message = format!("Failed writing Codex app-server {method} request: {error}");
            drop(guard);
            clear_active_app_server_after_failure(&message, true);
            return Err(message);
        }
        guard.last_stage = Some(format!("request:{method}:sent"));
        guard.last_stage_at = Some(now_iso());
        guard.last_stage_metadata = Some(json!({ "requestId": request_id, "method": method }));
        (request_id, raw)
    };
    if raw.1.is_empty() {
        remove_pending_app_server_response(raw.0);
        return Err("Failed to encode Codex app-server request".to_string());
    }
    Ok(PersistentAppServerRequest { id: raw.0, rx })
}

fn wait_for_persistent_response(
    request: PersistentAppServerRequest,
    operation: &str,
    timeout: Duration,
) -> Result<Value, String> {
    record_app_server_stage(
        &format!("request:{operation}:waiting"),
        json!({ "requestId": request.id, "method": operation, "timeoutMs": timeout.as_millis() }),
    );
    match request.rx.recv_timeout(timeout) {
        Ok(result) => {
            match &result {
                Ok(_) => record_app_server_stage(
                    &format!("response:{operation}:received"),
                    json!({ "requestId": request.id, "method": operation }),
                ),
                Err(error) => record_app_server_stage(
                    &format!("response:{operation}:error"),
                    json!({ "requestId": request.id, "method": operation, "error": error }),
                ),
            }
            result
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            remove_pending_app_server_response(request.id);
            let message = format!("Timed out waiting for Codex app-server {operation} response");
            record_app_server_stage(
                &format!("response:{operation}:timeout"),
                json!({ "requestId": request.id, "method": operation, "timeoutMs": timeout.as_millis() }),
            );
            clear_active_app_server_after_failure(&message, true);
            Err(message)
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            remove_pending_app_server_response(request.id);
            let message = format!("Codex app-server {operation} response channel disconnected");
            record_app_server_stage(
                &format!("response:{operation}:disconnected"),
                json!({ "requestId": request.id, "method": operation }),
            );
            clear_active_app_server_after_failure(&message, true);
            Err(message)
        }
    }
}

fn persistent_app_server_request_wait(
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let request = persistent_app_server_request(method, params)?;
    wait_for_persistent_response(request, method, timeout)
}

fn write_client_request(
    client: &mut CodexJsonRpcClient,
    method: &str,
    params: Value,
) -> Result<u64, String> {
    let (request_id, raw) = client.request(method, params)?;
    let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
    let stdin = guard
        .stdin
        .as_mut()
        .ok_or_else(|| "No active Codex app-server stdin is available".to_string())?;
    stdin
        .write_all(raw.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|e| e.to_string())?;
    Ok(request_id)
}

fn app_server_response_payload_for_action(
    pending: &PendingServerRequest,
    approved: bool,
    answer: Option<String>,
) -> Value {
    match pending.method.as_str() {
        "item/commandExecution/requestApproval" => json!({
            "decision": if approved { "accept" } else { "decline" }
        }),
        "item/fileChange/requestApproval" => json!({
            "decision": if approved { "accept" } else { "decline" }
        }),
        "item/permissions/requestApproval" => {
            if !approved {
                json!({
                    "permissions": {},
                    "scope": "turn",
                    "strictAutoReview": false
                })
            } else {
                let requested_permissions = pending
                    .params
                    .as_ref()
                    .and_then(|params| params.get("permissions"))
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let mut permissions = serde_json::Map::new();
                if let Some(network) = requested_permissions
                    .get("network")
                    .filter(|value| !value.is_null())
                    .cloned()
                {
                    permissions.insert("network".to_string(), network);
                }
                if let Some(file_system) = requested_permissions
                    .get("fileSystem")
                    .filter(|value| !value.is_null())
                    .cloned()
                {
                    permissions.insert("fileSystem".to_string(), file_system);
                }
                json!({
                    "permissions": Value::Object(permissions),
                    "scope": "turn",
                    "strictAutoReview": true
                })
            }
        }
        "item/tool/requestUserInput" => {
            let answer = answer.unwrap_or_default();
            let questions = pending
                .params
                .as_ref()
                .and_then(|params| params.get("questions"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut answers = serde_json::Map::new();
            for question in questions {
                if let Some(question_id) = question.get("id").and_then(Value::as_str) {
                    answers.insert(
                        question_id.to_string(),
                        json!({ "answers": [answer.clone()] }),
                    );
                }
            }
            if answers.is_empty() {
                answers.insert("answer".to_string(), json!({ "answers": [answer] }));
            }
            json!({
                "answers": Value::Object(answers)
            })
        }
        "mcpServer/elicitation/request" => {
            let answer = answer.unwrap_or_default();
            json!({
                "action": if approved { "accept" } else { "decline" },
                "content": if approved { json!({ "answer": answer }) } else { Value::Null },
                "_meta": Value::Null
            })
        }
        _ => json!({
            "decision": if approved { "approved" } else { "denied" },
            "answer": answer
        }),
    }
}

fn begin_runtime_operation(
    operation_id: Option<String>,
    kind: &str,
    thread_id: Option<String>,
    turn_id: Option<String>,
    timeout: Duration,
) {
    let Some(operation_id) = operation_id else {
        return;
    };
    let started_at = now_iso();
    let deadline_at = SystemTime::now()
        .checked_add(timeout)
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| format!("unix-ms:{}", duration.as_millis()))
        .unwrap_or_else(now_iso);
    if let Ok(mut guard) = active_app_server().lock() {
        guard.active_operation = Some(RuntimeOperationSnapshot {
            id: operation_id,
            connection_id: guard.connection_id.clone(),
            kind: kind.to_string(),
            status: "running".to_string(),
            thread_id: thread_id.clone(),
            turn_id: turn_id.clone(),
            started_at,
            deadline_at,
            last_event_at: None,
            cancelled: None,
            final_state: None,
            error: None,
        });
    }
    record_app_server_stage(
        &format!("operation:{kind}:running"),
        json!({ "threadId": thread_id, "turnId": turn_id }),
    );
}

fn patch_runtime_operation_status(
    status: &str,
    final_state: Option<&str>,
    error: Option<String>,
) {
    if let Ok(mut guard) = active_app_server().lock() {
        if let Some(operation) = guard.active_operation.as_mut() {
            operation.status = status.to_string();
            operation.last_event_at = Some(now_iso());
            operation.final_state = final_state.map(str::to_string);
            operation.cancelled = if final_state == Some("cancelled") {
                Some(true)
            } else {
                operation.cancelled
            };
            operation.error = error;
        }
    }
}

fn active_restart_operation() -> Option<RuntimeOperationSnapshot> {
    active_app_server().lock().ok().and_then(|guard| {
        guard.active_operation.as_ref().and_then(|operation| {
            if operation.kind == "restart"
                && (operation.status == "starting" || operation.status == "running")
            {
                Some(operation.clone())
            } else {
                None
            }
        })
    })
}

fn cleanup_active_app_server() {
    let mut pending_responses = HashMap::new();
    let mut child_to_kill = None;
    if let Ok(mut guard) = active_app_server().lock() {
        guard.stdin = None;
        guard.connection_id = None;
        pending_responses = std::mem::take(&mut guard.pending_responses);
        guard.pending_requests.clear();
        guard.app_thread_id = None;
        guard.app_turn_id = None;
        guard.provider_id = None;
        guard.orbit_to_app_thread.clear();
        guard.app_to_orbit_thread.clear();
        guard.active_context = None;
        if let Some(operation) = guard.active_operation.as_mut() {
            operation.status = "cancelled".to_string();
            operation.cancelled = Some(true);
            operation.final_state = Some("cancelled".to_string());
            operation.last_event_at = Some(now_iso());
        }
        guard.sequence = 0;
        guard.last_event_at = Some(now_iso());
        guard.last_stage = Some("cleanup".to_string());
        guard.last_stage_at = Some(now_iso());
        guard.last_stage_metadata = Some(json!({ "reason": "cleanup_active_app_server" }));
        child_to_kill = guard.child.take();
    }
    for (_, tx) in pending_responses {
        let _ = tx.send(Err("Codex app-server stopped".to_string()));
    }
    if let Some(mut child) = child_to_kill {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn stop_all_codex_processes() -> Result<(), String> {
    cleanup_active_app_server();
    let mut guard = state().lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

fn codex_file_change_metadata(changes: Value) -> Value {
    let patches = changes
        .as_array()
        .map(|items| {
            items
                .iter()
                .map(|change| {
                    let path = change
                        .get("path")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown");
                    let diff = change.get("diff").and_then(Value::as_str).unwrap_or("");
                    json!({
                        "path": path,
                        "oldContent": "",
                        "newContent": diff,
                        "applied": true,
                        "sandboxStatus": "sandboxed",
                        "applyStatus": "applied",
                        "sandboxOutput": diff,
                        "source": "codex-app-server-diff"
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "changes": changes,
        "patches": patches,
        "source": "codex-app-server"
    })
}

fn codex_app_server_effort(effort: Option<&str>) -> &'static str {
    match effort.unwrap_or("auto") {
        "none" => "none",
        "minimal" | "fast" => "minimal",
        "low" | "auto" => "low",
        "medium" | "balanced" => "medium",
        "high" | "deep" => "high",
        "xhigh" | "max" => "xhigh",
        _ => "low",
    }
}

fn codex_app_server_approval_policy(mode: &str) -> &'static str {
    if mode == "build" {
        "untrusted"
    } else {
        "on-request"
    }
}
