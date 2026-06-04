#[tauri::command]
pub async fn codex_turn_start(app: AppHandle, input: CodexTurnStartInput) -> CodexTurnStartResult {
    match tauri::async_runtime::spawn_blocking(move || codex_turn_start_blocking(app, input)).await
    {
        Ok(result) => result,
        Err(error) => {
            let at = now_iso();
            CodexTurnStartResult {
                turn: CodexTurn {
                    id: id("codex-turn"),
                    thread_id: "unknown".to_string(),
                    status: "failed".to_string(),
                    mode: "plan".to_string(),
                    started_at: at.clone(),
                    completed_at: Some(at.clone()),
                },
                items: vec![CodexItem {
                    id: id("codex-error"),
                    thread_id: "unknown".to_string(),
                    turn_id: None,
                    kind: "error".to_string(),
                    title: "Codex Turn Failed".to_string(),
                    text: format!("Codex worker failed: {error}"),
                    status: "failed".to_string(),
                    created_at: at,
                    metadata: Some(json!({ "code": "turn_worker_failed" })),
                }],
            }
        }
    }
}

fn emit_failed_turn_start(
    app: &AppHandle,
    base_turn: &CodexTurn,
    title: &str,
    text: String,
    metadata: Value,
) -> CodexTurnStartResult {
    let result = failed_turn_start_result(base_turn, title, text, metadata);
    if let Some(item) = result.items.first() {
        emit_codex_item_upsert(app, item.clone());
    }
    emit_codex_turn(app, &result.turn);
    result
}

