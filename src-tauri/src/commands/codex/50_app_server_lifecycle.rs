#[tauri::command]
pub async fn codex_thread_start(
    _app: AppHandle,
    input: CodexThreadStartInput,
) -> CodexThreadStartResult {
    match tauri::async_runtime::spawn_blocking(move || codex_thread_start_blocking(input))
        .await
    {
        Ok(result) => result,
        Err(error) => {
            let at = now_iso();
            CodexThreadStartResult {
                thread: CodexThread {
                    id: id("codex-thread"),
                    title: "Codex sidecar thread".to_string(),
                    workspace_path: None,
                    archived: Some(false),
                    created_at: at.clone(),
                    updated_at: at,
                },
                sidecar: CodexSidecarStatus {
                    running: false,
                    pid: None,
                    bridge_base_url: None,
                    codex_home: None,
                    last_error: Some(format!("Codex worker failed: {error}")),
                    last_stderr_tail: None,
                    last_exit_code: None,
                },
            }
        }
    }
}

fn codex_thread_start_blocking(
    input: CodexThreadStartInput,
) -> CodexThreadStartResult {
    let at = now_iso();
    let orbit_thread_id = input
        .thread_id
        .clone()
        .unwrap_or_else(|| id("codex-thread"));
    let sidecar = codex_sidecar_status();
    CodexThreadStartResult {
        thread: CodexThread {
            id: orbit_thread_id,
            title: input
                .title
                .unwrap_or_else(|| "Codex sidecar thread".to_string()),
            workspace_path: Some(input.workspace_path),
            archived: Some(false),
            created_at: at.clone(),
            updated_at: at,
        },
        sidecar,
    }
}

fn prepare_codex_sidecar(provider_id: &str) -> CodexSidecarStatus {
    let bridge = match ensure_bridge_started(provider_id) {
        Ok(status) if status.status == "ready" => status,
        Ok(status) => {
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: status.base_url,
                codex_home: None,
                last_error: status.blocked_reason,
                last_stderr_tail: None,
                last_exit_code: None,
            }
        }
        Err(error) => {
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: None,
                codex_home: None,
                last_error: Some(error),
                last_stderr_tail: None,
                last_exit_code: None,
            }
        }
    };
    let bridge_base_url = bridge
        .base_url
        .unwrap_or_else(|| "http://127.0.0.1:0/v1".to_string());
    let codex_home = match CodexConfigWriter::new(&bridge_base_url).write_temp_home() {
        Ok(path) => path,
        Err(error) => {
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: Some(bridge_base_url),
                codex_home: None,
                last_error: Some(error),
                last_stderr_tail: None,
                last_exit_code: None,
            }
        }
    };
    if let Err(error) = resolve_codex_binary() {
        return CodexSidecarStatus {
            running: false,
            pid: None,
            bridge_base_url: Some(bridge_base_url),
            codex_home: Some(codex_home.display().to_string()),
            last_error: Some(error),
            last_stderr_tail: None,
            last_exit_code: None,
        };
    }
    if let Ok(mut guard) = state().lock() {
        guard.bridge_base_url = Some(bridge_base_url.clone());
        guard.codex_home = Some(codex_home.display().to_string());
        guard.last_error = None;
    }
    CodexSidecarStatus {
        running: true,
        pid: None,
        bridge_base_url: Some(bridge_base_url),
        codex_home: Some(codex_home.display().to_string()),
        last_error: None,
        last_stderr_tail: None,
        last_exit_code: None,
    }
}

