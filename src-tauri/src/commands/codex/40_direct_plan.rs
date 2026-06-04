#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DirectPlanProviderKind {
    OpenAiCompatible,
    Anthropic,
    Google,
    Ollama,
}

fn direct_plan_provider_kind(
    provider_id: &str,
    base_url: Option<&str>,
) -> Result<DirectPlanProviderKind, String> {
    match provider_id {
        "anthropic" => Ok(DirectPlanProviderKind::Anthropic),
        "google" => Ok(DirectPlanProviderKind::Google),
        "ollama" => Ok(DirectPlanProviderKind::Ollama),
        _ => {
            openai_compatible_chat_url(provider_id, base_url)?;
            Ok(DirectPlanProviderKind::OpenAiCompatible)
        }
    }
}

fn provider_plan_label(provider_id: &str) -> &'static str {
    match provider_id {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "google" => "Gemini",
        "deepseek" => "DeepSeek",
        "openrouter" => "OpenRouter",
        "xai" => "xAI",
        "mistral" => "Mistral",
        "groq" => "Groq",
        "qwen" => "Qwen",
        "kimi" => "Kimi",
        "ollama" => "Ollama",
        "siliconflow" => "SiliconFlow",
        "zhipu" => "Zhipu",
        "together" => "Together AI",
        "fireworks" => "Fireworks AI",
        "cerebras" => "Cerebras",
        "nvidia" => "NVIDIA NIM",
        "azure-openai" => "Azure OpenAI",
        "custom-openai" => "Custom OpenAI-compatible",
        _ => "Provider",
    }
}

fn provider_stream_error_message(event: &Value) -> Option<String> {
    let error = event.get("error")?;
    if error.is_string() {
        return error.as_str().map(str::to_string);
    }
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.get("msg").and_then(Value::as_str))
        .or_else(|| error.get("code").and_then(Value::as_str));
    Some(message.map(str::to_string).unwrap_or_else(|| error.to_string()))
}

fn direct_plan_api_model(provider_id: &str, model: &str) -> String {
    match (provider_id, model) {
        ("deepseek", "deepseek-v4-pro") => "deepseek-reasoner".to_string(),
        ("deepseek", "deepseek-v4-flash") => "deepseek-chat".to_string(),
        _ => model.to_string(),
    }
}

