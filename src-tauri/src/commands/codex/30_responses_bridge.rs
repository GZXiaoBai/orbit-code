fn ensure_bridge_started(provider_id: &str) -> Result<CodexBridgeStatus, String> {
    let mut guard = bridge_state().lock().map_err(|e| e.to_string())?;
    if guard.status.status == "ready"
        && guard.status.active_provider.as_deref() == Some(provider_id)
    {
        return Ok(guard.status.clone());
    }

    if provider_id != "deepseek" {
        let status = CodexBridgeStatus {
            status: "error".to_string(),
            base_url: None,
            active_provider: Some(provider_id.to_string()),
            blocked_reason: Some(format!(
                "{provider_id} is discovery-only until its Responses bridge adapter is verified"
            )),
        };
        guard.listener = None;
        guard.status = status.clone();
        return Ok(status);
    }

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).map_err(|e| e.to_string())?;
    let addr = listener.local_addr().map_err(|e| e.to_string())?;
    if addr.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
        return Err(format!(
            "Responses bridge must bind to 127.0.0.1, got {}",
            addr.ip()
        ));
    }
    let server_listener = listener.try_clone().map_err(|e| e.to_string())?;
    let server_provider = provider_id.to_string();
    thread::spawn(move || serve_responses_bridge(server_listener, server_provider));
    let status = CodexBridgeStatus {
        status: "ready".to_string(),
        base_url: Some(format!("http://{addr}/v1")),
        active_provider: Some(provider_id.to_string()),
        blocked_reason: None,
    };
    guard.listener = Some(listener);
    guard.status = status.clone();
    Ok(status)
}

fn serve_responses_bridge(listener: TcpListener, provider_id: String) {
    for stream in listener.incoming() {
        match stream {
            Ok(stream) => handle_bridge_stream(stream, &provider_id),
            Err(_) => break,
        }
    }
}

fn read_http_request(
    stream: &mut TcpStream,
) -> Result<(String, String, HashMap<String, String>, Value), String> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut content_length = 0usize;
    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
            if name.eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    }
    let payload = if body.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice::<Value>(&body).map_err(|e| e.to_string())?
    };
    Ok((method, path, headers, payload))
}

fn write_http_response(stream: &mut TcpStream, response: BridgeHttpResponse) {
    let head = format!(
        "HTTP/1.1 {}\r\ncontent-type: {}\r\ncache-control: no-cache\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        response.status,
        response.content_type,
        response.body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&response.body);
}

fn handle_bridge_stream(mut stream: TcpStream, provider_id: &str) {
    match read_http_request(&mut stream) {
        Ok((method, path, headers, payload)) => {
            if provider_id == "deepseek"
                && method == "POST"
                && path == "/v1/responses"
                && wants_sse(&headers, &payload)
            {
                write_deepseek_responses_sse_stream(&mut stream, payload);
                return;
            }
            let response =
                handle_bridge_http_request(provider_id, &method, &path, &headers, payload);
            write_http_response(&mut stream, response);
        }
        Err(error) => write_http_response(
            &mut stream,
            BridgeHttpResponse::json(
                "400 Bad Request",
                json!({ "error": { "code": "bad_request", "message": error } }),
            ),
        ),
    }
}

fn write_sse_stream_head(stream: &mut TcpStream) -> std::io::Result<()> {
    stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncache-control: no-cache\r\nconnection: close\r\n\r\n")
}

fn write_sse_value(stream: &mut TcpStream, event: &Value) -> std::io::Result<()> {
    let kind = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("response.output_item.done");
    stream.write_all(format!("event: {kind}\n").as_bytes())?;
    stream.write_all(b"data: ")?;
    stream.write_all(
        serde_json::to_string(event)
            .unwrap_or_else(|_| "{}".to_string())
            .as_bytes(),
    )?;
    stream.write_all(b"\n\n")?;
    stream.flush()
}

fn write_deepseek_bridge_error(stream: &mut TcpStream, status: &str, code: &str, message: String) {
    write_http_response(
        stream,
        BridgeHttpResponse::json(
            status,
            json!({ "error": { "code": code, "message": message } }),
        ),
    );
}