fn failed_turn_start_result(
    base_turn: &CodexTurn,
    title: &str,
    text: String,
    metadata: Value,
) -> CodexTurnStartResult {
    let failed_turn = CodexTurn {
        status: "failed".to_string(),
        completed_at: Some(now_iso()),
        ..base_turn.clone()
    };
    let item = CodexItem {
        id: id("codex-error"),
        thread_id: base_turn.thread_id.clone(),
        turn_id: Some(base_turn.id.clone()),
        kind: "error".to_string(),
        title: title.to_string(),
        text,
        status: "failed".to_string(),
        created_at: base_turn.started_at.clone(),
        metadata: Some(metadata),
    };
    CodexTurnStartResult {
        turn: failed_turn,
        items: vec![item],
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexTurnRoute {
    DirectProviderPlan,
    CodexAppServerBuild,
}

fn codex_turn_route(input: &CodexTurnStartInput) -> CodexTurnRoute {
    let requested = input.runtime_mode.as_deref();
    if input.mode == "plan"
        || matches!(
            requested,
            Some("direct-provider-plan") | Some("direct-deepseek-plan")
        )
    {
        CodexTurnRoute::DirectProviderPlan
    } else {
        CodexTurnRoute::CodexAppServerBuild
    }
}

fn codex_turn_start_blocking(app: AppHandle, input: CodexTurnStartInput) -> CodexTurnStartResult {
    let at = now_iso();
    let turn_id = id("codex-turn");
    let runtime_mode = input.runtime_mode.clone().unwrap_or_else(|| {
        if input.mode == "build" {
            "codex-app-server-build".to_string()
        } else {
            "direct-provider-plan".to_string()
        }
    });
    let running_turn = CodexTurn {
        id: turn_id.clone(),
        thread_id: input.thread_id.clone(),
        status: "running".to_string(),
        mode: input.mode.clone(),
        started_at: at.clone(),
        completed_at: None,
    };
    if input.mode == "build" && input.provider_id != "deepseek" {
        begin_runtime_operation(
            input.operation_id.clone(),
            "build",
            Some(input.thread_id.clone()),
            Some(running_turn.id.clone()),
            Duration::from_secs(25),
        );
        patch_runtime_operation_status(
            "failed",
            Some("failed"),
            Some(format!("{} is discovery-only until its Codex bridge adapter is verified", input.provider_id)),
        );
        return emit_failed_turn_start(
            &app,
            &running_turn,
            "Provider blocked",
            format!(
                "{} is discovery-only until its Codex bridge adapter is verified",
                input.provider_id
            ),
            json!({
                "code": "provider_blocked",
                "providerId": input.provider_id,
                "model": input.model,
                "runtimeMode": runtime_mode
            }),
        );
    }
    if codex_turn_route(&input) == CodexTurnRoute::DirectProviderPlan {
        begin_runtime_operation(
            input.operation_id.clone(),
            "plan",
            Some(input.thread_id.clone()),
            Some(running_turn.id.clone()),
            Duration::from_secs(25),
        );
        emit_codex_turn(&app, &running_turn);
        let background_app = app.clone();
        let background_input = input.clone();
        let background_turn = running_turn.clone();
        thread::spawn(move || {
            match run_codex_turn_through_orbit_bridge(
                &background_app,
                &background_input,
                &background_turn.id,
            ) {
                Ok(_) => {
                    patch_runtime_operation_status("completed", Some("completed"), None);
                    emit_codex_turn(
                        &background_app,
                        &CodexTurn {
                        status: "completed".to_string(),
                        completed_at: Some(now_iso()),
                        ..background_turn
                        },
                    );
                    emit_runtime_status(
                        &background_app,
                        "ready",
                        None,
                        background_input.operation_id.clone(),
                        Some("plan".to_string()),
                    );
                }
                Err(error) => {
                    patch_runtime_operation_status("failed", Some("failed"), Some(error.clone()));
                    let item = CodexItem {
                        id: id("codex-error"),
                        thread_id: background_input.thread_id.clone(),
                        turn_id: Some(background_turn.id.clone()),
                        kind: "error".to_string(),
                        title: "Plan Failed".to_string(),
                        text: error.clone(),
                        status: "failed".to_string(),
                        created_at: background_turn.started_at.clone(),
                        metadata: Some(json!({
                            "code": "direct_provider_plan_failed",
                            "providerId": background_input.provider_id,
                            "model": background_input.model,
                            "runtimeMode": runtime_mode
                        })),
                    };
                    emit_codex_item_upsert(&background_app, item);
                    emit_codex_turn(
                        &background_app,
                        &CodexTurn {
                            status: "failed".to_string(),
                            completed_at: Some(now_iso()),
                            ..background_turn
                        },
                    );
                    emit_runtime_status(
                        &background_app,
                        "error",
                        Some(error),
                        background_input.operation_id.clone(),
                        Some("plan".to_string()),
                    );
                }
            }
        });
        return CodexTurnStartResult {
            turn: running_turn,
            items: Vec::new(),
        };
    }
    if let Err(error) = super::get_provider_credential("deepseek").and_then(|credential| {
        credential.ok_or_else(|| deepseek_missing_credential_error("deepseek").message)
    }) {
        begin_runtime_operation(
            input.operation_id.clone(),
            "build",
            Some(input.thread_id.clone()),
            Some(running_turn.id.clone()),
            Duration::from_secs(25),
        );
        patch_runtime_operation_status("failed", Some("failed"), Some(error.clone()));
        return emit_failed_turn_start(
            &app,
            &running_turn,
            "Codex Build blocked",
            error,
            json!({
                "code": "codex_build_missing_credential",
                "providerId": input.provider_id,
                "model": input.model,
                "runtimeMode": runtime_mode
            }),
        );
    }
    emit_codex_turn(&app, &running_turn);
    let background_app = app.clone();
    let background_input = input.clone();
    let background_turn = running_turn.clone();
    thread::spawn(move || {
        begin_runtime_operation(
            background_input.operation_id.clone(),
            "build",
            Some(background_input.thread_id.clone()),
            Some(background_turn.id.clone()),
            Duration::from_secs(25),
        );
        let result = persistent_start_turn(&background_app, &background_input, &background_turn.id)
            .map(|_| ());
        if let Err(error) = result {
            patch_runtime_operation_status("failed", Some("failed"), Some(error.clone()));
            let item = CodexItem {
                id: id("codex-error"),
                thread_id: background_input.thread_id.clone(),
                turn_id: Some(background_turn.id.clone()),
                kind: "error".to_string(),
                title: "Codex Turn Failed".to_string(),
                text: error.clone(),
                status: "failed".to_string(),
                created_at: background_turn.started_at.clone(),
                metadata: Some(json!({
                    "code": "turn_failed",
                    "providerId": background_input.provider_id,
                    "model": background_input.model,
                })),
            };
            emit_codex_item_upsert(&background_app, item);
            emit_codex_turn(
                &background_app,
                &CodexTurn {
                    status: "failed".to_string(),
                    completed_at: Some(now_iso()),
                    ..background_turn
                },
            );
            emit_runtime_status(
                &background_app,
                "error",
                Some(error),
                background_input.operation_id.clone(),
                Some("build".to_string()),
            );
        }
    });
    CodexTurnStartResult {
        turn: running_turn,
        items: Vec::new(),
    }
}

fn run_codex_turn_through_app_server(
    app: &AppHandle,
    input: &CodexTurnStartInput,
) -> Result<(Vec<CodexItem>, Option<String>), String> {
    if input.provider_id != "deepseek" {
        return Err(format!(
            "{} is discovery-only until its Codex bridge adapter is verified",
            input.provider_id
        ));
    }
    if super::get_provider_credential("deepseek")?.is_none() {
        return Err(deepseek_missing_credential_error("deepseek").message);
    }

    let (mut reader, _status) = spawn_app_server_process(&input.provider_id)?;
    let mut client = CodexJsonRpcClient::new();
    let mut items = Vec::new();
    let mut sequence = 0u64;

    let initialize_id = write_client_request(
        &mut client,
        "initialize",
        json!({
            "clientInfo": { "name": "orbit-code", "title": "Orbit Code", "version": env!("CARGO_PKG_VERSION") },
            "capabilities": null
        }),
    )?;
    let _ = wait_for_app_server_response(
        app,
        &mut reader,
        &mut client,
        initialize_id,
        None,
        &mut items,
        &mut sequence,
    )?;
    write_active_app_server_payload(&json!({ "method": "initialized" }))?;

    let sandbox = if input.mode == "plan" {
        json!("read-only")
    } else {
        json!("workspace-write")
    };
    let approval_policy = codex_app_server_approval_policy(&input.mode);
    let thread_id_request = write_client_request(
        &mut client,
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
    )?;
    let thread_response = wait_for_app_server_response(
        app,
        &mut reader,
        &mut client,
        thread_id_request,
        None,
        &mut items,
        &mut sequence,
    )?;
    let app_thread_id = thread_response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Codex thread/start response missing thread id: {thread_response}"))?
        .to_string();
    if let Ok(mut guard) = active_app_server().lock() {
        guard.app_thread_id = Some(app_thread_id.clone());
    }
    let mut context = AppServerRunContext {
        orbit_thread_id: input.thread_id.clone(),
        orbit_turn_id: None,
        app_thread_id: app_thread_id.clone(),
        app_turn_id: None,
        mode: input.mode.clone(),
    };

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
    let turn_request_id = write_client_request(
        &mut client,
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
    )?;
    let turn_response = wait_for_app_server_response(
        app,
        &mut reader,
        &mut client,
        turn_request_id,
        Some(&mut context),
        &mut items,
        &mut sequence,
    )?;
    if let Some(app_turn_id) = turn_response
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(Value::as_str)
    {
        context.app_turn_id = Some(app_turn_id.to_string());
        if let Ok(mut guard) = active_app_server().lock() {
            guard.app_turn_id = Some(app_turn_id.to_string());
        }
    }
    if let Some(raw_items) = turn_response
        .get("turn")
        .and_then(|turn| turn.get("items"))
        .and_then(Value::as_array)
    {
        for raw in raw_items {
            if let Some(item) =
                codex_item_from_thread_item(raw, &input.thread_id, context.app_turn_id.as_deref())
            {
                emit_codex_item_upsert(app, item.clone());
                if !items.iter().any(|existing| existing.id == item.id) {
                    items.push(item);
                }
            }
        }
    }
    read_app_server_until_turn_complete(
        app,
        &mut reader,
        &mut client,
        &mut context,
        &mut items,
        &mut sequence,
    )?;
    let app_turn_id = context.app_turn_id.clone();
    cleanup_active_app_server();
    Ok((items, app_turn_id))
}

fn run_codex_turn_through_orbit_bridge(
    app: &AppHandle,
    input: &CodexTurnStartInput,
    turn_id: &str,
) -> Result<Vec<CodexItem>, String> {
    let provider_kind =
        direct_plan_provider_kind(&input.provider_id, input.base_url.as_deref())?;
    let api_key = if provider_kind == DirectPlanProviderKind::Ollama {
        None
    } else {
        Some(
            super::get_provider_credential(&input.provider_id)?.ok_or_else(|| {
                format!(
                    "API Key for {} is not unlocked in Orbit credential vault",
                    input.provider_id
                )
            })?,
        )
    };
    let system = if input.mode == "plan" {
        "You are Orbit Code's planning agent. Use the provided real workspace snapshot as ground truth. If the user asks what is in the project, answer from that snapshot. Do not invent files. Do not claim to have executed write operations."
    } else {
        "You are Orbit Code's build agent. Use the provided real workspace snapshot as ground truth. Answer with concrete next steps. Do not claim to have executed local commands or file writes unless a tool result is provided."
    };
    let workspace_snapshot = collect_workspace_snapshot(&input.workspace_path)
        .unwrap_or_else(|error| format!("Workspace snapshot unavailable: {error}"));
    let user_content = format!(
        "# User request\n{}\n\n# Current workspace snapshot\n{}",
        input.prompt, workspace_snapshot
    );
    let mut items = match provider_kind {
        DirectPlanProviderKind::OpenAiCompatible => {
            let api_model = direct_plan_api_model(&input.provider_id, &input.model);
            let payload = json!({
                "model": api_model,
                "messages": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": user_content }
                ],
                "stream": true,
                "stream_options": { "include_usage": true }
            });
            post_deepseek_chat_streaming(
                app,
                &input.provider_id,
                input.base_url.as_deref(),
                api_key.as_deref().unwrap_or_default(),
                &payload,
                &input.thread_id,
                turn_id,
            )?
        }
        DirectPlanProviderKind::Anthropic => {
            let payload = anthropic_plan_payload(&input.model, system, &user_content);
            post_anthropic_messages_streaming(
                app,
                api_key.as_deref().unwrap_or_default(),
                &payload,
                &input.thread_id,
                turn_id,
            )?
        }
        DirectPlanProviderKind::Google => {
            let payload = google_plan_payload(system, &user_content);
            post_google_generate_content_streaming(
                app,
                api_key.as_deref().unwrap_or_default(),
                &input.model,
                &payload,
                &input.thread_id,
                turn_id,
            )?
        }
        DirectPlanProviderKind::Ollama => {
            let payload = ollama_plan_payload(&input.model, system, &user_content);
            post_ollama_chat_streaming(app, &payload, &input.thread_id, turn_id)?
        }
    };
    if items.is_empty() {
        let item = CodexItem {
            id: id("codex-assistant"),
            thread_id: input.thread_id.clone(),
            turn_id: Some(turn_id.to_string()),
            kind: "assistant".to_string(),
            title: "Assistant".to_string(),
            text: "Codex completed the turn without text output.".to_string(),
            status: "completed".to_string(),
            created_at: now_iso(),
            metadata: None,
        };
        emit_codex_item_upsert(app, item.clone());
        items.push(item);
    }
    Ok(items)
}

fn collect_workspace_snapshot(workspace_path: &str) -> Result<String, String> {
    if workspace_path.trim().is_empty() {
        return Ok("No workspace is selected.".to_string());
    }
    let root = PathBuf::from(workspace_path)
        .canonicalize()
        .map_err(|e| format!("Unable to open workspace: {e}"))?;
    if !root.is_dir() {
        return Err("Workspace path is not a directory".to_string());
    }

    let mut tree = Vec::new();
    let mut files = Vec::new();
    collect_workspace_entries(&root, &root, 0, &mut tree, &mut files)?;
    let mut body = String::new();
    body.push_str(&format!("Workspace root: {}\n\n", root.display()));
    body.push_str("Files and directories:\n");
    if tree.is_empty() {
        body.push_str("- <empty>\n");
    } else {
        for line in tree.iter().take(180) {
            body.push_str(line);
            body.push('\n');
        }
        if tree.len() > 180 {
            body.push_str(&format!(
                "- ... {} more entries omitted\n",
                tree.len() - 180
            ));
        }
    }

    let important = select_workspace_context_files(&files);
    if !important.is_empty() {
        body.push_str("\nSelected file contents:\n");
        for path in important {
            let rel = relative_workspace_path(&root, &path);
            match fs::read_to_string(&path) {
                Ok(content) => {
                    body.push_str(&format!("\n--- {rel} ---\n"));
                    body.push_str(&truncate_chars(&content, 5000));
                    if content.chars().count() > 5000 {
                        body.push_str("\n[truncated]\n");
                    }
                }
                Err(_) => {
                    body.push_str(&format!("\n--- {rel} ---\n[unreadable as UTF-8]\n"));
                }
            }
        }
    }
    Ok(body)
}

fn collect_workspace_entries(
    root: &Path,
    dir: &Path,
    depth: usize,
    tree: &mut Vec<String>,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if depth > 4 || tree.len() >= 260 {
        return Ok(());
    }
    let mut entries = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_ascii_lowercase());

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if should_skip_workspace_dir(&name) {
                continue;
            }
            tree.push(format!("- {}/", relative_workspace_path(root, &path)));
            collect_workspace_entries(root, &path, depth + 1, tree, files)?;
        } else if path.is_file() {
            if should_skip_workspace_file(&name) {
                continue;
            }
            tree.push(format!("- {}", relative_workspace_path(root, &path)));
            files.push(path);
        }
        if tree.len() >= 260 {
            break;
        }
    }
    Ok(())
}

