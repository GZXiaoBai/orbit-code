fn text_from_user_input_items(items: &[Value]) -> String {
    items
        .iter()
        .filter_map(|item| match item.get("type").and_then(Value::as_str) {
            Some("text") => item.get("text").and_then(Value::as_str).map(str::to_string),
            Some("mention") => item
                .get("path")
                .and_then(Value::as_str)
                .map(|path| format!("@{path}")),
            Some("skill") => item
                .get("name")
                .and_then(Value::as_str)
                .map(|name| format!("skill:{name}")),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn codex_item_from_thread_item(
    raw: &Value,
    orbit_thread_id: &str,
    app_turn_id: Option<&str>,
) -> Option<CodexItem> {
    let item_type = raw.get("type").and_then(Value::as_str)?;
    let item_id = raw
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| id("codex-item"));
    let created_at = now_iso();
    let (kind, title, text, status, metadata) = match item_type {
        "userMessage" => {
            let content = raw
                .get("content")
                .and_then(Value::as_array)
                .map(|items| text_from_user_input_items(items))
                .unwrap_or_default();
            ("user", "User", content, "completed", None)
        }
        "agentMessage" => (
            "assistant",
            "Assistant",
            raw.get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            "completed",
            raw.get("phase")
                .cloned()
                .map(|phase| json!({ "phase": phase })),
        ),
        "plan" => (
            "planDraft",
            "Plan draft",
            raw.get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            "completed",
            None,
        ),
        "reasoning" => {
            let text = raw
                .get("content")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .filter(|text| !text.is_empty())
                .or_else(|| {
                    raw.get("summary").and_then(Value::as_array).map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                })
                .unwrap_or_default();
            ("reasoning", "Reasoning", text, "completed", None)
        }
        "commandExecution" => {
            let status = match raw.get("status").and_then(Value::as_str).unwrap_or("") {
                "inProgress" => "running",
                "failed" => "failed",
                "declined" => "denied",
                _ => "completed",
            };
            (
                "terminal",
                raw.get("command")
                    .and_then(Value::as_str)
                    .unwrap_or("Command"),
                raw.get("aggregatedOutput")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                status,
                Some(json!({
                    "command": raw.get("command").cloned().unwrap_or(Value::Null),
                    "cwd": raw.get("cwd").cloned().unwrap_or(Value::Null),
                    "exitCode": raw.get("exitCode").cloned().unwrap_or(Value::Null),
                    "source": "codex-app-server"
                })),
            )
        }
        "fileChange" => (
            "fileEdit",
            "File changes",
            "Codex produced file changes.".to_string(),
            if raw.get("status").and_then(Value::as_str) == Some("failed") {
                "failed"
            } else {
                "completed"
            },
            Some(codex_file_change_metadata(
                raw.get("changes").cloned().unwrap_or_else(|| json!([])),
            )),
        ),
        "mcpToolCall" | "dynamicToolCall" | "collabAgentToolCall" => (
            "command",
            raw.get("tool").and_then(Value::as_str).unwrap_or(item_type),
            raw.to_string(),
            "completed",
            Some(json!({ "raw": raw })),
        ),
        _ => return None,
    };
    Some(CodexItem {
        id: item_id,
        thread_id: orbit_thread_id.to_string(),
        turn_id: app_turn_id.map(str::to_string),
        kind: kind.to_string(),
        title: title.to_string(),
        text,
        status: status.to_string(),
        created_at,
        metadata,
    })
}

fn handle_app_server_notification(
    app: &AppHandle,
    method: &str,
    params: Option<&Value>,
    context: &mut AppServerRunContext,
    items: &mut Vec<CodexItem>,
    sequence: &mut u64,
) {
    let params = params.unwrap_or(&Value::Null);
    match method {
        "turn/started" => {
            if let Some(turn_id) = params
                .get("turn")
                .and_then(|turn| turn.get("id"))
                .and_then(Value::as_str)
            {
                context.app_turn_id = Some(turn_id.to_string());
                if let Ok(mut guard) = active_app_server().lock() {
                    guard.app_turn_id = Some(turn_id.to_string());
                }
                emit_codex_turn(
                    app,
                    &CodexTurn {
                        id: turn_id.to_string(),
                        thread_id: context.orbit_thread_id.clone(),
                        status: "running".to_string(),
                        mode: context.mode.clone(),
                        started_at: now_iso(),
                        completed_at: None,
                    },
                );
            }
        }
        "turn/completed" => {
            let turn = params.get("turn").unwrap_or(&Value::Null);
            let turn_id = turn
                .get("id")
                .and_then(Value::as_str)
                .or(context.app_turn_id.as_deref())
                .unwrap_or("");
            let status = match turn
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("completed")
            {
                "inProgress" => "running",
                other => other,
            };
            if let Some(raw_items) = turn.get("items").and_then(Value::as_array) {
                for raw in raw_items {
                    if let Some(item) =
                        codex_item_from_thread_item(raw, &context.orbit_thread_id, Some(turn_id))
                    {
                        emit_codex_complete(app, &item);
                        if !items.iter().any(|existing| existing.id == item.id) {
                            items.push(item);
                        }
                    }
                }
            }
            emit_codex_turn(
                app,
                &CodexTurn {
                    id: turn_id.to_string(),
                    thread_id: context.orbit_thread_id.clone(),
                    status: status.to_string(),
                    mode: context.mode.clone(),
                    started_at: now_iso(),
                    completed_at: Some(now_iso()),
                },
            );
        }
        "item/started" | "item/completed" | "rawResponseItem/completed" => {
            if let Some(item) = params.get("item").and_then(|raw| {
                codex_item_from_thread_item(
                    raw,
                    &context.orbit_thread_id,
                    context.effective_turn_id(),
                )
            }) {
                if method == "item/started" {
                    emit_codex_item_upsert(
                        app,
                        CodexItem {
                            status: "running".to_string(),
                            ..item.clone()
                        },
                    );
                } else {
                    emit_codex_complete(app, &item);
                }
                if !items.iter().any(|existing| existing.id == item.id) {
                    items.push(item);
                }
            }
        }
        "item/agentMessage/delta"
        | "item/plan/delta"
        | "item/reasoning/textDelta"
        | "item/reasoning/summaryTextDelta" => {
            let item_id = params
                .get("itemId")
                .and_then(Value::as_str)
                .unwrap_or("codex-stream");
            let delta = params.get("delta").and_then(Value::as_str).unwrap_or("");
            let kind = if method.contains("reasoning") {
                "reasoning"
            } else if method.contains("plan") {
                "planDraft"
            } else {
                "assistant"
            };
            let title = if kind == "reasoning" {
                "Reasoning"
            } else if kind == "planDraft" {
                "Plan draft"
            } else {
                "Assistant"
            };
            *sequence += 1;
            emit_codex_delta(
                app,
                item_id,
                &context.orbit_thread_id,
                context.effective_turn_id().unwrap_or(""),
                kind,
                title,
                delta,
                *sequence,
            );
        }
        "item/commandExecution/outputDelta"
        | "command/exec/outputDelta"
        | "process/outputDelta"
        | "item/fileChange/outputDelta" => {
            let item_id = params
                .get("itemId")
                .and_then(Value::as_str)
                .unwrap_or("codex-output");
            let delta = params.get("delta").and_then(Value::as_str).unwrap_or("");
            let kind = if method.contains("fileChange") {
                "fileEdit"
            } else {
                "terminal"
            };
            *sequence += 1;
            emit_codex_delta(
                app,
                item_id,
                &context.orbit_thread_id,
                context.effective_turn_id().unwrap_or(""),
                kind,
                if kind == "terminal" {
                    "Terminal output"
                } else {
                    "File edit output"
                },
                delta,
                *sequence,
            );
        }
        "item/fileChange/patchUpdated" => {
            let item_id = params
                .get("itemId")
                .and_then(Value::as_str)
                .unwrap_or("codex-file-edit");
            let item = CodexItem {
                id: item_id.to_string(),
                thread_id: context.orbit_thread_id.clone(),
                turn_id: context.effective_turn_id().map(str::to_string),
                kind: "fileEdit".to_string(),
                title: "File changes".to_string(),
                text: "Codex updated file changes.".to_string(),
                status: "running".to_string(),
                created_at: now_iso(),
                metadata: Some(codex_file_change_metadata(
                    params.get("changes").cloned().unwrap_or_else(|| json!([])),
                )),
            };
            emit_codex_item_upsert(app, item.clone());
            if !items.iter().any(|existing| existing.id == item.id) {
                items.push(item);
            }
        }
        "thread/tokenUsage/updated" => {
            let item = CodexItem {
                id: id("codex-usage"),
                thread_id: context.orbit_thread_id.clone(),
                turn_id: context.effective_turn_id().map(str::to_string),
                kind: "usage".to_string(),
                title: "Token usage".to_string(),
                text: "Codex app-server usage updated.".to_string(),
                status: "completed".to_string(),
                created_at: now_iso(),
                metadata: Some(params.clone()),
            };
            emit_codex_item_upsert(app, item.clone());
            items.push(item);
        }
        "error" => {
            let message = app_server_notification_message(method, params);
            if params
                .get("willRetry")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                let item = CodexItem {
                    id: context
                        .effective_turn_id()
                        .map(|turn_id| format!("{turn_id}-codex-retry"))
                        .unwrap_or_else(|| "codex-retry".to_string()),
                    thread_id: context.orbit_thread_id.clone(),
                    turn_id: context.effective_turn_id().map(str::to_string),
                    kind: "reasoning".to_string(),
                    title: "Codex app-server retry".to_string(),
                    text: message,
                    status: "running".to_string(),
                    created_at: now_iso(),
                    metadata: Some(json!({
                        "severity": "warning",
                        "method": method,
                        "willRetry": true,
                        "params": params
                    })),
                };
                emit_codex_item_upsert(app, item.clone());
                items.push(item);
                return;
            }
            let item = codex_error_item(
                &context.orbit_thread_id,
                context.effective_turn_id(),
                message,
            );
            emit_codex_item_upsert(app, item.clone());
            items.push(item);
        }
        "warning" | "guardianWarning" | "configWarning" => {
            let message = app_server_notification_message(method, params);
            if message.contains("Model metadata for") && message.contains("not found") {
                return;
            }
            let item = CodexItem {
                id: id("codex-warning"),
                thread_id: context.orbit_thread_id.clone(),
                turn_id: context.effective_turn_id().map(str::to_string),
                kind: "reasoning".to_string(),
                title: "Codex app-server warning".to_string(),
                text: message,
                status: "completed".to_string(),
                created_at: now_iso(),
                metadata: Some(json!({
                    "severity": "warning",
                    "method": method,
                    "params": params
                })),
            };
            emit_codex_item_upsert(app, item.clone());
            items.push(item);
        }
        _ => {}
    }
}

fn handle_app_server_request(
    app: &AppHandle,
    request_id: u64,
    method: &str,
    params: Option<&Value>,
    context: &mut AppServerRunContext,
    items: &mut Vec<CodexItem>,
) {
    let params = params.unwrap_or(&Value::Null);
    let action_id = params
        .get("approvalId")
        .and_then(Value::as_str)
        .or_else(|| params.get("itemId").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| id("codex-approval"));
    let (kind, title, text, metadata) = match method {
        "item/commandExecution/requestApproval" => (
            "approval",
            "Command approval",
            params
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Codex requests permission to run a command."),
            json!({
                "tool": "run_command",
                "actionKind": "command",
                "params": {
                    "command": params.get("command").cloned().unwrap_or(Value::Null),
                    "cwd": params.get("cwd").cloned().unwrap_or(Value::Null)
                },
                "appServerRequestId": request_id,
                "appServerMethod": method
            }),
        ),
        "item/fileChange/requestApproval" => (
            "approval",
            "File change approval",
            params
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("Codex requests permission to write files."),
            json!({
                "tool": "apply_patch",
                "actionKind": "write",
                "params": params,
                "appServerRequestId": request_id,
                "appServerMethod": method
            }),
        ),
        "item/permissions/requestApproval" => {
            let permissions = params.get("permissions").unwrap_or(&Value::Null);
            let action_kind = if permissions
                .get("network")
                .filter(|value| !value.is_null())
                .is_some()
            {
                "network"
            } else {
                "write"
            };
            (
                "approval",
                "Permission approval",
                params
                    .get("reason")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex requests additional runtime permissions."),
                json!({
                    "tool": "codex_permissions",
                    "actionKind": action_kind,
                    "params": {
                        "cwd": params.get("cwd").cloned().unwrap_or(Value::Null),
                        "permissions": permissions
                    },
                    "appServerRequestId": request_id,
                    "appServerMethod": method
                }),
            )
        }
        "item/tool/requestUserInput" | "mcpServer/elicitation/request" => (
            "question",
            "Codex question",
            "Codex needs input to continue.",
            json!({
                "params": params,
                "allowFreeform": true,
                "appServerRequestId": request_id,
                "appServerMethod": method
            }),
        ),
        _ => (
            "approval",
            "Codex approval",
            "Codex requests permission to continue.",
            json!({
                "params": params,
                "appServerRequestId": request_id,
                "appServerMethod": method
            }),
        ),
    };
    if let Ok(mut guard) = active_app_server().lock() {
        guard.pending_requests.insert(
            action_id.clone(),
            PendingServerRequest {
                request_id,
                method: method.to_string(),
                params: Some(params.clone()),
                action_id: action_id.clone(),
                orbit_thread_id: context.orbit_thread_id.clone(),
                orbit_turn_id: context.effective_turn_id().map(str::to_string),
            },
        );
    }
    record_app_server_stage(
        "server-request:pending",
        json!({
            "requestId": request_id,
            "method": method,
            "actionId": action_id,
            "kind": kind
        }),
    );
    let item = CodexItem {
        id: action_id,
        thread_id: context.orbit_thread_id.clone(),
        turn_id: context.effective_turn_id().map(str::to_string),
        kind: kind.to_string(),
        title: title.to_string(),
        text: text.to_string(),
        status: "pending".to_string(),
        created_at: now_iso(),
        metadata: Some(metadata),
    };
    emit_codex_item_upsert(app, item.clone());
    items.push(item);
}