fn post_deepseek_chat_streaming(
    app: &AppHandle,
    provider_id: &str,
    base_url: Option<&str>,
    api_key: &str,
    payload: &Value,
    thread_id: &str,
    turn_id: &str,
) -> Result<Vec<CodexItem>, String> {
    let api_url = openai_compatible_chat_url(provider_id, base_url)?;
    let response = reqwest::blocking::Client::new()
        .post(&api_url)
        .header("content-type", "application/json")
        .bearer_auth(api_key)
        .json(payload)
        .send()
        .map_err(|e| {
            format!(
                "{provider_id} request failed: {}",
                redact_provider_secret(&e.to_string(), api_key)
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
        return Err(format!(
            "{provider_id} returned {status}: {}",
            redact_provider_secret(&text, api_key)
        ));
    }

    let assistant_id = id("codex-assistant");
    let reasoning_id = id("codex-reasoning");
    let provider_label = provider_plan_label(provider_id);
    let mut assistant_text = String::new();
    let mut reasoning_text = String::new();
    let mut usage: Option<Value> = None;
    let mut sequence = 0u64;
    let mut assistant_started = false;
    let mut reasoning_started = false;
    let created_at = now_iso();
    let mut reader = BufReader::new(response);

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading {provider_id} stream: {e}"))?;
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            break;
        }
        let event = serde_json::from_str::<Value>(data)
            .map_err(|e| format!("Invalid {provider_id} stream JSON: {e}"))?;
        if let Some(error) = provider_stream_error_message(&event) {
            return Err(format!(
                "{provider_id} stream error: {}",
                redact_provider_secret(&error, api_key)
            ));
        }
        if let Some(event_usage) = event.get("usage").filter(|value| !value.is_null()) {
            usage = Some(event_usage.clone());
        }
        let delta = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
            .and_then(|choice| choice.get("delta"));
        if let Some(reasoning_delta) = delta
            .and_then(|delta| delta.get("reasoning_content"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !reasoning_started {
                reasoning_started = true;
                emit_codex_item_upsert(
                    app,
                    CodexItem {
                        id: reasoning_id.clone(),
                        thread_id: thread_id.to_string(),
                        turn_id: Some(turn_id.to_string()),
                        kind: "reasoning".to_string(),
                        title: format!("{provider_label} reasoning"),
                        text: String::new(),
                        status: "running".to_string(),
                        created_at: created_at.clone(),
                        metadata: Some(json!({ "providerId": provider_id })),
                    },
                );
            }
            reasoning_text.push_str(reasoning_delta);
            sequence += 1;
            emit_codex_delta(
                app,
                &reasoning_id,
                thread_id,
                turn_id,
                "reasoning",
                &format!("{provider_label} reasoning"),
                reasoning_delta,
                sequence,
            );
        }
        if let Some(content_delta) = delta
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !assistant_started {
                assistant_started = true;
                emit_codex_item_upsert(
                    app,
                    CodexItem {
                        id: assistant_id.clone(),
                        thread_id: thread_id.to_string(),
                        turn_id: Some(turn_id.to_string()),
                        kind: "assistant".to_string(),
                        title: "Assistant".to_string(),
                        text: String::new(),
                        status: "running".to_string(),
                        created_at: created_at.clone(),
                        metadata: Some(json!({ "providerId": provider_id })),
                    },
                );
            }
            assistant_text.push_str(content_delta);
            sequence += 1;
            emit_codex_delta(
                app,
                &assistant_id,
                thread_id,
                turn_id,
                "assistant",
                "Assistant",
                content_delta,
                sequence,
            );
        }
    }

    let mut items = Vec::new();
    if !reasoning_text.trim().is_empty() {
        let item = CodexItem {
            id: reasoning_id,
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "reasoning".to_string(),
            title: format!("{provider_label} reasoning"),
            text: reasoning_text,
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "providerId": provider_id })),
        };
        emit_codex_complete(app, &item);
        items.push(item);
    }
    if !assistant_text.trim().is_empty() {
        let item = CodexItem {
            id: assistant_id,
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "assistant".to_string(),
            title: "Assistant".to_string(),
            text: assistant_text,
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "providerId": provider_id })),
        };
        emit_codex_complete(app, &item);
        items.push(item);
    }
    if let Some(usage) = usage {
        let item = CodexItem {
            id: id("codex-usage"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "usage".to_string(),
            title: "Token usage".to_string(),
            text: format!("{provider_label} usage mapped to Codex usage item."),
            status: "completed".to_string(),
            created_at,
            metadata: Some(json!({ "providerId": provider_id, "usage": usage })),
        };
        emit_codex_item_upsert(app, item.clone());
        items.push(item);
    }
    Ok(items)
}

fn anthropic_plan_payload(model: &str, system: &str, user_content: &str) -> Value {
    json!({
        "model": model,
        "max_tokens": 4096,
        "system": system,
        "messages": [{ "role": "user", "content": user_content }],
        "stream": true
    })
}