fn spawn_app_server_process(
    provider_id: &str,
) -> Result<(BufReader<std::process::ChildStdout>, CodexSidecarStatus), String> {
    let bridge = ensure_bridge_started(provider_id)?;
    if bridge.status != "ready" {
        return Err(bridge
            .blocked_reason
            .unwrap_or_else(|| "Responses bridge is not ready".to_string()));
    }
    let bridge_base_url = bridge
        .base_url
        .clone()
        .unwrap_or_else(|| "http://127.0.0.1:0/v1".to_string());
    let codex_home = CodexConfigWriter::new(&bridge_base_url).write_temp_home()?;
    let codex_binary = resolve_codex_binary()?;
    let mut child = Command::new(&codex_binary)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Codex sidecar is not available at {}: {error}",
                codex_binary.display()
            )
        })?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex app-server stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex app-server stdout unavailable".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                record_sidecar_stderr(&line);
                line.clear();
            }
        });
    }
    let previous_child = {
        let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
        let previous = guard.child.take();
        guard.connection_id = Some(id("codex-connection"));
        guard.stdin = Some(stdin);
        guard.child = Some(child);
        guard.pending_requests.clear();
        guard.app_thread_id = None;
        guard.app_turn_id = None;
        previous
    };
    if let Some(mut previous) = previous_child {
        let _ = previous.kill();
        let _ = previous.wait();
    }
    {
        let mut guard = state().lock().map_err(|e| e.to_string())?;
        guard.bridge_base_url = Some(bridge_base_url.clone());
        guard.codex_home = Some(codex_home.display().to_string());
        guard.last_error = None;
        guard.last_stderr_tail = None;
        guard.last_exit_code = None;
    }
    Ok((
        BufReader::new(stdout),
        CodexSidecarStatus {
            running: true,
            pid: Some(pid),
            bridge_base_url: Some(bridge_base_url),
            codex_home: Some(codex_home.display().to_string()),
            last_error: None,
            last_stderr_tail: None,
            last_exit_code: None,
        },
    ))
}

fn spawn_persistent_app_server_process(
    app: AppHandle,
    provider_id: &str,
) -> Result<CodexSidecarStatus, String> {
    let bridge = ensure_bridge_started(provider_id)?;
    if bridge.status != "ready" {
        return Err(bridge
            .blocked_reason
            .unwrap_or_else(|| "Responses bridge is not ready".to_string()));
    }
    let bridge_base_url = bridge
        .base_url
        .clone()
        .unwrap_or_else(|| "http://127.0.0.1:0/v1".to_string());
    let codex_home = CodexConfigWriter::new(&bridge_base_url).write_temp_home()?;
    let codex_binary = resolve_codex_binary()?;
    let mut child = Command::new(&codex_binary)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "Codex sidecar is not available at {}: {error}",
                codex_binary.display()
            )
        })?;
    let pid = child.id();
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex app-server stdin unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex app-server stdout unavailable".to_string())?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap_or(0) > 0 {
                record_sidecar_stderr(&line);
                line.clear();
            }
        });
    }
    let connection_id = id("codex-connection");
    let previous_child = {
        let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
        let previous = guard.child.take();
        guard.connection_id = Some(connection_id.clone());
        guard.stdin = Some(stdin);
        guard.child = Some(child);
        guard.pending_requests.clear();
        guard.pending_responses.clear();
        guard.app_thread_id = None;
        guard.app_turn_id = None;
        guard.provider_id = Some(provider_id.to_string());
        guard.orbit_to_app_thread.clear();
        guard.app_to_orbit_thread.clear();
        guard.active_context = None;
        guard.sequence = 0;
        previous
    };
    if let Some(mut previous) = previous_child {
        let _ = previous.kill();
        let _ = previous.wait();
    }
    {
        let mut guard = state().lock().map_err(|e| e.to_string())?;
        guard.bridge_base_url = Some(bridge_base_url.clone());
        guard.codex_home = Some(codex_home.display().to_string());
        guard.last_error = None;
        guard.last_stderr_tail = None;
        guard.last_exit_code = None;
    }
    thread::spawn(move || {
        persistent_app_server_reader_loop(app, BufReader::new(stdout), connection_id)
    });
    Ok(CodexSidecarStatus {
        running: true,
        pid: Some(pid),
        bridge_base_url: Some(bridge_base_url),
        codex_home: Some(codex_home.display().to_string()),
        last_error: None,
        last_stderr_tail: None,
        last_exit_code: None,
    })
}

