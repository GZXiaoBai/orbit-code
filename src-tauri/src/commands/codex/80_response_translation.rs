pub fn generated_codex_config(base_url: &str) -> String {
    CodexConfigWriter::new(base_url).config_toml()
}

pub fn deepseek_missing_credential_error(provider_id: &str) -> CodexProviderError {
    CodexProviderError {
        code: "missing_credential".to_string(),
        provider_id: provider_id.to_string(),
        message: format!("API Key for {provider_id} is not unlocked in Orbit credential vault"),
    }
}

pub fn responses_to_deepseek_chat(payload: &Value, model: &str) -> Value {
    let mut messages = Vec::new();
    if let Some(instructions) = payload.get("instructions").and_then(Value::as_str) {
        if !instructions.trim().is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }
    match payload.get("input") {
        Some(Value::String(input)) => messages.push(json!({ "role": "user", "content": input })),
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(message) = response_input_item_to_deepseek_message(item) {
                    messages.push(message);
                }
            }
        }
        _ => {}
    }
    let mut output = json!({
        "model": payload.get("model").and_then(Value::as_str).unwrap_or(model),
        "messages": messages,
        "stream": payload.get("stream").and_then(Value::as_bool).unwrap_or(false),
    });
    if let Some(tools) = payload.get("tools") {
        let translated_tools: Vec<Value> = tools
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(response_tool_to_deepseek_tool)
                    .collect()
            })
            .unwrap_or_default();
        if !translated_tools.is_empty() {
            output["tools"] = Value::Array(translated_tools);
        }
    }
    output
}

fn response_input_item_to_deepseek_message(item: &Value) -> Option<Value> {
    let item_type = item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("message");
    match item_type {
        "message" | "input_message" => {
            let role =
                deepseek_chat_role(item.get("role").and_then(Value::as_str).unwrap_or("user"));
            let content =
                response_content_to_text(item.get("content")).unwrap_or_else(|| item.to_string());
            Some(json!({ "role": role, "content": content }))
        }
        "function_call_output" | "custom_tool_call_output" => {
            let call_id = item.get("call_id").and_then(Value::as_str).unwrap_or("");
            let content =
                response_content_to_text(item.get("output")).unwrap_or_else(|| item.to_string());
            let text = if call_id.is_empty() {
                format!("Tool result:\n{content}")
            } else {
                format!("Tool result for {call_id}:\n{content}")
            };
            Some(json!({ "role": "user", "content": text }))
        }
        _ => {
            let role =
                deepseek_chat_role(item.get("role").and_then(Value::as_str).unwrap_or("user"));
            let content =
                response_content_to_text(item.get("content")).unwrap_or_else(|| item.to_string());
            Some(json!({ "role": role, "content": content }))
        }
    }
}

fn deepseek_chat_role<'a>(role: &'a str) -> &'a str {
    match role {
        "system" | "user" | "assistant" => role,
        "developer" => "system",
        _ => "user",
    }
}

fn response_content_to_text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let text = items
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .and_then(Value::as_str)
                        .or_else(|| item.get("input_text").and_then(Value::as_str))
                        .or_else(|| item.get("output_text").and_then(Value::as_str))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        other => Some(other.to_string()),
    }
}

fn response_tool_to_deepseek_tool(tool: &Value) -> Option<Value> {
    let tool_type = tool
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("function");
    if tool_type != "function" {
        return None;
    }
    if tool.get("function").is_some() {
        return Some(tool.clone());
    }
    let name = tool.get("name").and_then(Value::as_str)?;
    let description = tool
        .get("description")
        .cloned()
        .unwrap_or_else(|| Value::String(String::new()));
    let parameters = tool
        .get("parameters")
        .or_else(|| tool.get("input_schema"))
        .cloned()
        .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
    Some(json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
    }))
}