fn post_anthropic_messages_streaming(
    app: &AppHandle,
    api_key: &str,
    payload: &Value,
    thread_id: &str,
    turn_id: &str,
) -> Result<Vec<CodexItem>, String> {
    let response = reqwest::blocking::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("content-type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .header("x-api-key", api_key)
        .json(payload)
        .send()
        .map_err(|e| {
            format!(
                "anthropic request failed: {}",
                redact_provider_secret(&e.to_string(), api_key)
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
        return Err(format!(
            "anthropic returned {status}: {}",
            redact_provider_secret(&text, api_key)
        ));
    }

    let assistant_id = id("codex-assistant");
    let reasoning_id = id("codex-reasoning");
    let created_at = now_iso();
    let mut assistant_text = String::new();
    let mut reasoning_text = String::new();
    let mut usage: Option<Value> = None;
    let mut assistant_started = false;
    let mut reasoning_started = false;
    let mut sequence = 0u64;
    let mut reader = BufReader::new(response);

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading anthropic stream: {e}"))?;
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            break;
        }
        let event = serde_json::from_str::<Value>(data)
            .map_err(|e| format!("Invalid anthropic stream JSON: {e}"))?;
        if let Some(error) = provider_stream_error_message(&event) {
            return Err(format!(
                "anthropic stream error: {}",
                redact_provider_secret(&error, api_key)
            ));
        }
        if event.get("type").and_then(Value::as_str) == Some("message_stop") {
            break;
        }
        if let Some(event_usage) = event.get("usage").filter(|value| !value.is_null()) {
            usage = Some(event_usage.clone());
        }
        if let Some(event_usage) = event
            .get("message")
            .and_then(|message| message.get("usage"))
            .filter(|value| !value.is_null())
        {
            usage = Some(event_usage.clone());
        }
        let delta = event.get("delta");
        if let Some(reasoning_delta) = delta
            .and_then(|delta| delta.get("thinking"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !reasoning_started {
                reasoning_started = true;
                emit_codex_item_upsert(
                    app,
                    CodexItem {
                        id: reasoning_id.clone(),
                        thread_id: thread_id.to_string(),
                        turn_id: Some(turn_id.to_string()),
                        kind: "reasoning".to_string(),
                        title: "Anthropic reasoning".to_string(),
                        text: String::new(),
                        status: "running".to_string(),
                        created_at: created_at.clone(),
                        metadata: Some(json!({ "providerId": "anthropic" })),
                    },
                );
            }
            reasoning_text.push_str(reasoning_delta);
            sequence += 1;
            emit_codex_delta(
                app,
                &reasoning_id,
                thread_id,
                turn_id,
                "reasoning",
                "Anthropic reasoning",
                reasoning_delta,
                sequence,
            );
        }
        if let Some(content_delta) = delta
            .and_then(|delta| delta.get("text"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !assistant_started {
                assistant_started = true;
                emit_codex_item_upsert(
                    app,
                    CodexItem {
                        id: assistant_id.clone(),
                        thread_id: thread_id.to_string(),
                        turn_id: Some(turn_id.to_string()),
                        kind: "assistant".to_string(),
                        title: "Assistant".to_string(),
                        text: String::new(),
                        status: "running".to_string(),
                        created_at: created_at.clone(),
                        metadata: Some(json!({ "providerId": "anthropic" })),
                    },
                );
            }
            assistant_text.push_str(content_delta);
            sequence += 1;
            emit_codex_delta(
                app,
                &assistant_id,
                thread_id,
                turn_id,
                "assistant",
                "Assistant",
                content_delta,
                sequence,
            );
        }
    }

    let mut items = Vec::new();
    if !reasoning_text.trim().is_empty() {
        let item = CodexItem {
            id: reasoning_id,
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "reasoning".to_string(),
            title: "Anthropic reasoning".to_string(),
            text: reasoning_text,
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "providerId": "anthropic" })),
        };
        emit_codex_complete(app, &item);
        items.push(item);
    }
    if !assistant_text.trim().is_empty() {
        let item = CodexItem {
            id: assistant_id,
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "assistant".to_string(),
            title: "Assistant".to_string(),
            text: assistant_text,
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "providerId": "anthropic" })),
        };
        emit_codex_complete(app, &item);
        items.push(item);
    }
    if let Some(usage) = usage {
        let item = CodexItem {
            id: id("codex-usage"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "usage".to_string(),
            title: "Token usage".to_string(),
            text: "Anthropic usage mapped to Codex usage item.".to_string(),
            status: "completed".to_string(),
            created_at,
            metadata: Some(json!({ "providerId": "anthropic", "usage": usage })),
        };
        emit_codex_item_upsert(app, item.clone());
        items.push(item);
    }
    Ok(items)
}