fn write_deepseek_responses_sse_stream(stream: &mut TcpStream, payload: Value) {
    let api_key = match super::get_provider_credential("deepseek") {
        Ok(Some(secret)) => secret,
        Ok(None) => {
            let error = deepseek_missing_credential_error("deepseek");
            write_http_response(
                stream,
                BridgeHttpResponse::json("401 Unauthorized", json!({ "error": error })),
            );
            return;
        }
        Err(error) => {
            write_deepseek_bridge_error(
                stream,
                "500 Internal Server Error",
                "credential_lookup_failed",
                error,
            );
            return;
        }
    };
    let requested_model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("deepseek-chat")
        .to_string();
    let mut deepseek_payload = responses_to_deepseek_chat(&payload, &requested_model);
    deepseek_payload["stream"] = json!(true);
    deepseek_payload["stream_options"] = json!({ "include_usage": true });

    let response = match reqwest::blocking::Client::new()
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("content-type", "application/json")
        .bearer_auth(&api_key)
        .json(&deepseek_payload)
        .send()
    {
        Ok(response) => response,
        Err(error) => {
            write_deepseek_bridge_error(
                stream,
                "502 Bad Gateway",
                "provider_request_failed",
                format!(
                    "DeepSeek request failed: {}",
                    redact_provider_secret(&error.to_string(), &api_key)
                ),
            );
            return;
        }
    };
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
        write_deepseek_bridge_error(
            stream,
            "502 Bad Gateway",
            "provider_request_failed",
            format!(
                "DeepSeek returned {status}: {}",
                redact_provider_secret(&text, &api_key)
            ),
        );
        return;
    }

    let response_id = id("resp");
    let assistant_item_id = id("msg");
    let reasoning_item_id = id("reasoning");
    let mut assistant_text = String::new();
    let mut reasoning_text = String::new();
    let mut usage: Option<Value> = None;
    let mut model = requested_model;
    let mut assistant_started = false;
    let mut reasoning_started = false;
    let mut tool_calls: HashMap<u64, DeepSeekToolCallAccumulator> = HashMap::new();

    if write_sse_stream_head(stream).is_err() {
        return;
    }
    let _ = write_sse_value(
        stream,
        &json!({
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": unix_timestamp_secs(),
                "model": model,
                "status": "in_progress"
            }
        }),
    );

    let mut reader = BufReader::new(response);
    loop {
        let mut line = String::new();
        let bytes = match reader.read_line(&mut line) {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = write_sse_value(
                    stream,
                    &json!({
                        "type": "response.failed",
                        "response": { "id": response_id, "status": "failed", "error": { "message": format!("Failed reading DeepSeek stream: {error}") } }
                    }),
                );
                return;
            }
        };
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
        let event = match serde_json::from_str::<Value>(data) {
            Ok(event) => event,
            Err(error) => {
                let _ = write_sse_value(
                    stream,
                    &json!({
                        "type": "response.failed",
                        "response": { "id": response_id, "status": "failed", "error": { "message": format!("Invalid DeepSeek stream JSON: {error}") } }
                    }),
                );
                return;
            }
        };
        if let Some(event_model) = event.get("model").and_then(Value::as_str) {
            model = event_model.to_string();
        }
        if let Some(event_usage) = event.get("usage").filter(|value| !value.is_null()) {
            usage = Some(event_usage.clone());
        }
        let choice = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first());
        let delta = choice.and_then(|choice| choice.get("delta"));

        if let Some(reasoning_delta) = delta
            .and_then(|delta| delta.get("reasoning_content"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !reasoning_started {
                reasoning_started = true;
                let _ = write_sse_value(
                    stream,
                    &json!({
                        "type": "response.output_item.added",
                        "item": { "type": "reasoning", "id": reasoning_item_id, "summary": [], "content": [] }
                    }),
                );
            }
            reasoning_text.push_str(reasoning_delta);
            let _ = write_sse_value(
                stream,
                &json!({
                    "type": "response.reasoning_text.delta",
                    "delta": reasoning_delta,
                    "content_index": 0
                }),
            );
        }

        if let Some(content_delta) = delta
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
        {
            if !assistant_started {
                assistant_started = true;
                let _ = write_sse_value(
                    stream,
                    &json!({
                        "type": "response.output_item.added",
                        "item": {
                            "type": "message",
                            "role": "assistant",
                            "id": assistant_item_id,
                            "content": [{ "type": "output_text", "text": "" }],
                            "phase": "final_answer"
                        }
                    }),
                );
            }
            assistant_text.push_str(content_delta);
            let _ = write_sse_value(
                stream,
                &json!({
                    "type": "response.output_text.delta",
                    "delta": content_delta
                }),
            );
        }

        if let Some(delta_tool_calls) = delta
            .and_then(|delta| delta.get("tool_calls"))
            .and_then(Value::as_array)
        {
            for raw_call in delta_tool_calls {
                let index = raw_call.get("index").and_then(Value::as_u64).unwrap_or(0);
                let entry = tool_calls.entry(index).or_default();
                if let Some(id) = raw_call.get("id").and_then(Value::as_str) {
                    entry.id = id.to_string();
                }
                if let Some(call_type) = raw_call.get("type").and_then(Value::as_str) {
                    entry.call_type = call_type.to_string();
                }
                if let Some(function) = raw_call.get("function") {
                    if let Some(name) = function.get("name").and_then(Value::as_str) {
                        entry.function_name.push_str(name);
                    }
                    if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                        entry.function_arguments.push_str(arguments);
                    }
                }
            }
        }
    }

    let mut output = Vec::new();
    if reasoning_started {
        let item = json!({
            "type": "reasoning",
            "id": reasoning_item_id,
            "summary": [],
            "content": [{ "type": "reasoning_text", "text": reasoning_text }]
        });
        let _ = write_sse_value(
            stream,
            &json!({ "type": "response.output_item.done", "item": item }),
        );
        output.push(item);
    }
    for (_, call) in tool_calls {
        let call_id = if call.id.is_empty() {
            id("call")
        } else {
            call.id
        };
        let item = json!({
            "type": "function_call",
            "id": call_id,
            "call_id": call_id,
            "name": call.function_name,
            "arguments": call.function_arguments
        });
        let _ = write_sse_value(
            stream,
            &json!({ "type": "response.output_item.done", "item": item }),
        );
        output.push(item);
    }
    if assistant_started {
        let item = json!({
            "type": "message",
            "role": "assistant",
            "id": assistant_item_id,
            "content": [{ "type": "output_text", "text": assistant_text }],
            "phase": "final_answer"
        });
        let _ = write_sse_value(
            stream,
            &json!({ "type": "response.output_item.done", "item": item }),
        );
        output.push(item);
    }
    let usage = usage.unwrap_or_else(
        || json!({ "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }),
    );
    let _ = write_sse_value(
        stream,
        &json!({
            "type": "response.completed",
            "response": {
                "id": response_id,
                "object": "response",
                "status": "completed",
                "model": model,
                "output": output,
                "usage": {
                    "input_tokens": usage.get("prompt_tokens").cloned().unwrap_or_else(|| json!(0)),
                    "output_tokens": usage.get("completion_tokens").cloned().unwrap_or_else(|| json!(0)),
                    "total_tokens": usage.get("total_tokens").cloned().unwrap_or_else(|| json!(0))
                },
                "end_turn": true
            }
        }),
    );
}

fn handle_bridge_http_request(
    provider_id: &str,
    method: &str,
    path: &str,
    headers: &HashMap<String, String>,
    payload: Value,
) -> BridgeHttpResponse {
    if method == "GET" && path == "/v1/models" {
        return BridgeHttpResponse::json(
            "200 OK",
            json!({
                "object": "list",
                "data": [
                    { "id": "deepseek-v4-pro", "object": "model", "owned_by": "deepseek" },
                    { "id": "deepseek-v4-flash", "object": "model", "owned_by": "deepseek" },
                    { "id": "deepseek-chat", "object": "model", "owned_by": "deepseek" },
                    { "id": "deepseek-reasoner", "object": "model", "owned_by": "deepseek" }
                ]
            }),
        );
    }
    if method != "POST" || path != "/v1/responses" {
        return BridgeHttpResponse::json(
            "404 Not Found",
            json!({ "error": { "code": "not_found", "message": "Unsupported Orbit Responses bridge route" } }),
        );
    }
    if provider_id != "deepseek" {
        return BridgeHttpResponse::json(
            "400 Bad Request",
            json!({ "error": { "code": "provider_blocked", "message": format!("{provider_id} is not enabled for Build") } }),
        );
    }
    let api_key = match super::get_provider_credential("deepseek") {
        Ok(Some(secret)) => secret,
        Ok(None) => {
            let error = deepseek_missing_credential_error("deepseek");
            return BridgeHttpResponse::json("401 Unauthorized", json!({ "error": error }));
        }
        Err(error) => {
            return BridgeHttpResponse::json(
                "500 Internal Server Error",
                json!({ "error": { "code": "credential_lookup_failed", "message": error } }),
            )
        }
    };
    let model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("deepseek-chat");
    let mut deepseek_payload = responses_to_deepseek_chat(&payload, model);
    if wants_sse(headers, &payload) {
        deepseek_payload["stream"] = json!(true);
        deepseek_payload["stream_options"] = json!({ "include_usage": true });
        return match post_deepseek_chat_streamed_response(&api_key, &deepseek_payload) {
            Ok(deepseek_response) => BridgeHttpResponse::sse(
                "200 OK",
                deepseek_chat_to_responses_sse_events(&deepseek_response),
            ),
            Err(error) => BridgeHttpResponse::json(
                "502 Bad Gateway",
                json!({ "error": { "code": "provider_request_failed", "message": error } }),
            ),
        };
    }
    deepseek_payload["stream"] = json!(false);
    match post_deepseek_chat(&api_key, &deepseek_payload) {
        Ok(deepseek_response) => {
            BridgeHttpResponse::json("200 OK", deepseek_chat_to_responses(&deepseek_response))
        }
        Err(error) => BridgeHttpResponse::json(
            "502 Bad Gateway",
            json!({ "error": { "code": "provider_request_failed", "message": error } }),
        ),
    }
}

fn handle_bridge_request(
    provider_id: &str,
    method: &str,
    path: &str,
    payload: Value,
) -> (String, Value) {
    let response = handle_bridge_http_request(provider_id, method, path, &HashMap::new(), payload);
    (response.status.clone(), response.json_value())
}

fn wants_sse(headers: &HashMap<String, String>, payload: &Value) -> bool {
    headers
        .get("accept")
        .map(|value| value.to_ascii_lowercase().contains("text/event-stream"))
        .unwrap_or(false)
        || payload
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(false)
}

fn post_deepseek_chat(api_key: &str, payload: &Value) -> Result<Value, String> {
    let response = reqwest::blocking::Client::new()
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("content-type", "application/json")
        .bearer_auth(api_key)
        .json(payload)
        .send()
        .map_err(|e| {
            format!(
                "DeepSeek request failed: {}",
                redact_provider_secret(&e.to_string(), api_key)
            )
        })?;
    let status = response.status();
    let text = response
        .text()
        .map_err(|e| format!("Failed to read DeepSeek response: {e}"))?;
    if !status.is_success() {
        return Err(format!(
            "DeepSeek returned {status}: {}",
            redact_provider_secret(&text, api_key)
        ));
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("Invalid DeepSeek JSON: {e}"))
}

fn post_deepseek_chat_streamed_response(api_key: &str, payload: &Value) -> Result<Value, String> {
    let response = reqwest::blocking::Client::new()
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("content-type", "application/json")
        .bearer_auth(api_key)
        .json(payload)
        .send()
        .map_err(|e| {
            format!(
                "DeepSeek request failed: {}",
                redact_provider_secret(&e.to_string(), api_key)
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .unwrap_or_else(|_| "<failed to read provider error body>".to_string());
        return Err(format!(
            "DeepSeek returned {status}: {}",
            redact_provider_secret(&text, api_key)
        ));
    }

    let model = payload
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("deepseek-chat")
        .to_string();
    let reader = BufReader::new(response);
    deepseek_sse_reader_to_chat_response(reader, &model)
        .map_err(|error| redact_provider_secret(&error, api_key))
}

fn deepseek_sse_reader_to_chat_response<R: BufRead>(
    mut reader: R,
    fallback_model: &str,
) -> Result<Value, String> {
    let mut response_id = id("deepseek-stream");
    let mut model = fallback_model.to_string();
    let mut assistant_text = String::new();
    let mut reasoning_text = String::new();
    let mut usage: Option<Value> = None;
    let mut finish_reason: Option<Value> = None;
    let mut tool_calls: HashMap<u64, DeepSeekToolCallAccumulator> = HashMap::new();

    loop {
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed reading DeepSeek stream: {e}"))?;
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
            .map_err(|e| format!("Invalid DeepSeek stream JSON: {e}: {data}"))?;
        if let Some(message) = deepseek_stream_error_message(&event) {
            return Err(format!("DeepSeek stream error: {message}"));
        }
        if let Some(id) = event.get("id").and_then(Value::as_str) {
            response_id = id.to_string();
        }
        if let Some(event_model) = event.get("model").and_then(Value::as_str) {
            model = event_model.to_string();
        }
        if let Some(event_usage) = event.get("usage").filter(|value| !value.is_null()) {
            usage = Some(event_usage.clone());
        }
        let choice = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first());
        if let Some(reason) = choice
            .and_then(|choice| choice.get("finish_reason"))
            .filter(|value| !value.is_null())
        {
            finish_reason = Some(reason.clone());
        }
        let delta = choice.and_then(|choice| choice.get("delta"));
        if let Some(reasoning_delta) = delta
            .and_then(|delta| delta.get("reasoning_content"))
            .and_then(Value::as_str)
        {
            reasoning_text.push_str(reasoning_delta);
        }
        if let Some(content_delta) = delta
            .and_then(|delta| delta.get("content"))
            .and_then(Value::as_str)
        {
            assistant_text.push_str(content_delta);
        }
        if let Some(delta_tool_calls) = delta
            .and_then(|delta| delta.get("tool_calls"))
            .and_then(Value::as_array)
        {
            for raw_call in delta_tool_calls {
                let index = raw_call.get("index").and_then(Value::as_u64).unwrap_or(0);
                let entry = tool_calls.entry(index).or_default();
                if let Some(id) = raw_call.get("id").and_then(Value::as_str) {
                    entry.id = id.to_string();
                }
                if let Some(call_type) = raw_call.get("type").and_then(Value::as_str) {
                    entry.call_type = call_type.to_string();
                }
                if let Some(function) = raw_call.get("function") {
                    if let Some(name) = function.get("name").and_then(Value::as_str) {
                        entry.function_name.push_str(name);
                    }
                    if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                        entry.function_arguments.push_str(arguments);
                    }
                }
            }
        }
    }

    let mut tool_call_items = tool_calls
        .into_iter()
        .map(|(index, call)| {
            json!({
                "index": index,
                "id": if call.id.is_empty() { id("call") } else { call.id },
                "type": if call.call_type.is_empty() { "function" } else { call.call_type.as_str() },
                "function": {
                    "name": call.function_name,
                    "arguments": call.function_arguments
                }
            })
        })
        .collect::<Vec<_>>();
    tool_call_items.sort_by_key(|item| item.get("index").and_then(Value::as_u64).unwrap_or(0));

    let mut message = json!({
        "role": "assistant",
        "content": assistant_text
    });
    if !reasoning_text.trim().is_empty() {
        message["reasoning_content"] = json!(reasoning_text);
    }
    if !tool_call_items.is_empty() {
        message["tool_calls"] = Value::Array(tool_call_items);
    }

    Ok(json!({
        "id": response_id,
        "object": "chat.completion",
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish_reason.unwrap_or_else(|| json!("stop"))
        }],
        "usage": usage.unwrap_or_else(|| json!({
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }))
    }))
}