fn relative_workspace_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn should_skip_workspace_dir(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "dist" | "build" | "target" | ".next" | ".turbo" | ".vite"
    )
}

fn should_skip_workspace_file(name: &str) -> bool {
    name == ".DS_Store"
        || name.ends_with(".png")
        || name.ends_with(".jpg")
        || name.ends_with(".jpeg")
        || name.ends_with(".gif")
        || name.ends_with(".webp")
        || name.ends_with(".ico")
        || name.ends_with(".icns")
        || name.ends_with(".lock")
        || name.ends_with(".map")
}

fn select_workspace_context_files(files: &[PathBuf]) -> Vec<PathBuf> {
    let mut scored = files
        .iter()
        .filter_map(|path| workspace_context_score(path).map(|score| (score, path.clone())))
        .collect::<Vec<_>>();
    scored.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    scored.into_iter().take(8).map(|(_, path)| path).collect()
}

fn workspace_context_score(path: &Path) -> Option<u8> {
    let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
    let rel = path.to_string_lossy().to_ascii_lowercase();
    if name == "project_structure.md" {
        return Some(0);
    }
    if name == "readme.md" || name == "readme" {
        return Some(1);
    }
    if name == "package.json" || name == "cargo.toml" || name == "pyproject.toml" {
        return Some(2);
    }
    if name == "index.html" || name == "main.ts" || name == "main.tsx" || name == "app.tsx" {
        return Some(3);
    }
    if rel.contains("/src/")
        && (name.ends_with(".ts") || name.ends_with(".tsx") || name.ends_with(".js"))
    {
        return Some(4);
    }
    if name.ends_with(".md") {
        return Some(5);
    }
    None
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    input.chars().take(max_chars).collect()
}