fn google_plan_payload(system: &str, user_content: &str) -> Value {
    json!({
        "systemInstruction": { "parts": [{ "text": system }] },
        "contents": [{ "role": "user", "parts": [{ "text": user_content }] }]
    })
}

fn post_google_generate_content_streaming(
    app: &AppHandle,
    api_key: &str,
    model: &str,
    payload: &Value,
    thread_id: &str,
    turn_id: &str,
) -> Result<Vec<CodexItem>, String> {
    let model_id = model.strip_prefix("models/").unwrap_or(model);
    let api_url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model_id}:streamGenerateContent?alt=sse&key={api_key}"
    );
    let response = reqwest::blocking::Client::new()
        .post(&api_url)
        .header("content-type", "application/json")
        .json(payload)
        .send()
        .map_err(|e| {
            format!(
                "google request failed: {}",
                redact_provider_secret(&e.to_string(), api_key)
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
        return Err(format!(
            "google returned {status}: {}",
            redact_provider_secret(&text, api_key)
        ));
    }

    let assistant_id = id("codex-assistant");
    let created_at = now_iso();
    let mut assistant_text = String::new();
    let mut usage: Option<Value> = None;
    let mut sequence = 0u64;
    let mut assistant_started = false;
    let mut reader = BufReader::new(response);

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading google stream: {e}"))?;
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            continue;
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" {
            break;
        }
        let event = serde_json::from_str::<Value>(data)
            .map_err(|e| format!("Invalid google stream JSON: {e}"))?;
        if let Some(error) = provider_stream_error_message(&event) {
            return Err(format!(
                "google stream error: {}",
                redact_provider_secret(&error, api_key)
            ));
        }
        if let Some(event_usage) = event.get("usageMetadata").filter(|value| !value.is_null()) {
            usage = Some(event_usage.clone());
        }
        let parts = event
            .get("candidates")
            .and_then(Value::as_array)
            .and_then(|candidates| candidates.first())
            .and_then(|candidate| candidate.get("content"))
            .and_then(|content| content.get("parts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for part in parts {
            if let Some(content_delta) = part
                .get("text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
            {
                if !assistant_started {
                    assistant_started = true;
                    emit_codex_item_upsert(
                        app,
                        CodexItem {
                            id: assistant_id.clone(),
                            thread_id: thread_id.to_string(),
                            turn_id: Some(turn_id.to_string()),
                            kind: "assistant".to_string(),
                            title: "Assistant".to_string(),
                            text: String::new(),
                            status: "running".to_string(),
                            created_at: created_at.clone(),
                            metadata: Some(json!({ "providerId": "google" })),
                        },
                    );
                }
                assistant_text.push_str(content_delta);
                sequence += 1;
                emit_codex_delta(
                    app,
                    &assistant_id,
                    thread_id,
                    turn_id,
                    "assistant",
                    "Assistant",
                    content_delta,
                    sequence,
                );
            }
        }
    }

    let mut items = Vec::new();
    if !assistant_text.trim().is_empty() {
        let item = CodexItem {
            id: assistant_id,
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "assistant".to_string(),
            title: "Assistant".to_string(),
            text: assistant_text,
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "providerId": "google" })),
        };
        emit_codex_complete(app, &item);
        items.push(item);
    }
    if let Some(usage) = usage {
        let item = CodexItem {
            id: id("codex-usage"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "usage".to_string(),
            title: "Token usage".to_string(),
            text: "Gemini usage mapped to Codex usage item.".to_string(),
            status: "completed".to_string(),
            created_at,
            metadata: Some(json!({ "providerId": "google", "usage": usage })),
        };
        emit_codex_item_upsert(app, item.clone());
        items.push(item);
    }
    Ok(items)
}