pub fn deepseek_chat_to_responses(response: &Value) -> Value {
    let message = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"));
    let mut output = Vec::new();

    if let Some(reasoning) = message
        .and_then(|message| message.get("reasoning_content"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        output.push(json!({
            "type": "reasoning",
            "id": id("reasoning"),
            "summary": [],
            "content": [{ "type": "reasoning_text", "text": reasoning }]
        }));
    }

    if let Some(tool_calls) = message
        .and_then(|message| message.get("tool_calls"))
        .and_then(Value::as_array)
    {
        for call in tool_calls {
            let function = call.get("function").unwrap_or(&Value::Null);
            output.push(json!({
                "type": "function_call",
                "id": call.get("id").cloned().unwrap_or_else(|| json!(id("call"))),
                "call_id": call.get("id").cloned().unwrap_or_else(|| json!(id("call"))),
                "name": function.get("name").cloned().unwrap_or(Value::Null),
                "arguments": function.get("arguments").cloned().unwrap_or_else(|| json!("{}"))
            }));
        }
    }

    if let Some(content) = message
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        output.push(json!({
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": content }],
            "phase": "final_answer"
        }));
    }

    let usage = response.get("usage").cloned().unwrap_or_else(|| json!({}));
    json!({
        "id": response.get("id").cloned().unwrap_or_else(|| json!(id("resp"))),
        "object": "response",
        "status": "completed",
        "model": response.get("model").cloned().unwrap_or(Value::Null),
        "output": output,
        "usage": {
            "input_tokens": usage.get("prompt_tokens").cloned().unwrap_or_else(|| json!(0)),
            "output_tokens": usage.get("completion_tokens").cloned().unwrap_or_else(|| json!(0)),
            "total_tokens": usage.get("total_tokens").cloned().unwrap_or_else(|| json!(0))
        }
    })
}

pub fn deepseek_chat_to_responses_sse_events(response: &Value) -> Vec<Value> {
    let response_id = response
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| id("resp"));
    let response_payload = deepseek_chat_to_responses(response);
    let mut events = vec![json!({
        "type": "response.created",
        "response": {
            "id": response_id,
            "object": "response",
            "created_at": unix_timestamp_secs(),
            "model": response_payload.get("model").cloned().unwrap_or(Value::Null),
            "status": "in_progress"
        }
    })];
    for (output_index, item) in response_payload
        .get("output")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .enumerate()
    {
        events.push(json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": item
        }));
    }
    let mut completed_response = response_payload.clone();
    if let Some(response) = completed_response.as_object_mut() {
        response.insert("id".to_string(), json!(response_id));
        response.insert("status".to_string(), json!("completed"));
        response.insert("end_turn".to_string(), json!(true));
    }
    events.push(json!({
        "type": "response.completed",
        "response": completed_response
    }));
    events
}

fn encode_sse_frames(events: &[Value]) -> String {
    let mut body = String::new();
    for event in events {
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("response.output_item.done");
        body.push_str("event: ");
        body.push_str(kind);
        body.push('\n');
        body.push_str("data: ");
        body.push_str(&serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string()));
        body.push_str("\n\n");
    }
    body
}

pub fn deepseek_response_to_codex_items(
    response: &Value,
    thread_id: &str,
    turn_id: &str,
) -> Vec<CodexItem> {
    let mut items = Vec::new();
    let created_at = now_iso();
    let message = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"));

    if let Some(reasoning) = message
        .and_then(|message| message.get("reasoning_content"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        items.push(CodexItem {
            id: id("codex-reasoning"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "reasoning".to_string(),
            title: "DeepSeek reasoning".to_string(),
            text: reasoning.to_string(),
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: None,
        });
    }

    if let Some(tool_calls) = message
        .and_then(|message| message.get("tool_calls"))
        .and_then(Value::as_array)
        .filter(|calls| !calls.is_empty())
    {
        items.push(CodexItem {
            id: id("codex-approval"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "approval".to_string(),
            title: "Tool call approval".to_string(),
            text: "DeepSeek requested tool execution through the Codex Responses bridge."
                .to_string(),
            status: "pending".to_string(),
            created_at: created_at.clone(),
            metadata: Some(json!({ "toolCalls": tool_calls })),
        });
    }

    if let Some(content) = message
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
    {
        items.push(CodexItem {
            id: id("codex-assistant"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "assistant".to_string(),
            title: "Assistant".to_string(),
            text: content.to_string(),
            status: "completed".to_string(),
            created_at: created_at.clone(),
            metadata: None,
        });
    }

    if let Some(usage) = response.get("usage") {
        items.push(CodexItem {
            id: id("codex-usage"),
            thread_id: thread_id.to_string(),
            turn_id: Some(turn_id.to_string()),
            kind: "usage".to_string(),
            title: "Token usage".to_string(),
            text: "DeepSeek usage mapped to Codex usage item.".to_string(),
            status: "completed".to_string(),
            created_at,
            metadata: Some(usage.clone()),
        });
    }

    items
}