fn ensure_persistent_app_server(
    app: &AppHandle,
    provider_id: &str,
) -> Result<CodexSidecarStatus, String> {
    let reuse = {
        let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
        let provider_matches = guard.provider_id.as_deref() == Some(provider_id);
        if provider_matches {
            let has_stdin = guard.stdin.is_some();
            if let Some(child) = guard.child.as_mut() {
                if process_running(child) && has_stdin {
                    let pid = child.id();
                    let state_guard = state().lock().map_err(|e| e.to_string())?;
                    Some(CodexSidecarStatus {
                        running: true,
                        pid: Some(pid),
                        bridge_base_url: state_guard.bridge_base_url.clone(),
                        codex_home: state_guard.codex_home.clone(),
                        last_error: state_guard.last_error.clone(),
                        last_stderr_tail: state_guard.last_stderr_tail.clone(),
                        last_exit_code: state_guard.last_exit_code,
                    })
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            None
        }
    };
    if let Some(status) = reuse {
        return Ok(status);
    }

    cleanup_active_app_server();
    let status = spawn_persistent_app_server_process(app.clone(), provider_id)?;
    let initialize = persistent_app_server_request_wait(
        "initialize",
        json!({
            "clientInfo": { "name": "orbit-code", "title": "Orbit Code", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": null
        }),
        Duration::from_secs(15),
    )?;
    if initialize.get("error").is_some() {
        return Err(format!("Codex initialize failed: {initialize}"));
    }
    write_active_app_server_payload(&json!({ "method": "initialized" }))?;
    Ok(status)
}

fn persistent_app_server_reader_loop(
    app: AppHandle,
    mut reader: BufReader<std::process::ChildStdout>,
    connection_id: String,
) {
    let mut client = CodexJsonRpcClient::new();
    loop {
        let current_connection = active_connection_id();
        if current_connection.as_deref() != Some(connection_id.as_str()) {
            return;
        }
        let mut line = String::new();
        let bytes = match reader.read_line(&mut line) {
            Ok(bytes) => bytes,
            Err(error) => {
                persistent_app_server_fail_all_for_connection(
                    format!("Failed reading Codex app-server output: {error}"),
                    &connection_id,
                );
                return;
            }
        };
        if bytes == 0 {
            persistent_app_server_fail_all_for_connection(
                "Codex app-server exited".to_string(),
                &connection_id,
            );
            if let Ok(mut guard) = active_app_server().lock() {
                if guard.connection_id.as_deref() != Some(connection_id.as_str()) {
                    return;
                }
                guard.stdin = None;
                guard.connection_id = None;
                guard.child = None;
                guard.active_context = None;
                guard.app_turn_id = None;
            }
            return;
        }
        match client.handle_line(&line) {
            CodexJsonRpcDispatch::Response { id, result } => {
                if let Ok(mut guard) = active_app_server().lock() {
                    if let Some(tx) = guard.pending_responses.remove(&id) {
                        let _ = tx.send(Ok(result));
                    }
                }
            }
            CodexJsonRpcDispatch::Error { id, error } => {
                let message = json_error_message(&error);
                if let Some(id) = id {
                    if let Ok(mut guard) = active_app_server().lock() {
                        if let Some(tx) = guard.pending_responses.remove(&id) {
                            let _ = tx.send(Err(message.clone()));
                        }
                    }
                }
                persistent_emit_context_error(&app, message);
            }
            CodexJsonRpcDispatch::Notification { method, params } => {
                persistent_handle_notification(&app, &method, params.as_ref());
            }
            CodexJsonRpcDispatch::ServerRequest { id, method, params } => {
                persistent_handle_server_request(&app, id, &method, params.as_ref());
            }
            CodexJsonRpcDispatch::Invalid(error) => {
                persistent_emit_context_error(
                    &app,
                    format!("Invalid Codex app-server JSON-RPC: {error}"),
                );
            }
        }
    }
}

fn persistent_app_server_fail_all(message: String) {
    persistent_app_server_fail_all_inner(message, None);
}

fn persistent_app_server_fail_all_for_connection(message: String, connection_id: &str) {
    persistent_app_server_fail_all_inner(message, Some(connection_id));
}

fn persistent_app_server_fail_all_inner(message: String, connection_id: Option<&str>) {
    if let Ok(mut guard) = active_app_server().lock() {
        if let Some(expected) = connection_id {
            if guard.connection_id.as_deref() != Some(expected) {
                return;
            }
        }
        let pending = std::mem::take(&mut guard.pending_responses);
        for (_, tx) in pending {
            let _ = tx.send(Err(message.clone()));
        }
    }
    clear_active_app_server_after_failure_for_connection(&message, true, connection_id);
}

fn persistent_emit_context_error(app: &AppHandle, message: String) {
    let context = active_app_server()
        .lock()
        .ok()
        .and_then(|guard| guard.active_context.clone());
    if let Some(context) = context {
        let item = codex_error_item(
            &context.orbit_thread_id,
            context.effective_turn_id(),
            message,
        );
        emit_codex_item_upsert(app, item);
    }
}

fn persistent_handle_server_request(
    app: &AppHandle,
    request_id: u64,
    method: &str,
    params: Option<&Value>,
) {
    let context = active_app_server()
        .lock()
        .ok()
        .and_then(|guard| guard.active_context.clone());
    if let Some(mut context) = context {
        let mut items = Vec::new();
        handle_app_server_request(app, request_id, method, params, &mut context, &mut items);
    } else {
        let _ = write_active_app_server_payload(&json!({
            "id": request_id,
            "error": { "code": "not_ready", "message": "Orbit has no active Codex turn for this request" }
        }));
    }
}

fn notification_completes_persistent_turn(
    method: &str,
    params: &Value,
    context: &AppServerRunContext,
) -> bool {
    let completed = method == "turn/completed"
        && params
            .get("turn")
            .and_then(|turn| turn.get("id"))
            .and_then(Value::as_str)
            == context.app_turn_id.as_deref();
    let thread_idle = method == "thread/status/changed"
        && params.get("threadId").and_then(Value::as_str) == Some(context.app_thread_id.as_str())
        && params
            .get("status")
            .and_then(|status| status.get("type"))
            .and_then(Value::as_str)
            == Some("idle");
    completed || thread_idle
}

fn persistent_context_from_notification(params: &Value) -> Option<AppServerRunContext> {
    let app_thread_id = if let Some(thread_id) =
        params.get("threadId").and_then(Value::as_str).or_else(|| {
            params
                .get("turn")
                .and_then(|turn| turn.get("threadId"))
                .and_then(Value::as_str)
        }) {
        thread_id.to_string()
    } else {
        active_app_server()
            .lock()
            .ok()
            .and_then(|guard| guard.app_thread_id.clone())?
    };
    let orbit_thread_id = active_app_server()
        .lock()
        .ok()
        .and_then(|guard| guard.app_to_orbit_thread.get(&app_thread_id).cloned())?;
    Some(AppServerRunContext {
        orbit_thread_id,
        orbit_turn_id: None,
        app_thread_id,
        app_turn_id: None,
        mode: "plan".to_string(),
    })
}

fn persistent_handle_notification(app: &AppHandle, method: &str, params: Option<&Value>) {
    let params = params.unwrap_or(&Value::Null);
    let mut context = {
        let guard = match active_app_server().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        guard
            .active_context
            .clone()
            .or_else(|| persistent_context_from_notification(params))
    };
    let Some(mut context) = context.take() else {
        return;
    };
    let mut items = Vec::new();
    let mut sequence = active_app_server()
        .lock()
        .ok()
        .map(|guard| guard.sequence)
        .unwrap_or(0);
    handle_app_server_notification(
        app,
        method,
        Some(params),
        &mut context,
        &mut items,
        &mut sequence,
    );
    let completed = notification_completes_persistent_turn(method, params, &context);
    if let Ok(mut guard) = active_app_server().lock() {
        guard.sequence = sequence;
        if completed {
            patch_runtime_operation_status("completed", Some("completed"), None);
            guard.active_context = None;
            guard.app_turn_id = None;
            guard
                .pending_requests
                .retain(|_, request| request.orbit_thread_id != context.orbit_thread_id);
        } else {
            guard.app_thread_id = Some(context.app_thread_id.clone());
            guard.app_turn_id = context.app_turn_id.clone();
            guard.active_context = Some(context);
        }
    }
}

fn cached_or_start_app_thread(input: &CodexTurnStartInput) -> Result<String, String> {
    if let Some(existing) = active_app_server()
        .lock()
        .map_err(|e| e.to_string())?
        .orbit_to_app_thread
        .get(&input.thread_id)
        .cloned()
    {
        return Ok(existing);
    }
    let sandbox = if input.mode == "plan" {
        json!("read-only")
    } else {
        json!("workspace-write")
    };
    let approval_policy = codex_app_server_approval_policy(&input.mode);
    let response = persistent_app_server_request_wait(
        "thread/start",
        json!({
            "model": input.model,
            "modelProvider": "orbit-bridge",
            "cwd": input.workspace_path,
            "approvalPolicy": approval_policy,
            "approvalsReviewer": "user",
            "sandbox": sandbox,
            "ephemeral": false,
            "serviceName": "Orbit Code"
        }),
        Duration::from_secs(20),
    )?;
    let app_thread_id = response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Codex thread/start response missing thread id: {response}"))?
        .to_string();
    if let Ok(mut guard) = active_app_server().lock() {
        guard.app_thread_id = Some(app_thread_id.clone());
        guard
            .orbit_to_app_thread
            .insert(input.thread_id.clone(), app_thread_id.clone());
        guard
            .app_to_orbit_thread
            .insert(app_thread_id.clone(), input.thread_id.clone());
    }
    Ok(app_thread_id)
}

fn persistent_start_turn(
    app: &AppHandle,
    input: &CodexTurnStartInput,
    orbit_turn_id: &str,
) -> Result<Option<String>, String> {
    let _status = ensure_persistent_app_server(app, &input.provider_id)?;
    let app_thread_id = cached_or_start_app_thread(input)?;
    let sandbox_policy = if input.mode == "plan" {
        json!({ "type": "readOnly", "networkAccess": false })
    } else {
        json!({
            "type": "workspaceWrite",
            "writableRoots": [input.workspace_path],
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false
        })
    };
    let approval_policy = codex_app_server_approval_policy(&input.mode);
    {
        let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
        guard.active_context = Some(AppServerRunContext {
            orbit_thread_id: input.thread_id.clone(),
            orbit_turn_id: Some(orbit_turn_id.to_string()),
            app_thread_id: app_thread_id.clone(),
            app_turn_id: None,
            mode: input.mode.clone(),
        });
        guard.app_thread_id = Some(app_thread_id.clone());
        guard.app_turn_id = None;
    }
    let response = persistent_app_server_request_wait(
        "turn/start",
        json!({
            "threadId": app_thread_id,
            "input": [{ "type": "text", "text": input.prompt, "text_elements": [] }],
            "cwd": input.workspace_path,
            "approvalPolicy": approval_policy,
            "approvalsReviewer": "user",
            "sandboxPolicy": sandbox_policy,
            "model": input.model,
            "effort": codex_app_server_effort(input.reasoning_effort.as_deref())
        }),
        Duration::from_secs(20),
    )?;
    let app_turn_id = response
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(app_turn_id) = app_turn_id.clone() {
        if let Ok(mut guard) = active_app_server().lock() {
            guard.app_turn_id = Some(app_turn_id.clone());
            if let Some(context) = guard.active_context.as_mut() {
                context.app_turn_id = Some(app_turn_id.clone());
            }
        }
        emit_codex_turn(
            app,
            &CodexTurn {
                id: app_turn_id.clone(),
                thread_id: input.thread_id.clone(),
                status: "running".to_string(),
                mode: input.mode.clone(),
                started_at: now_iso(),
                completed_at: None,
            },
        );
        Ok(Some(app_turn_id))
    } else {
        if let Ok(mut guard) = active_app_server().lock() {
            if let Some(context) = guard.active_context.as_mut() {
                context.app_turn_id = Some(orbit_turn_id.to_string());
            }
        }
        Ok(None)
    }
}

fn wait_for_app_server_response(
    app: &AppHandle,
    reader: &mut BufReader<std::process::ChildStdout>,
    client: &mut CodexJsonRpcClient,
    target_id: u64,
    context: Option<&mut AppServerRunContext>,
    items: &mut Vec<CodexItem>,
    sequence: &mut u64,
) -> Result<Value, String> {
    let mut context = context;
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading Codex app-server output: {e}"))?;
        if bytes == 0 {
            return Err("Codex app-server exited before returning a response".to_string());
        }
        match client.handle_line(&line) {
            CodexJsonRpcDispatch::Response { id, result } if id == target_id => return Ok(result),
            CodexJsonRpcDispatch::Error { id, error } if id == Some(target_id) => {
                return Err(json_error_message(&error));
            }
            CodexJsonRpcDispatch::Notification { method, params } => {
                if let Some(ctx) = context.as_deref_mut() {
                    handle_app_server_notification(
                        app,
                        &method,
                        params.as_ref(),
                        ctx,
                        items,
                        sequence,
                    );
                }
            }
            CodexJsonRpcDispatch::ServerRequest { id, method, params } => {
                if let Some(ctx) = context.as_deref_mut() {
                    handle_app_server_request(app, id, &method, params.as_ref(), ctx, items);
                } else {
                    let _ = write_active_app_server_payload(&json!({
                        "id": id,
                        "error": { "code": "not_ready", "message": "Orbit is not ready to handle Codex server requests" }
                    }));
                }
            }
            CodexJsonRpcDispatch::Error { error, .. } => {
                if let Some(ctx) = context.as_deref_mut() {
                    let item = codex_error_item(
                        &ctx.orbit_thread_id,
                        ctx.effective_turn_id(),
                        json_error_message(&error),
                    );
                    emit_codex_item_upsert(app, item.clone());
                    items.push(item);
                }
            }
            CodexJsonRpcDispatch::Invalid(_) | CodexJsonRpcDispatch::Response { .. } => {}
        }
    }
}

fn read_app_server_until_turn_complete(
    app: &AppHandle,
    reader: &mut BufReader<std::process::ChildStdout>,
    client: &mut CodexJsonRpcClient,
    context: &mut AppServerRunContext,
    items: &mut Vec<CodexItem>,
    sequence: &mut u64,
) -> Result<(), String> {
    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading Codex app-server output: {e}"))?;
        if bytes == 0 {
            return Err("Codex app-server exited before turn completion".to_string());
        }
        match client.handle_line(&line) {
            CodexJsonRpcDispatch::Notification { method, params } => {
                let completed = method == "turn/completed"
                    && params
                        .as_ref()
                        .and_then(|params| params.get("turn"))
                        .and_then(|turn| turn.get("id"))
                        .and_then(Value::as_str)
                        == context.app_turn_id.as_deref();
                let thread_idle = method == "thread/status/changed"
                    && params
                        .as_ref()
                        .and_then(|params| params.get("threadId"))
                        .and_then(Value::as_str)
                        == Some(context.app_thread_id.as_str())
                    && params
                        .as_ref()
                        .and_then(|params| params.get("status"))
                        .and_then(|status| status.get("type"))
                        .and_then(Value::as_str)
                        == Some("idle");
                handle_app_server_notification(
                    app,
                    &method,
                    params.as_ref(),
                    context,
                    items,
                    sequence,
                );
                if completed || thread_idle {
                    return Ok(());
                }
            }
            CodexJsonRpcDispatch::ServerRequest { id, method, params } => {
                handle_app_server_request(app, id, &method, params.as_ref(), context, items);
            }
            CodexJsonRpcDispatch::Error { error, .. } => {
                let item = codex_error_item(
                    &context.orbit_thread_id,
                    context.effective_turn_id(),
                    json_error_message(&error),
                );
                emit_codex_item_upsert(app, item.clone());
                items.push(item);
            }
            CodexJsonRpcDispatch::Response { .. } | CodexJsonRpcDispatch::Invalid(_) => {}
        }
    }
}

fn stable_codex_error_id(thread_id: &str, turn_id: Option<&str>) -> String {
    let scope = turn_id.unwrap_or(thread_id);
    let sanitized = scope
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let sanitized = if sanitized.is_empty() {
        "session".to_string()
    } else {
        sanitized
    };
    format!("codex-error-{sanitized}-app-server")
}

fn codex_error_item(thread_id: &str, turn_id: Option<&str>, message: String) -> CodexItem {
    CodexItem {
        id: stable_codex_error_id(thread_id, turn_id),
        thread_id: thread_id.to_string(),
        turn_id: turn_id.map(str::to_string),
        kind: "error".to_string(),
        title: "Codex app-server error".to_string(),
        text: message,
        status: "failed".to_string(),
        created_at: now_iso(),
        metadata: Some(json!({ "code": "app_server_error" })),
    }
}