fn ollama_plan_payload(model: &str, system: &str, user_content: &str) -> Value {
    json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_content }
        ],
        "stream": true
    })
}

fn post_ollama_chat_streaming(
    app: &AppHandle,
    payload: &Value,
    thread_id: &str,
    turn_id: &str,
) -> Result<Vec<CodexItem>, String> {
    let response = reqwest::blocking::Client::new()
        .post("http://127.0.0.1:11434/api/chat")
        .header("content-type", "application/json")
        .json(payload)
        .send()
        .map_err(|e| format!("ollama request failed: {e}"))?;
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
        return Err(format!("ollama returned {status}: {text}"));
    }

    let assistant_id = id("codex-assistant");
    let created_at = now_iso();
    let mut assistant_text = String::new();
    let mut usage: Option<Value> = None;
    let mut sequence = 0u64;
    let mut assistant_started = false;
    let mut reader = BufReader::new(response);

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading ollama stream: {e}"))?;
        if bytes == 0 {
            break;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let event = serde_json::from_str::<Value>(trimmed)
            .map_err(|e| format!("Invalid ollama stream JSON: {e}"))?;
        if let Some(error) = provider_stream_error_message(&event) {
            return Err(format!("ollama stream error: {error}"));
        }
        if let Some(content_delta) = event
            .get("message")
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !assistant_started {
                assistant_started = true;
                emit_codex_item_upsert(
                    app,
                    CodexItem {
                        id: assistant_id.clone(),
                        thread_id: thread_id.to_string(),
                        turn_id: Some(turn_id.to_string()),
                        kind: "assistant".to_string(),
                        title: "Assistant".to_string(),
                        text: String::new(),
                        status: "running".to_string(),
                        created_at: created_at.clone(),
                        metadata: Some(json!({ "providerId": "ollama" })),
                    },
                );
            }
            assistant_text.push_str(content_delta);
            sequence += 1;
            emit_codex_delta(
                app,
                &assistant_id,
                thread_id,
                turn_id,
                "assistant",
                "Assistant",
                content_delta,
                sequence,
            );
        }
        if event.get("done").and_then(Value::as_bool) == Some(true) {
            usage = Some(json!({
                "prompt_eval_count": event.get("prompt_eval_count").cloned().unwrap_or(Value::Null),
                "eval_count": event.get("eval_count").cloned().unwrap_or(Value::Null),
                "total_duration": event.get("total_duration").cloned().unwrap_or(Value::Null)
            }));
            break;
        }
    }

    let mut items = Vec::new();
    if !assistant_text.trim().is_empty() {
        let item = CodexItem {
            id: assistant_id,
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "assistant".to_string(),
            title: "Assistant".to_string(),
            text: assistant_text,
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "providerId": "ollama" })),
        };
        emit_codex_complete(app, &item);
        items.push(item);
    }
    if let Some(usage) = usage {
        let item = CodexItem {
            id: id("codex-usage"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "usage".to_string(),
            title: "Token usage".to_string(),
            text: "Ollama usage mapped to Codex usage item.".to_string(),
            status: "completed".to_string(),
            created_at,
            metadata: Some(json!({ "providerId": "ollama", "usage": usage })),
        };
        emit_codex_item_upsert(app, item.clone());
        items.push(item);
    }
    Ok(items)
}

