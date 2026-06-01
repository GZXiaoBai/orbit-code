#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    fn test_runtime_state_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
    }

    #[test]
    fn generated_config_contains_bridge_without_secret() {
        let config = generated_codex_config("http://127.0.0.1:8123/v1");
        assert!(config.contains("model_provider = \"orbit-bridge\""));
        assert!(config.contains("wire_api = \"responses\""));
        assert!(!config.to_ascii_lowercase().contains("api_key"));
        assert!(!config.contains("sk-"));
    }

    #[test]
    fn provider_catalog_supports_required_openai_compatible_providers() {
        let catalog = orbit_bridge_provider_catalog();
        let ids: Vec<String> = catalog.iter().map(|provider| provider.id.clone()).collect();
        for required in [
            "deepseek",
            "openrouter",
            "qwen",
            "siliconflow",
            "kimi",
            "groq",
        ] {
            assert!(ids.contains(&required.to_string()));
        }
        assert!(
            catalog
                .iter()
                .find(|provider| provider.id == "deepseek")
                .unwrap()
                .supported
        );
        assert!(
            !catalog
                .iter()
                .find(|provider| provider.id == "openrouter")
                .unwrap()
                .supported
        );
    }

    #[test]
    fn codex_binary_lookup_prefers_bundled_sidecar_paths() {
        let candidates = codex_binary_candidates();
        let target = option_env!("ORBIT_BUILD_TARGET").unwrap_or("");
        if !target.is_empty() {
            assert!(candidates
                .iter()
                .any(|path| path.ends_with(format!("codex-{target}"))));
        }
        assert!(candidates
            .iter()
            .any(|path| path == Path::new("/Applications/Codex.app/Contents/Resources/codex")));
    }

    #[test]
    fn json_rpc_client_multiplexes_responses_and_notifications() {
        let mut client = CodexJsonRpcClient::new();
        let (first_id, first_raw) = client.request("initialize", json!({})).unwrap();
        let (second_id, _second_raw) = client
            .request("thread/start", json!({ "workspace": "/tmp" }))
            .unwrap();
        assert!(first_raw.contains("\"method\":\"initialize\""));
        assert_eq!(client.pending_len(), 2);

        let notification = client
            .handle_line(r#"{"jsonrpc":"2.0","method":"codex/item","params":{"id":"item-1"}}"#);
        assert_eq!(
            notification,
            CodexJsonRpcDispatch::Notification {
                method: "codex/item".to_string(),
                params: Some(json!({ "id": "item-1" })),
            }
        );
        assert_eq!(codex_event_for_notification("codex/item"), CODEX_EVENT_ITEM);

        let server_request = client.handle_line(r#"{"id":41,"method":"item/commandExecution/requestApproval","params":{"itemId":"cmd-1","command":"npm test"}}"#);
        assert_eq!(
            server_request,
            CodexJsonRpcDispatch::ServerRequest {
                id: 41,
                method: "item/commandExecution/requestApproval".to_string(),
                params: Some(json!({ "itemId": "cmd-1", "command": "npm test" })),
            }
        );

        let response = client.handle_line(&format!(
            r#"{{"jsonrpc":"2.0","id":{second_id},"result":{{"ok":true}}}}"#
        ));
        assert_eq!(
            response,
            CodexJsonRpcDispatch::Response {
                id: second_id,
                result: json!({ "ok": true })
            }
        );
        assert_eq!(client.pending_len(), 1);

        let response = client.handle_line(&format!(
            r#"{{"jsonrpc":"2.0","id":{first_id},"result":{{"capabilities":[]}}}}"#
        ));
        assert_eq!(
            response,
            CodexJsonRpcDispatch::Response {
                id: first_id,
                result: json!({ "capabilities": [] })
            }
        );
        assert_eq!(client.pending_len(), 0);
    }

    #[test]
    fn persistent_request_without_stdin_cleans_pending_state() {
        let _lock = test_runtime_state_lock();
        cleanup_active_app_server();
        {
            let mut guard = active_app_server().lock().unwrap();
            guard.next_request_id = 9001;
            guard
                .orbit_to_app_thread
                .insert("orbit-thread".to_string(), "app-thread".to_string());
            guard
                .app_to_orbit_thread
                .insert("app-thread".to_string(), "orbit-thread".to_string());
            guard.active_context = Some(AppServerRunContext {
                orbit_thread_id: "orbit-thread".to_string(),
                orbit_turn_id: Some("orbit-turn-1".to_string()),
                app_thread_id: "app-thread".to_string(),
                app_turn_id: Some("turn-1".to_string()),
                mode: "build".to_string(),
            });
        }

        let error = match persistent_app_server_request("thread/start", json!({})) {
            Ok(_) => panic!("request unexpectedly succeeded without stdin"),
            Err(error) => error,
        };
        assert!(error.contains("No active Codex app-server stdin"));

        let guard = active_app_server().lock().unwrap();
        assert!(guard.pending_responses.is_empty());
        assert!(guard.orbit_to_app_thread.is_empty());
        assert!(guard.app_to_orbit_thread.is_empty());
        assert!(guard.active_context.is_none());
        drop(guard);
        cleanup_active_app_server();
    }

    #[test]
    fn persistent_response_timeout_cleans_runtime_state() {
        let _lock = test_runtime_state_lock();
        cleanup_active_app_server();
        let (_tx, rx) = mpsc::channel::<Result<Value, String>>();
        let (other_tx, other_rx) = mpsc::channel::<Result<Value, String>>();
        {
            let mut guard = active_app_server().lock().unwrap();
            let (pending_tx, _pending_rx) = mpsc::channel::<Result<Value, String>>();
            guard.pending_responses.insert(42, pending_tx);
            guard.pending_responses.insert(43, other_tx);
            guard.provider_id = Some("deepseek".to_string());
            guard.app_thread_id = Some("app-thread".to_string());
            guard.app_turn_id = Some("turn-1".to_string());
            guard
                .orbit_to_app_thread
                .insert("orbit-thread".to_string(), "app-thread".to_string());
            guard
                .app_to_orbit_thread
                .insert("app-thread".to_string(), "orbit-thread".to_string());
            guard.active_context = Some(AppServerRunContext {
                orbit_thread_id: "orbit-thread".to_string(),
                orbit_turn_id: Some("orbit-turn-1".to_string()),
                app_thread_id: "app-thread".to_string(),
                app_turn_id: Some("turn-1".to_string()),
                mode: "build".to_string(),
            });
        }

        let error = wait_for_persistent_response(
            PersistentAppServerRequest { id: 42, rx },
            "thread/start",
            Duration::from_millis(1),
        )
        .unwrap_err();
        assert!(error.contains("Timed out waiting for Codex app-server thread/start response"));
        let other_error = other_rx
            .recv_timeout(Duration::from_millis(25))
            .expect("other pending response should be released")
            .unwrap_err();
        assert!(
            other_error.contains("Timed out waiting for Codex app-server thread/start response")
        );

        let guard = active_app_server().lock().unwrap();
        assert!(guard.pending_responses.is_empty());
        assert!(guard.provider_id.is_none());
        assert!(guard.app_thread_id.is_none());
        assert!(guard.app_turn_id.is_none());
        assert!(guard.orbit_to_app_thread.is_empty());
        assert!(guard.app_to_orbit_thread.is_empty());
        assert!(guard.active_context.is_none());
        drop(guard);
        cleanup_active_app_server();
    }

    #[test]
    fn runtime_error_diagnostics_include_exit_code_and_stderr_tail() {
        let message = runtime_error_with_diagnostics(
            "Codex app-server exited",
            Some(42),
            Some("first line\nfatal sidecar failure"),
        );

        assert!(message.contains("Codex app-server exited"));
        assert!(message.contains("exit code: 42"));
        assert!(message.contains("stderr: first line\nfatal sidecar failure"));
    }

    #[test]
    fn sidecar_stderr_tail_is_trimmed_and_attached_to_failures() {
        let _lock = test_runtime_state_lock();
        cleanup_active_app_server();
        if let Ok(mut guard) = state().lock() {
            guard.last_error = None;
            guard.last_stderr_tail = None;
            guard.last_exit_code = Some(7);
        }

        record_sidecar_stderr("warning: before crash\n");
        clear_active_app_server_after_failure("Codex app-server exited", false);

        let error = state()
            .lock()
            .unwrap()
            .last_error
            .clone()
            .unwrap_or_default();
        assert!(error.contains("Codex app-server exited"));
        assert!(error.contains("exit code: 7"));
        assert!(error.contains("stderr: warning: before crash"));

        if let Ok(mut guard) = state().lock() {
            guard.last_error = None;
            guard.last_stderr_tail = None;
            guard.last_exit_code = None;
        }
        cleanup_active_app_server();
    }

    #[test]
    fn sidecar_status_exposes_runtime_diagnostics() {
        let _lock = test_runtime_state_lock();
        cleanup_active_app_server();
        if let Ok(mut guard) = state().lock() {
            guard.bridge_base_url = Some("http://127.0.0.1:4555/v1".to_string());
            guard.codex_home = Some("/tmp/orbit-codex-home".to_string());
            guard.last_error = Some("Codex app-server exited".to_string());
            guard.last_stderr_tail = Some("fatal sidecar crash".to_string());
            guard.last_exit_code = Some(42);
        }

        let status = codex_sidecar_status();
        assert!(!status.running);
        assert_eq!(
            status.bridge_base_url.as_deref(),
            Some("http://127.0.0.1:4555/v1")
        );
        assert_eq!(
            status.last_error.as_deref(),
            Some("Codex app-server exited")
        );
        assert_eq!(
            status.last_stderr_tail.as_deref(),
            Some("fatal sidecar crash")
        );
        assert_eq!(status.last_exit_code, Some(42));

        if let Ok(mut guard) = state().lock() {
            guard.bridge_base_url = None;
            guard.codex_home = None;
            guard.last_error = None;
            guard.last_stderr_tail = None;
            guard.last_exit_code = None;
        }
        cleanup_active_app_server();
    }

    #[test]
    fn app_server_failure_cleanup_clears_thread_cache_active_context_and_pending_requests() {
        let _lock = test_runtime_state_lock();
        cleanup_active_app_server();
        let (tx, rx) = mpsc::channel::<Result<Value, String>>();
        {
            let mut guard = active_app_server().lock().unwrap();
            guard.stdin = None;
            guard.pending_responses.insert(7, tx);
            guard.pending_requests.insert(
                "approval-1".to_string(),
                PendingServerRequest {
                    request_id: 88,
                    method: "codex/approval".to_string(),
                    params: Some(json!({ "command": "npm test" })),
                    action_id: "approval-1".to_string(),
                    orbit_thread_id: "orbit-thread".to_string(),
                    orbit_turn_id: Some("orbit-turn".to_string()),
                },
            );
            guard.app_thread_id = Some("app-thread".to_string());
            guard.app_turn_id = Some("app-turn".to_string());
            guard.provider_id = Some("deepseek".to_string());
            guard
                .orbit_to_app_thread
                .insert("orbit-thread".to_string(), "app-thread".to_string());
            guard
                .app_to_orbit_thread
                .insert("app-thread".to_string(), "orbit-thread".to_string());
            guard.active_context = Some(AppServerRunContext {
                orbit_thread_id: "orbit-thread".to_string(),
                orbit_turn_id: Some("orbit-turn".to_string()),
                app_thread_id: "app-thread".to_string(),
                app_turn_id: Some("app-turn".to_string()),
                mode: "build".to_string(),
            });
            guard.sequence = 42;
        }

        clear_active_app_server_after_failure("Codex app-server exited", false);

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(1)).unwrap().unwrap_err(),
            "Codex app-server exited"
        );
        let guard = active_app_server().lock().unwrap();
        assert!(guard.pending_responses.is_empty());
        assert!(guard.pending_requests.is_empty());
        assert!(guard.app_thread_id.is_none());
        assert!(guard.app_turn_id.is_none());
        assert!(guard.provider_id.is_none());
        assert!(guard.orbit_to_app_thread.is_empty());
        assert!(guard.app_to_orbit_thread.is_empty());
        assert!(guard.active_context.is_none());
        assert_eq!(guard.sequence, 0);
    }

    #[test]
    fn app_server_items_map_to_codex_events_and_review_patches() {
        let item = codex_item_from_thread_item(
            &json!({
                "type": "fileChange",
                "id": "file-1",
                "changes": [{ "path": "src/main.ts", "kind": "update", "diff": "@@ -1 +1\n-old\n+new" }],
                "status": "completed"
            }),
            "orbit-thread-1",
            Some("turn-1"),
        )
        .unwrap();
        assert_eq!(item.kind, "fileEdit");
        assert_eq!(item.thread_id, "orbit-thread-1");
        let metadata = item.metadata.unwrap();
        assert_eq!(metadata["changes"][0]["path"], "src/main.ts");
        assert_eq!(metadata["patches"][0]["path"], "src/main.ts");
        assert_eq!(metadata["patches"][0]["applyStatus"], "applied");

        let pending = PendingServerRequest {
            request_id: 7,
            method: "item/tool/requestUserInput".to_string(),
            params: Some(json!({
                "questions": [
                    { "id": "scope", "question": "Which scope?", "isOther": true, "isSecret": false, "options": null }
                ]
            })),
            action_id: "question-1".to_string(),
            orbit_thread_id: "orbit-thread-1".to_string(),
            orbit_turn_id: Some("turn-1".to_string()),
        };
        let response =
            app_server_response_payload_for_action(&pending, true, Some("core".to_string()));
        assert_eq!(response["answers"]["scope"]["answers"][0], "core");
    }

    #[test]
    fn orbit_reasoning_effort_maps_to_codex_app_server_enum() {
        assert_eq!(codex_app_server_effort(Some("auto")), "low");
        assert_eq!(codex_app_server_effort(Some("fast")), "minimal");
        assert_eq!(codex_app_server_effort(Some("balanced")), "medium");
        assert_eq!(codex_app_server_effort(Some("deep")), "high");
        assert_eq!(codex_app_server_effort(Some("max")), "xhigh");
        assert_eq!(codex_app_server_effort(Some("unexpected")), "low");
        assert_eq!(codex_app_server_effort(None), "low");
    }

    #[test]
    fn build_turns_use_untrusted_codex_approval_policy() {
        assert_eq!(codex_app_server_approval_policy("build"), "untrusted");
        assert_eq!(codex_app_server_approval_policy("plan"), "on-request");
    }

    #[test]
    fn permissions_approval_response_grants_requested_turn_permissions() {
        let pending = PendingServerRequest {
            request_id: 42,
            method: "item/permissions/requestApproval".to_string(),
            params: Some(json!({
                "permissions": {
                    "network": { "enabled": true },
                    "fileSystem": {
                        "read": ["/tmp/orbit"],
                        "write": ["/tmp/orbit"],
                        "entries": []
                    }
                }
            })),
            action_id: "permissions-1".to_string(),
            orbit_thread_id: "orbit-thread-1".to_string(),
            orbit_turn_id: Some("turn-1".to_string()),
        };

        let response = app_server_response_payload_for_action(&pending, true, None);
        assert_eq!(response["scope"], "turn");
        assert_eq!(response["strictAutoReview"], true);
        assert_eq!(response["permissions"]["network"]["enabled"], true);
        assert_eq!(
            response["permissions"]["fileSystem"]["write"][0],
            "/tmp/orbit"
        );
    }

    #[test]
    fn turn_start_input_accepts_explicit_runtime_route() {
        let input: CodexTurnStartInput = serde_json::from_value(json!({
            "threadId": "orbit-thread-1",
            "workspacePath": "/tmp/orbit",
            "prompt": "hello",
            "mode": "plan",
            "runtimeMode": "direct-deepseek-plan",
            "providerId": "deepseek",
            "model": "deepseek-chat"
        }))
        .unwrap();

        assert_eq!(input.runtime_mode.as_deref(), Some("direct-deepseek-plan"));

        let legacy_input: CodexTurnStartInput = serde_json::from_value(json!({
            "threadId": "orbit-thread-1",
            "workspacePath": "/tmp/orbit",
            "prompt": "hello",
            "mode": "build",
            "providerId": "deepseek",
            "model": "deepseek-chat"
        }))
        .unwrap();

        assert_eq!(legacy_input.runtime_mode, None);
    }

    #[test]
    fn plan_turns_route_to_direct_provider_even_without_explicit_runtime_mode() {
        let plan_input: CodexTurnStartInput = serde_json::from_value(json!({
            "threadId": "orbit-thread-1",
            "workspacePath": "/tmp/orbit",
            "prompt": "你好",
            "mode": "plan",
            "providerId": "deepseek",
            "model": "deepseek-v4-flash"
        }))
        .unwrap();

        assert_eq!(
            codex_turn_route(&plan_input),
            CodexTurnRoute::DirectProviderPlan
        );

        let explicit_plan_input = CodexTurnStartInput {
            runtime_mode: Some("direct-deepseek-plan".to_string()),
            ..plan_input.clone()
        };
        assert_eq!(
            codex_turn_route(&explicit_plan_input),
            CodexTurnRoute::DirectProviderPlan
        );

        let build_input: CodexTurnStartInput = serde_json::from_value(json!({
            "threadId": "orbit-thread-1",
            "workspacePath": "/tmp/orbit",
            "prompt": "edit files",
            "mode": "build",
            "providerId": "deepseek",
            "model": "deepseek-v4-flash"
        }))
        .unwrap();

        assert_eq!(
            codex_turn_route(&build_input),
            CodexTurnRoute::CodexAppServerBuild
        );
    }

    #[test]
    fn build_preflight_failure_returns_failed_turn_without_running_result() {
        let base_turn = CodexTurn {
            id: "orbit-turn-1".to_string(),
            thread_id: "orbit-thread-1".to_string(),
            status: "running".to_string(),
            mode: "build".to_string(),
            started_at: "2026-05-31T09:00:00Z".to_string(),
            completed_at: None,
        };

        let result = failed_turn_start_result(
            &base_turn,
            "Codex Build blocked",
            "Codex Build runtime is not ready".to_string(),
            json!({ "code": "codex_build_runtime_not_ready" }),
        );

        assert_eq!(result.turn.id, "orbit-turn-1");
        assert_eq!(result.turn.status, "failed");
        assert!(result.turn.completed_at.is_some());
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].kind, "error");
        assert_eq!(result.items[0].status, "failed");
        assert_eq!(
            result.items[0].metadata.as_ref().unwrap()["code"],
            "codex_build_runtime_not_ready"
        );
    }

    #[test]
    fn direct_plan_supports_openai_compatible_provider_urls() {
        assert_eq!(
            openai_compatible_chat_url("openrouter").unwrap(),
            "https://openrouter.ai/api/v1/chat/completions"
        );
        assert_eq!(
            openai_compatible_chat_url("qwen").unwrap(),
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
        );
        assert_eq!(
            openai_compatible_chat_url("kimi").unwrap(),
            "https://api.moonshot.cn/v1/chat/completions"
        );
        assert!(openai_compatible_chat_url("anthropic")
            .unwrap_err()
            .contains("direct Plan streaming"));
    }

    #[test]
    fn direct_plan_routes_protocol_specific_providers() {
        assert_eq!(
            direct_plan_provider_kind("deepseek").unwrap(),
            DirectPlanProviderKind::OpenAiCompatible
        );
        assert_eq!(
            direct_plan_provider_kind("anthropic").unwrap(),
            DirectPlanProviderKind::Anthropic
        );
        assert_eq!(
            direct_plan_provider_kind("google").unwrap(),
            DirectPlanProviderKind::Google
        );
        assert_eq!(
            direct_plan_provider_kind("ollama").unwrap(),
            DirectPlanProviderKind::Ollama
        );
    }

    #[test]
    fn direct_plan_builds_protocol_specific_payloads() {
        let anthropic = anthropic_plan_payload("claude-sonnet-4-5", "system prompt", "hello");
        assert_eq!(anthropic["system"], "system prompt");
        assert_eq!(anthropic["messages"][0]["role"], "user");
        assert_eq!(anthropic["stream"], true);

        let google = google_plan_payload("system prompt", "hello");
        assert_eq!(
            google["systemInstruction"]["parts"][0]["text"],
            "system prompt"
        );
        assert_eq!(google["contents"][0]["parts"][0]["text"], "hello");

        let ollama = ollama_plan_payload("qwen3-coder", "system prompt", "hello");
        assert_eq!(ollama["messages"][0]["role"], "system");
        assert_eq!(ollama["messages"][1]["role"], "user");
        assert_eq!(ollama["stream"], true);
    }

    #[test]
    fn app_server_error_notifications_preserve_nested_message_details() {
        let message = app_server_notification_message(
            "error",
            &json!({
                "error": { "message": "Provider request failed" },
                "additionalDetails": "DeepSeek returned 400 Bad Request"
            }),
        );
        assert!(message.contains("Provider request failed"));
        assert!(message.contains("DeepSeek returned 400 Bad Request"));
    }

    #[test]
    fn app_server_error_items_use_stable_ids_per_turn() {
        let first = codex_error_item(
            "orbit/thread 1",
            Some("turn/1"),
            "Provider request failed".to_string(),
        );
        let second = codex_error_item(
            "orbit/thread 1",
            Some("turn/1"),
            "Provider retry failed".to_string(),
        );
        let thread_scoped = codex_error_item(
            "orbit/thread 1",
            None,
            "Failed before turn id was known".to_string(),
        );

        assert_eq!(first.id, "codex-error-turn-1-app-server");
        assert_eq!(second.id, first.id);
        assert_eq!(thread_scoped.id, "codex-error-orbit-thread-1-app-server");
        assert_eq!(second.text, "Provider retry failed");
    }

    #[test]
    fn app_server_context_uses_orbit_turn_until_app_turn_is_known() {
        let mut context = AppServerRunContext {
            orbit_thread_id: "orbit-thread-1".to_string(),
            orbit_turn_id: Some("orbit-turn-1".to_string()),
            app_thread_id: "app-thread-1".to_string(),
            app_turn_id: None,
            mode: "build".to_string(),
        };

        assert_eq!(context.effective_turn_id(), Some("orbit-turn-1"));
        let early_error = codex_error_item(
            &context.orbit_thread_id,
            context.effective_turn_id(),
            "turn/start failed before app turn id".to_string(),
        );
        assert_eq!(early_error.turn_id.as_deref(), Some("orbit-turn-1"));
        assert_eq!(early_error.id, "codex-error-orbit-turn-1-app-server");

        context.app_turn_id = Some("app-turn-1".to_string());
        assert_eq!(context.effective_turn_id(), Some("app-turn-1"));
    }

    #[test]
    fn bridge_binds_loopback_only() {
        let status = ensure_bridge_started("deepseek").unwrap();
        assert_eq!(status.status, "ready");
        let base_url = status.base_url.unwrap();
        assert!(base_url.starts_with("http://127.0.0.1:"));
        assert!(base_url.ends_with("/v1"));
    }

    #[test]
    fn unsupported_bridge_provider_returns_blocked_reason() {
        let status = ensure_bridge_started("openrouter").unwrap();
        assert_eq!(status.status, "error");
        assert!(status.blocked_reason.unwrap().contains("discovery-only"));
    }

    #[test]
    fn missing_credential_error_is_structured_without_secret() {
        let error = deepseek_missing_credential_error("deepseek");
        assert_eq!(error.code, "missing_credential");
        assert_eq!(error.provider_id, "deepseek");
        assert!(!error.message.contains("sk-"));

        let (status, payload) = handle_bridge_request(
            "deepseek",
            "POST",
            "/v1/responses",
            json!({ "input": "hi" }),
        );
        assert_eq!(status, "401 Unauthorized");
        assert_eq!(payload["error"]["code"], "missing_credential");
    }

    #[test]
    fn bridge_models_route_is_loopback_catalog_compatible() {
        let (status, payload) = handle_bridge_request("deepseek", "GET", "/v1/models", Value::Null);
        assert_eq!(status, "200 OK");
        assert_eq!(payload["object"], "list");
        assert!(payload["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|model| model["id"] == "deepseek-chat"));
        assert!(payload["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|model| model["id"] == "deepseek-v4-flash"));
    }

    #[test]
    fn responses_bridge_translates_deepseek_payload_and_items() {
        let payload = json!({
            "model": "deepseek-chat",
            "instructions": "Be precise.",
            "input": "Run tests.",
            "tools": [{ "type": "function", "name": "run_command" }]
        });
        let translated = responses_to_deepseek_chat(&payload, "deepseek-chat");
        assert_eq!(translated["messages"][0]["role"], "system");
        assert_eq!(translated["messages"][1]["content"], "Run tests.");
        assert_eq!(translated["tools"][0]["function"]["name"], "run_command");
        assert_eq!(translated["stream"], false);

        let codex_payload = json!({
            "model": "deepseek-chat",
            "input": [
                { "type": "message", "role": "developer", "content": "Always be concise." },
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "Hi" }] },
                { "type": "function_call_output", "call_id": "call-1", "output": "ok" },
                { "type": "message", "role": "tool", "content": "legacy tool output" }
            ]
        });
        let codex_translated = responses_to_deepseek_chat(&codex_payload, "deepseek-chat");
        assert_eq!(codex_translated["messages"][0]["role"], "system");
        assert_eq!(
            codex_translated["messages"][0]["content"],
            "Always be concise."
        );
        assert_eq!(codex_translated["messages"][1]["role"], "user");
        assert_eq!(codex_translated["messages"][1]["content"], "Hi");
        assert_eq!(codex_translated["messages"][2]["role"], "user");
        assert!(codex_translated["messages"][2]["content"]
            .as_str()
            .unwrap()
            .contains("Tool result for call-1"));
        assert_eq!(codex_translated["messages"][3]["role"], "user");

        let response = json!({
            "choices": [{
                "message": {
                    "reasoning_content": "Need approval before command.",
                    "content": "Done.",
                    "tool_calls": [{
                        "id": "call-1",
                        "type": "function",
                        "function": { "name": "run_command", "arguments": "{\"command\":\"npm test\"}" }
                    }]
                }
            }],
            "usage": { "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15 }
        });
        let items = deepseek_response_to_codex_items(&response, "thread-1", "turn-1");
        assert!(items.iter().any(|item| item.kind == "reasoning"));
        assert!(items
            .iter()
            .any(|item| item.kind == "approval" && item.status == "pending"));
        assert!(items.iter().any(|item| item.kind == "assistant"));
        assert!(items.iter().any(|item| item.kind == "usage"));

        let responses = deepseek_chat_to_responses(&response);
        assert_eq!(responses["object"], "response");
        assert!(responses["output"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["type"] == "function_call"));
        assert_eq!(responses["usage"]["total_tokens"], 15);

        let events = deepseek_chat_to_responses_sse_events(&response);
        assert_eq!(events.first().unwrap()["type"], "response.created");
        assert_eq!(events.last().unwrap()["type"], "response.completed");
        assert!(events.last().unwrap()["response"]["output"].is_array());
        assert_eq!(events.last().unwrap()["response"]["status"], "completed");
        let sse = encode_sse_frames(&events);
        assert!(sse.contains("event: response.created"));
        assert!(sse.contains("event: response.output_item.done"));
        assert!(sse.contains("event: response.completed"));
    }

    #[test]
    fn deepseek_sse_parser_merges_reasoning_content_tool_calls_and_usage() {
        let frames = [
            json!({
                "id": "chatcmpl-stream",
                "model": "deepseek-chat",
                "choices": [{ "delta": { "reasoning_content": "Need " } }]
            }),
            json!({
                "choices": [{ "delta": { "reasoning_content": "tools. " } }]
            }),
            json!({
                "choices": [{ "delta": { "content": "Created " } }]
            }),
            json!({
                "choices": [{
                    "delta": {
                        "content": "file.",
                        "tool_calls": [{
                            "index": 0,
                            "id": "call-1",
                            "type": "function",
                            "function": { "name": "run_", "arguments": "{\"command\":" }
                        }]
                    }
                }]
            }),
            json!({
                "choices": [{
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "function": { "name": "command", "arguments": "\"npm test\"}" }
                        }]
                    },
                    "finish_reason": "tool_calls"
                }],
                "usage": { "prompt_tokens": 8, "completion_tokens": 5, "total_tokens": 13 }
            }),
        ]
        .into_iter()
        .map(|frame| format!("data: {}\n\n", serde_json::to_string(&frame).unwrap()))
        .collect::<String>()
            + "data: [DONE]\n\n";

        let response = deepseek_sse_reader_to_chat_response(
            std::io::Cursor::new(frames.into_bytes()),
            "deepseek-chat",
        )
        .unwrap();

        let message = &response["choices"][0]["message"];
        assert_eq!(response["id"], "chatcmpl-stream");
        assert_eq!(message["reasoning_content"], "Need tools. ");
        assert_eq!(message["content"], "Created file.");
        assert_eq!(message["tool_calls"][0]["id"], "call-1");
        assert_eq!(message["tool_calls"][0]["function"]["name"], "run_command");
        assert_eq!(
            message["tool_calls"][0]["function"]["arguments"],
            "{\"command\":\"npm test\"}"
        );
        assert_eq!(response["usage"]["total_tokens"], 13);

        let events = deepseek_chat_to_responses_sse_events(&response);
        assert!(events
            .iter()
            .any(|event| event["type"] == "response.completed"));
        assert!(events.last().unwrap()["response"]["output"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["type"] == "function_call"));
    }

    #[test]
    fn workspace_snapshot_lists_real_files_and_selected_content() {
        let root = std::env::temp_dir().join(format!("orbit-snapshot-test-{}", id("case")));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/ignored")).unwrap();
        fs::write(root.join("README.md"), "# Demo\n\nReal workspace file.").unwrap();
        fs::write(root.join("src/main.ts"), "export const value = 1;").unwrap();
        fs::write(root.join("node_modules/ignored/index.js"), "ignored").unwrap();

        let snapshot = collect_workspace_snapshot(&root.to_string_lossy()).unwrap();
        assert!(snapshot.contains("- README.md"));
        assert!(snapshot.contains("- src/"));
        assert!(snapshot.contains("- src/main.ts"));
        assert!(snapshot.contains("Real workspace file."));
        assert!(!snapshot.contains("node_modules/ignored"));
        let _ = fs::remove_dir_all(root);
    }
}
