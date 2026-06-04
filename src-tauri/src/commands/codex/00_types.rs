use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

pub const CODEX_EVENT_STATUS: &str = "codex://status";
pub const CODEX_EVENT_ITEM: &str = "codex://item";
pub const CODEX_EVENT_TURN: &str = "codex://turn";
pub const CODEX_EVENT_ERROR: &str = "codex://error";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSidecarStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub bridge_base_url: Option<String>,
    pub codex_home: Option<String>,
    pub last_error: Option<String>,
    pub last_stderr_tail: Option<String>,
    pub last_exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThread {
    pub id: String,
    pub title: String,
    pub workspace_path: Option<String>,
    pub archived: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurn {
    pub id: String,
    pub thread_id: String,
    pub status: String,
    pub mode: String,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexItem {
    pub id: String,
    pub thread_id: String,
    pub turn_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub text: String,
    pub status: String,
    pub created_at: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexItemEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub item: Option<CodexItem>,
    pub item_id: Option<String>,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub kind: Option<String>,
    pub title: Option<String>,
    pub text_delta: Option<String>,
    pub sequence: Option<u64>,
    pub status: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub error: Option<String>,
    pub created_at: Option<String>,
    pub operation_id: Option<String>,
    pub connection_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadStartInput {
    pub workspace_path: String,
    pub thread_id: Option<String>,
    pub title: Option<String>,
    pub mode: String,
    pub provider_id: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadStartResult {
    pub thread: CodexThread,
    pub sidecar: CodexSidecarStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurnStartInput {
    pub thread_id: String,
    pub workspace_path: String,
    pub prompt: String,
    pub mode: String,
    pub runtime_mode: Option<String>,
    pub provider_id: String,
    pub model: String,
    pub base_url: Option<String>,
    pub reasoning_effort: Option<String>,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexTurnStartResult {
    pub turn: CodexTurn,
    pub items: Vec<CodexItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexBridgeProvider {
    pub id: String,
    pub label: String,
    pub base_url: Option<String>,
    pub supported: bool,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexBridgeStatus {
    pub status: String,
    pub base_url: Option<String>,
    pub active_provider: Option<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodexProviderError {
    pub code: String,
    pub provider_id: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSidecarVersionInfo {
    pub version: Option<String>,
    pub path: Option<String>,
    pub sha256: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRestartResult {
    pub status: CodexSidecarStatus,
    pub pid: Option<u32>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOperationSnapshot {
    pub id: String,
    pub connection_id: Option<String>,
    pub kind: String,
    pub status: String,
    pub thread_id: Option<String>,
    pub turn_id: Option<String>,
    pub started_at: String,
    pub deadline_at: String,
    pub last_event_at: Option<String>,
    pub cancelled: Option<bool>,
    pub final_state: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexRuntimeDiagnostics {
    pub pid: Option<u32>,
    pub sidecar_path: Option<String>,
    pub stderr_tail: Option<String>,
    pub exit_code: Option<i32>,
    pub pending_response_count: usize,
    pub pending_request_count: usize,
    pub active_operation: Option<RuntimeOperationSnapshot>,
    pub last_event_at: Option<String>,
    pub stale_event_count: Option<u64>,
    pub last_stage: Option<String>,
    pub last_stage_at: Option<String>,
    pub last_stage_metadata: Option<Value>,
    pub last_error: Option<String>,
}