fn ensure_sidecar(provider_id: &str) -> CodexSidecarStatus {
    let mut guard = state().lock().expect("codex sidecar state poisoned");
    if let Some(child) = guard.child.as_mut() {
        if process_running(child) {
            return CodexSidecarStatus {
                running: true,
                pid: Some(child.id()),
                bridge_base_url: guard.bridge_base_url.clone(),
                codex_home: guard.codex_home.clone(),
                last_error: guard.last_error.clone(),
                last_stderr_tail: guard.last_stderr_tail.clone(),
                last_exit_code: guard.last_exit_code,
            };
        }
        guard.child = None;
    }

    let bridge = match ensure_bridge_started(provider_id) {
        Ok(status) if status.status == "ready" => status,
        Ok(status) => {
            let message = status
                .blocked_reason
                .clone()
                .unwrap_or_else(|| "Responses bridge is not ready".to_string());
            guard.last_error = Some(message.clone());
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: status.base_url,
                codex_home: guard.codex_home.clone(),
                last_error: Some(message),
                last_stderr_tail: guard.last_stderr_tail.clone(),
                last_exit_code: guard.last_exit_code,
            };
        }
        Err(error) => {
            guard.last_error = Some(error.clone());
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: guard.bridge_base_url.clone(),
                codex_home: guard.codex_home.clone(),
                last_error: Some(error),
                last_stderr_tail: guard.last_stderr_tail.clone(),
                last_exit_code: guard.last_exit_code,
            };
        }
    };
    let bridge_base_url = bridge
        .base_url
        .clone()
        .unwrap_or_else(|| "http://127.0.0.1:0/v1".to_string());
    guard.bridge_base_url = Some(bridge_base_url.clone());
    let codex_home = match CodexConfigWriter::new(&bridge_base_url).write_temp_home() {
        Ok(path) => path,
        Err(error) => {
            guard.last_error = Some(error.clone());
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: Some(bridge_base_url),
                codex_home: guard.codex_home.clone(),
                last_error: Some(error),
                last_stderr_tail: guard.last_stderr_tail.clone(),
                last_exit_code: guard.last_exit_code,
            };
        }
    };
    guard.codex_home = Some(codex_home.display().to_string());

    let codex_binary = match resolve_codex_binary() {
        Ok(path) => path,
        Err(error) => {
            guard.last_error = Some(error.clone());
            return CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: Some(bridge_base_url),
                codex_home: guard.codex_home.clone(),
                last_error: Some(error),
                last_stderr_tail: guard.last_stderr_tail.clone(),
                last_exit_code: guard.last_exit_code,
            };
        }
    };

    match Command::new(&codex_binary)
        .arg("app-server")
        .arg("--listen")
        .arg("stdio://")
        .env("CODEX_HOME", &codex_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(mut child) => {
            let pid = child.id();
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
            guard.last_error = None;
            guard.last_stderr_tail = None;
            guard.last_exit_code = None;
            guard.child = Some(child);
            CodexSidecarStatus {
                running: true,
                pid: Some(pid),
                bridge_base_url: Some(bridge_base_url),
                codex_home: Some(codex_home.display().to_string()),
                last_error: None,
                last_stderr_tail: None,
                last_exit_code: None,
            }
        }
        Err(error) => {
            let message = format!(
                "Codex sidecar is not available at {}: {error}",
                codex_binary.display()
            );
            guard.last_error = Some(message.clone());
            CodexSidecarStatus {
                running: false,
                pid: None,
                bridge_base_url: Some(bridge_base_url),
                codex_home: guard.codex_home.clone(),
                last_error: Some(message),
                last_stderr_tail: guard.last_stderr_tail.clone(),
                last_exit_code: guard.last_exit_code,
            }
        }
    }
}

#[tauri::command]
pub fn codex_sidecar_status() -> CodexSidecarStatus {
    if let Ok(mut active) = active_app_server().lock() {
        if let Some(child) = active.child.as_mut() {
            if process_running(child) {
                let guard = state().lock().expect("codex sidecar state poisoned");
                return CodexSidecarStatus {
                    running: true,
                    pid: Some(child.id()),
                    bridge_base_url: guard.bridge_base_url.clone(),
                    codex_home: guard.codex_home.clone(),
                    last_error: guard.last_error.clone(),
                    last_stderr_tail: guard.last_stderr_tail.clone(),
                    last_exit_code: guard.last_exit_code,
                };
            }
            active.child = None;
            active.stdin = None;
        }
    }
    let mut guard = state().lock().expect("codex sidecar state poisoned");
    let mut running = false;
    let mut pid = None;
    if let Some(child) = guard.child.as_mut() {
        running = process_running(child);
        if running {
            pid = Some(child.id());
        } else {
            guard.child = None;
        }
    }
    CodexSidecarStatus {
        running,
        pid,
        bridge_base_url: guard.bridge_base_url.clone(),
        codex_home: guard.codex_home.clone(),
        last_error: guard.last_error.clone(),
        last_stderr_tail: guard.last_stderr_tail.clone(),
        last_exit_code: guard.last_exit_code,
    }
}