fn deepseek_stream_error_message(event: &Value) -> Option<String> {
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

fn append_openai_compatible_path(base_url: &str, path: &str) -> String {
    let clean = base_url.trim().trim_end_matches('/');
    if clean.ends_with(path) {
        clean.to_string()
    } else {
        format!("{clean}{path}")
    }
}

fn openai_compatible_chat_url(
    provider_id: &str,
    base_url: Option<&str>,
) -> Result<String, String> {
    match provider_id {
        "openai" => Ok("https://api.openai.com/v1/chat/completions".to_string()),
        "deepseek" => Ok("https://api.deepseek.com/v1/chat/completions".to_string()),
        "openrouter" => Ok("https://openrouter.ai/api/v1/chat/completions".to_string()),
        "xai" => Ok("https://api.x.ai/v1/chat/completions".to_string()),
        "mistral" => Ok("https://api.mistral.ai/v1/chat/completions".to_string()),
        "groq" => Ok("https://api.groq.com/openai/v1/chat/completions".to_string()),
        "qwen" => Ok("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions".to_string()),
        "kimi" => Ok("https://api.moonshot.cn/v1/chat/completions".to_string()),
        "siliconflow" => Ok("https://api.siliconflow.cn/v1/chat/completions".to_string()),
        "zhipu" => Ok("https://open.bigmodel.cn/api/paas/v4/chat/completions".to_string()),
        "together" => Ok("https://api.together.ai/v1/chat/completions".to_string()),
        "fireworks" => Ok("https://api.fireworks.ai/inference/v1/chat/completions".to_string()),
        "cerebras" => Ok("https://api.cerebras.ai/v1/chat/completions".to_string()),
        "nvidia" => Ok("https://integrate.api.nvidia.com/v1/chat/completions".to_string()),
        "azure-openai" => {
            let base = base_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Azure OpenAI provider requires a Base URL.".to_string())?;
            super::ensure_provider_host(provider_id, base)?;
            Ok(append_openai_compatible_path(base, "/chat/completions"))
        }
        "custom-openai" => {
            let base = base_url
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Custom OpenAI-compatible provider requires a Base URL.".to_string())?;
            super::ensure_provider_host(provider_id, base)?;
            Ok(append_openai_compatible_path(base, "/chat/completions"))
        }
        _ => Err(format!(
            "{provider_id} is not yet available on Orbit's direct Plan streaming path"
        )),
    }
}