#[tauri::command]
pub fn codex_turn_interrupt(thread_id: String, turn_id: String) -> Result<(), String> {
    if thread_id.trim().is_empty() || turn_id.trim().is_empty() {
        return Err("threadId and turnId are required to interrupt a Codex turn".to_string());
    }
    let (app_thread_id, app_turn_id) = {
        let guard = active_app_server().lock().map_err(|e| e.to_string())?;
        (
            guard.app_thread_id.clone().unwrap_or(thread_id),
            guard.app_turn_id.clone().unwrap_or(turn_id),
        )
    };
    write_active_app_server_payload(&json!({
        "id": numeric_request_id(),
        "method": "turn/interrupt",
        "params": {
            "threadId": app_thread_id,
            "turnId": app_turn_id
        }
    }))
}

#[tauri::command]
pub fn codex_approval_submit(
    app: AppHandle,
    action_id: String,
    approved: bool,
    answer: Option<String>,
) -> Result<(), String> {
    if action_id.trim().is_empty() {
        return Err("actionId is required to resolve a Codex approval".to_string());
    }
    record_app_server_stage(
        "approval-submit:begin",
        json!({ "actionId": action_id, "approved": approved, "hasAnswer": answer.is_some() }),
    );
    let pending = {
        let mut guard = active_app_server().lock().map_err(|e| e.to_string())?;
        guard.pending_requests.remove(&action_id)
    }
    .ok_or_else(|| {
        record_app_server_stage(
            "approval-submit:missing-request",
            json!({ "actionId": action_id, "approved": approved }),
        );
        format!("No active Codex app-server approval request for {action_id}")
    })?;
    let result = app_server_response_payload_for_action(&pending, approved, answer.clone());
    let response_payload = json!({
        "id": pending.request_id,
        "result": result
    });
    if let Err(error) = write_active_app_server_payload(&response_payload) {
        record_app_server_stage(
            "approval-submit:write-error",
            json!({
                "actionId": pending.action_id,
                "requestId": pending.request_id,
                "method": pending.method,
                "approved": approved,
                "error": error
            }),
        );
        return Err(error);
    }
    record_app_server_stage(
        "approval-submit:sent",
        json!({
            "actionId": pending.action_id,
            "requestId": pending.request_id,
            "method": pending.method,
            "approved": approved
        }),
    );
    let item = CodexItem {
        id: pending.action_id,
        thread_id: pending.orbit_thread_id,
        turn_id: pending.orbit_turn_id,
        kind: if pending.method.contains("requestUserInput")
            || pending.method.contains("elicitation")
        {
            "question".to_string()
        } else {
            "approval".to_string()
        },
        title: if pending.method.contains("requestUserInput")
            || pending.method.contains("elicitation")
        {
            "Codex question".to_string()
        } else {
            "Codex approval".to_string()
        },
        text: if approved {
            "Resolved by user."
        } else {
            "Denied by user."
        }
        .to_string(),
        status: if approved { "completed" } else { "denied" }.to_string(),
        created_at: now_iso(),
        metadata: Some(json!({
            "appServerRequestId": pending.request_id,
            "appServerMethod": pending.method,
            "answer": answer,
            "source": "orbit-approval-submit"
        })),
    };
    emit_codex_item_upsert(&app, item);
    Ok(())
}