#[tauri::command]
pub fn codex_runtime_restart(
    app: AppHandle,
    _provider_id: Option<String>,
    operation_id: Option<String>,
) -> RuntimeRestartResult {
    if let Some(operation) = active_restart_operation() {
        let status = codex_sidecar_status();
        return RuntimeRestartResult {
            pid: status.pid,
            error: Some(format!(
                "Codex runtime restart is already running ({})",
                operation.id
            )),
            status,
        };
    }
    let operation_id = operation_id.unwrap_or_else(|| id("codex-operation-restart"));
    cleanup_active_app_server();
    begin_runtime_operation(
        Some(operation_id.clone()),
        "restart",
        None,
        None,
        Duration::from_secs(25),
    );
    if let Ok(mut guard) = state().lock() {
        guard.last_error = None;
        guard.last_exit_code = None;
    }
    patch_runtime_operation_status("completed", Some("completed"), None);
    emit_runtime_status(
        &app,
        "ready",
        None,
        Some(operation_id),
        Some("restart".to_string()),
    );
    let status = codex_sidecar_status();
    RuntimeRestartResult {
        pid: status.pid,
        error: None,
        status,
    }
}

#[tauri::command]
pub fn codex_runtime_diagnostics() -> CodexRuntimeDiagnostics {
    let (
        pending_response_count,
        pending_request_count,
        active_operation,
        last_event_at,
        stale_event_count,
        last_stage,
        last_stage_at,
        last_stage_metadata,
        stage_history,
    ) = active_app_server()
        .lock()
        .map(|guard| {
            (
                guard.pending_responses.len(),
                guard.pending_requests.len(),
                guard.active_operation.clone(),
                guard.last_event_at.clone(),
                guard.stale_event_count,
                guard.last_stage.clone(),
                guard.last_stage_at.clone(),
                guard.last_stage_metadata.clone(),
                guard.stage_history.clone(),
            )
        })
        .unwrap_or((0, 0, None, None, 0, None, None, None, Vec::new()));
    let status = codex_sidecar_status();
    let sidecar_info = codex_sidecar_version_info();
    CodexRuntimeDiagnostics {
        pid: status.pid,
        sidecar_path: sidecar_info.path.or(Some(sidecar_info.source)),
        stderr_tail: status.last_stderr_tail.clone(),
        exit_code: status.last_exit_code,
        pending_response_count,
        pending_request_count,
        active_operation,
        last_event_at,
        stale_event_count: Some(stale_event_count),
        last_stage,
        last_stage_at,
        last_stage_metadata,
        stage_history,
        last_error: status.last_error,
    }
}

#[tauri::command]
pub fn codex_runtime_recover(app: AppHandle) -> CodexRuntimeDiagnostics {
    cleanup_active_app_server();
    if let Ok(mut guard) = state().lock() {
        guard.last_error = None;
        guard.last_exit_code = None;
    }
    emit_runtime_status(&app, "ready", None, None, Some("recover".to_string()));
    codex_runtime_diagnostics()
}

#[tauri::command]
pub fn codex_operation_cancel(app: AppHandle, operation_id: String) -> CodexSidecarStatus {
    cleanup_active_app_server();
    if let Ok(mut guard) = state().lock() {
        guard.last_error = Some(format!("Codex operation {operation_id} was cancelled"));
    }
    let status = codex_sidecar_status();
    emit_runtime_status(
        &app,
        "error",
        Some(format!("Codex operation {operation_id} was cancelled")),
        Some(operation_id),
        None,
    );
    status
}

#[tauri::command]
pub fn orbit_bridge_provider_catalog() -> Vec<CodexBridgeProvider> {
    vec![
        ("deepseek", "DeepSeek", "https://api.deepseek.com/v1", true, None),
        ("openai", "OpenAI", "https://api.openai.com/v1", false, Some("Build blocked until the OpenAI Responses bridge adapter is verified")),
        ("anthropic", "Anthropic", "https://api.anthropic.com/v1", false, Some("Build blocked until the Anthropic Responses bridge adapter is verified")),
        ("google", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta", false, Some("Build blocked until the Gemini Responses bridge adapter is verified")),
        ("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", false, Some("Build blocked until the OpenRouter Responses bridge adapter is verified")),
        ("xai", "xAI", "https://api.x.ai/v1", false, Some("Build blocked until the xAI Responses bridge adapter is verified")),
        ("mistral", "Mistral", "https://api.mistral.ai/v1", false, Some("Build blocked until the Mistral Responses bridge adapter is verified")),
        ("groq", "Groq", "https://api.groq.com/openai/v1", false, Some("Build blocked until the Groq Responses bridge adapter is verified")),
        ("qwen", "Qwen / DashScope", "https://dashscope.aliyuncs.com/compatible-mode/v1", false, Some("Build blocked until the Qwen Responses bridge adapter is verified")),
        ("kimi", "Kimi / Moonshot", "https://api.moonshot.cn/v1", false, Some("Build blocked until the Kimi Responses bridge adapter is verified")),
        ("siliconflow", "SiliconFlow", "https://api.siliconflow.cn/v1", false, Some("Build blocked until the SiliconFlow Responses bridge adapter is verified")),
        ("zhipu", "Zhipu / GLM", "https://open.bigmodel.cn/api/paas/v4", false, Some("Build blocked until the Zhipu Responses bridge adapter is verified")),
        ("together", "Together AI", "https://api.together.ai/v1", false, Some("Build blocked until the Together AI Responses bridge adapter is verified")),
        ("fireworks", "Fireworks AI", "https://api.fireworks.ai/inference/v1", false, Some("Build blocked until the Fireworks AI Responses bridge adapter is verified")),
        ("cerebras", "Cerebras", "https://api.cerebras.ai/v1", false, Some("Build blocked until the Cerebras Responses bridge adapter is verified")),
        ("nvidia", "NVIDIA NIM", "https://integrate.api.nvidia.com/v1", false, Some("Build blocked until the NVIDIA NIM Responses bridge adapter is verified")),
        ("azure-openai", "Azure OpenAI", "", false, Some("Build blocked until the Azure OpenAI Responses bridge adapter is verified")),
        ("ollama", "Ollama", "http://127.0.0.1:11434", false, Some("Build blocked until the local Ollama adapter is verified for Codex bridge semantics")),
        ("custom-openai", "Custom OpenAI-compatible", "", false, Some("Build blocked until this custom OpenAI-compatible endpoint is verified for Responses bridge semantics")),
    ]
    .into_iter()
    .map(|(id, label, base_url, supported, blocked_reason)| CodexBridgeProvider {
        id: id.to_string(),
        label: label.to_string(),
        base_url: (!base_url.is_empty()).then(|| base_url.to_string()),
        supported,
        blocked_reason: blocked_reason.map(str::to_string),
    })
    .collect()
}

#[tauri::command]
pub fn codex_desktop_build_smoke_report() -> Result<Option<Value>, String> {
    let path = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("docs/smoke/latest-tauri-webdriver-build-smoke.json");
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut report: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(object) = report.as_object_mut() {
        object.insert("path".to_string(), Value::String(path.display().to_string()));
    }
    Ok(Some(report))
}
