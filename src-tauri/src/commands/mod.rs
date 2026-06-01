//! # Tauri Command API — Orbit Code v1.0.0
//!
//! All frontend operations go through these Rust commands.
//! Commands are registered in `lib.rs` via `generate_handler!`.
//!
//! ## Credential Management
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `store_vault_credential` | provider:String, secret:String, passphrase:String, remember_device?:bool | `()` | Encrypt an API key into Orbit's local credential vault |
//! | `unlock_credential_vault` | passphrase:String | `Vec<String>` | Unlock stored provider credentials for the current process |
//! | `enable_vault_auto_unlock` | passphrase:String | `Vec<String>` | Enable trusted-device auto-unlock on personal devices |
//!
//! ## File Operations
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `list_workspace_files` | workspace_path?:String | `Vec<String>` | List all workspace files (excludes hidden/node_modules/target/dist/build) |
//! | `read_workspace_file` | path:String, workspace_path?:String | `String` | Read file with path traversal protection |
//! | `write_workspace_context_file` | workspace_path:String, path:String, content:String | `()` | Write an allowed Orbit context file with path traversal protection |
//! | `search_workspace_files` | query:String, workspace_path:String, max_results?:usize | `Vec<String>` | Search workspace files with ripgrep-style output |
//! | `open_workspace_path` | path:String, workspace_path?:String, action:String | `()` | Open/reveal a workspace file with a whitelisted local app action |
//!
//! ## Shell Execution
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `run_command_async` | app:AppHandle, task_id:String, command:String, args:Vec\<String\>, sandbox_mode:String, workspace_path?:String | `()` | Async shell execution with timeout + RSS guard. Emits `command-output` events |
//! | `run_command_sync` | command:String, args:Vec\<String\>, sandbox_mode:String, workspace_path?:String | `String` | Synchronous shell execution with process monitoring |
//!
//! ## Patch Application
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `apply_workspace_patch` | path:String, new_content:String | `()` | Write single file with path traversal protection |
//! | `apply_workspace_patches_transactional` | workspace_path:String, patches:Vec\<FilePatch\> | `()` | Multi-file atomic write with rollback |
//! | `restore_workspace_file_snapshot` | workspace_path:String, files:Vec\<FileSnapshot\> | `()` | Transactionally restore or delete files from a patch checkpoint |
//! | `create_workspace_git_shadow_checkpoint` | workspace_path:String, checkpoint_id:String, files:Vec\<FileSnapshot\> | `GitShadowCheckpointResult` | Create an isolated git checkpoint without touching the user repo |
//! | `restore_workspace_git_shadow_checkpoint` | workspace_path:String, shadow_path:String, files:Vec\<FileSnapshot\> | `()` | Restore files from an isolated git checkpoint |
//!
//! ## Code Graph & Analysis
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `build_workspace_symbol_index` | — | `Vec<SymbolInfo>` | Build symbol index using tree-sitter AST (fallback: string matching) |
//! | `build_code_graph` | workspace_path:String | `CodeGraph` | Build complete code graph (nodes + edges) for all source files |
//!
//! ## Merge Conflict Resolution
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `resolve_patch_conflict` | path:String, old_content:String, new_content:String | `MergeResult` | Three-way merge (diffy) between old/new/disk content |
//!
//! ## LLM API Relay
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `call_llm_api` | provider:String, api_url:String, payload:Value | `String` | Synchronous LLM API call (CORS bypass). Reads API key from the unlocked credential vault |
//! | `call_llm_api_streaming` | app:AppHandle, stream_id:String, provider:String, api_url:String, payload:Value | `()` | Streaming LLM API call. Emits `llm-stream-start/chunk/end/error` events |
//! | `list_llm_models` | provider:String, base_url?:String | `Vec<String>` | Fetch provider model IDs using the unlocked credential vault |
//!
//! ## Vector Embeddings & Semantic Search
//! | Command | Params | Returns | Description |
//! |---------|--------|---------|-------------|
//! | `build_embeddings` | app:AppHandle | `BuildStats` | Build/update vector embeddings for all workspace code (OpenAI text-embedding-3-small, 1536d) |
//! | `semantic_search` | app:AppHandle, query:String, top_k:usize | `Vec<SearchResult>` | Semantic code search using cosine similarity on stored embeddings |

use crate::code_graph;
use crate::db;
use crate::embedding;
use crate::process_monitor;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Component;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

pub mod codex;
pub mod command;
pub mod context;
pub mod file;
pub mod patch;
pub mod provider;
pub mod vault;

/* ==========================================================================
Greet
========================================================================== */

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/* ==========================================================================
跨平台凭据保管模块
========================================================================== */

const VAULT_KEY_PREFIX: &str = "credential.vault.";
const VAULT_AUTO_UNLOCK_KEY: &str = "credential.vault.auto_unlock";
const VAULT_AUTO_UNLOCK_DEVICE_KEY_FILE: &str = "orbit-device-unlock.key";

static CREDENTIAL_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn credential_cache() -> &'static Mutex<HashMap<String, String>> {
    CREDENTIAL_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EncryptedCredentialEnvelope {
    version: u8,
    provider: String,
    kdf: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrustedDeviceEnvelope {
    version: u8,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct TrustedDevicePayload {
    providers: HashMap<String, String>,
}

fn vault_key(provider: &str) -> String {
    format!("{}{}", VAULT_KEY_PREFIX, provider)
}

fn derive_vault_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    if passphrase.trim().is_empty() {
        return Err("Credential vault passphrase cannot be empty".to_string());
    }
    let params = Params::new(19_456, 2, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|e| e.to_string())?;
    Ok(key)
}

fn encrypt_secret(
    provider: &str,
    secret: &str,
    passphrase: &str,
) -> Result<EncryptedCredentialEnvelope, String> {
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce_bytes);

    let key = derive_vault_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), secret.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(EncryptedCredentialEnvelope {
        version: 1,
        provider: provider.to_string(),
        kdf: "argon2id:m=19456,t=2,p=1".to_string(),
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_secret(
    envelope: &EncryptedCredentialEnvelope,
    passphrase: &str,
) -> Result<String, String> {
    let salt = BASE64.decode(&envelope.salt).map_err(|e| e.to_string())?;
    let nonce = BASE64.decode(&envelope.nonce).map_err(|e| e.to_string())?;
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|e| e.to_string())?;
    let key = derive_vault_key(passphrase, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "Unable to decrypt credential vault. Check the passphrase.".to_string())?;
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

fn load_credentials_with_passphrase(
    app: &AppHandle,
    passphrase: &str,
) -> Result<HashMap<String, String>, String> {
    let conn = db::get_connection(app)?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM kv_store WHERE key LIKE ?1")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([format!("{}%", VAULT_KEY_PREFIX)], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut providers = HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        if key == VAULT_AUTO_UNLOCK_KEY {
            continue;
        }
        let provider = key.trim_start_matches(VAULT_KEY_PREFIX).to_string();
        let envelope = serde_json::from_str::<EncryptedCredentialEnvelope>(&value)
            .map_err(|e| e.to_string())?;
        providers.insert(provider, decrypt_secret(&envelope, passphrase)?);
    }
    Ok(providers)
}

fn trusted_device_key_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = db::get_app_data_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(VAULT_AUTO_UNLOCK_DEVICE_KEY_FILE))
}

fn load_or_create_trusted_device_key(app: &AppHandle) -> Result<[u8; 32], String> {
    let key_path = trusted_device_key_path(app)?;
    if key_path.exists() {
        let raw = fs::read_to_string(&key_path).map_err(|e| e.to_string())?;
        let decoded = BASE64.decode(raw.trim()).map_err(|e| e.to_string())?;
        if decoded.len() != 32 {
            return Err("Trusted-device unlock key is invalid".to_string());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&decoded);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    fs::write(&key_path, BASE64.encode(key)).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&key_path, permissions).map_err(|e| e.to_string())?;
    }
    Ok(key)
}

fn encrypt_trusted_device_payload(
    app: &AppHandle,
    providers: &HashMap<String, String>,
) -> Result<TrustedDeviceEnvelope, String> {
    let key = load_or_create_trusted_device_key(app)?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let payload = TrustedDevicePayload {
        providers: providers.clone(),
    };
    let raw = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), raw.as_ref())
        .map_err(|e| e.to_string())?;
    Ok(TrustedDeviceEnvelope {
        version: 1,
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(ciphertext),
    })
}

fn decrypt_trusted_device_payload(
    app: &AppHandle,
    raw_envelope: &str,
) -> Result<TrustedDevicePayload, String> {
    let key = load_or_create_trusted_device_key(app)?;
    let envelope =
        serde_json::from_str::<TrustedDeviceEnvelope>(raw_envelope).map_err(|e| e.to_string())?;
    let nonce = BASE64.decode(&envelope.nonce).map_err(|e| e.to_string())?;
    let ciphertext = BASE64
        .decode(&envelope.ciphertext)
        .map_err(|e| e.to_string())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "Unable to unlock trusted-device credential cache.".to_string())?;
    serde_json::from_slice::<TrustedDevicePayload>(&plaintext).map_err(|e| e.to_string())
}

fn save_trusted_device_cache(
    app: &AppHandle,
    providers: &HashMap<String, String>,
) -> Result<(), String> {
    let envelope = encrypt_trusted_device_payload(app, providers)?;
    let raw = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    db::db_set(app.clone(), VAULT_AUTO_UNLOCK_KEY.to_string(), raw)
}

fn trusted_device_cache_exists(app: &AppHandle) -> bool {
    db::db_get(app.clone(), VAULT_AUTO_UNLOCK_KEY.to_string())
        .ok()
        .flatten()
        .is_some()
}

#[tauri::command]
pub fn store_vault_credential(
    app: AppHandle,
    provider: String,
    secret: String,
    passphrase: String,
    remember_device: Option<bool>,
) -> Result<(), String> {
    if provider.trim().is_empty() {
        return Err("Provider is required".to_string());
    }
    if secret.trim().is_empty() {
        return Err("API key is required".to_string());
    }
    let envelope = encrypt_secret(&provider, &secret, &passphrase)?;
    let raw = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    db::db_set(app.clone(), vault_key(&provider), raw)?;
    credential_cache()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(provider, secret);
    if remember_device.unwrap_or(false) || trusted_device_cache_exists(&app) {
        let providers = load_credentials_with_passphrase(&app, &passphrase)?;
        save_trusted_device_cache(&app, &providers)?;
    }
    Ok(())
}

#[tauri::command]
pub fn unlock_credential_vault(app: AppHandle, passphrase: String) -> Result<Vec<String>, String> {
    let providers = load_credentials_with_passphrase(&app, &passphrase)?;
    let mut cache = credential_cache().lock().map_err(|e| e.to_string())?;
    let mut unlocked = Vec::new();
    for (provider, secret) in providers {
        cache.insert(provider.clone(), secret);
        unlocked.push(provider);
    }
    Ok(unlocked)
}

#[tauri::command]
pub fn enable_vault_auto_unlock(app: AppHandle, passphrase: String) -> Result<Vec<String>, String> {
    let providers = load_credentials_with_passphrase(&app, &passphrase)?;
    save_trusted_device_cache(&app, &providers)?;
    let mut cache = credential_cache().lock().map_err(|e| e.to_string())?;
    let mut unlocked = Vec::new();
    for (provider, secret) in providers {
        cache.insert(provider.clone(), secret);
        unlocked.push(provider);
    }
    Ok(unlocked)
}

#[tauri::command]
pub fn try_vault_auto_unlock(app: AppHandle) -> Result<Vec<String>, String> {
    let Some(raw) = db::db_get(app.clone(), VAULT_AUTO_UNLOCK_KEY.to_string())? else {
        return Ok(Vec::new());
    };
    let payload = decrypt_trusted_device_payload(&app, &raw)?;
    let mut cache = credential_cache().lock().map_err(|e| e.to_string())?;
    let mut unlocked = Vec::new();
    for (provider, secret) in payload.providers {
        cache.insert(provider.clone(), secret);
        unlocked.push(provider);
    }
    Ok(unlocked)
}

#[tauri::command]
pub fn disable_vault_auto_unlock(app: AppHandle) -> Result<(), String> {
    db::db_delete(app.clone(), VAULT_AUTO_UNLOCK_KEY.to_string())?;
    let key_path = trusted_device_key_path(&app)?;
    if key_path.exists() {
        fs::remove_file(key_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn is_vault_auto_unlock_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(trusted_device_cache_exists(&app))
}

#[tauri::command]
pub fn list_vault_credential_providers(app: AppHandle) -> Result<Vec<String>, String> {
    let conn = db::get_connection(&app)?;
    let mut stmt = conn
        .prepare("SELECT key FROM kv_store WHERE key LIKE ?1 ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([format!("{}%", VAULT_KEY_PREFIX)], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?;
    let mut providers = Vec::new();
    for row in rows {
        let key = row.map_err(|e| e.to_string())?;
        if key == VAULT_AUTO_UNLOCK_KEY {
            continue;
        }
        providers.push(key.trim_start_matches(VAULT_KEY_PREFIX).to_string());
    }
    Ok(providers)
}

#[tauri::command]
pub fn delete_vault_credential(app: AppHandle, provider: String) -> Result<(), String> {
    db::db_delete(app, vault_key(&provider))?;
    credential_cache()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&provider);
    Ok(())
}

fn get_provider_credential(provider: &str) -> Result<Option<String>, String> {
    Ok(credential_cache()
        .lock()
        .map_err(|e| e.to_string())?
        .get(provider)
        .cloned())
}

/* ==========================================================================
本地文件树感知模块 (File Trees Explorer)
========================================================================== */

fn is_ignored(name: &str) -> bool {
    code_graph::is_ignored_name(name)
}

static WORKSPACE_ROOT: OnceLock<Mutex<PathBuf>> = OnceLock::new();

fn workspace_root_cell() -> &'static Mutex<PathBuf> {
    WORKSPACE_ROOT.get_or_init(|| {
        let current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        #[cfg(test)]
        let default_root = current_dir;
        #[cfg(not(test))]
        let default_root = default_workspace_root(current_dir);
        Mutex::new(default_root)
    })
}

fn default_workspace_root(current_dir: PathBuf) -> PathBuf {
    if current_dir.file_name().and_then(|name| name.to_str()) == Some("src-tauri") {
        if let Some(parent) = current_dir.parent() {
            if parent.join("package.json").is_file() || parent.join(".git").exists() {
                return parent.to_path_buf();
            }
        }
    }
    current_dir
}

fn get_active_workspace_root() -> Result<PathBuf, String> {
    let root = workspace_root_cell()
        .lock()
        .map_err(|_| "Workspace root lock poisoned".to_string())?
        .clone();
    root.canonicalize().map_err(|e| e.to_string())
}

fn resolve_workspace_root(workspace_path: Option<String>) -> Result<PathBuf, String> {
    match workspace_path {
        Some(path) if !path.trim().is_empty() => {
            let canonical = PathBuf::from(path)
                .canonicalize()
                .map_err(|e| format!("Workspace not found: {}", e))?;
            if !canonical.is_dir() {
                return Err("Workspace path must be a directory".to_string());
            }
            Ok(canonical)
        }
        _ => get_active_workspace_root(),
    }
}

fn resolve_command_cwd(workspace_root: &Path, cwd: Option<String>) -> Result<PathBuf, String> {
    let Some(cwd) = cwd else {
        return workspace_root.canonicalize().map_err(|e| e.to_string());
    };
    let trimmed = cwd.trim();
    if trimmed.is_empty() || trimmed == "." {
        return workspace_root.canonicalize().map_err(|e| e.to_string());
    }
    let relative = PathBuf::from(trimmed);
    if relative.is_absolute() {
        return Err("Command cwd must be relative to the workspace".to_string());
    }
    let target = workspace_root.join(relative);
    assert_workspace_child(
        workspace_root,
        &target,
        "Access Denied: Command cwd escapes workspace",
    )?;
    let canonical = target
        .canonicalize()
        .map_err(|e| format!("Command cwd not found: {}", e))?;
    if !canonical.is_dir() {
        return Err("Command cwd must be a directory".to_string());
    }
    Ok(canonical)
}

fn assert_workspace_child(root: &Path, target: &Path, message: &str) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let canonical_target = target.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(message.to_string());
    }
    Ok(())
}

fn reject_unsafe_relative_path(path: &str, label: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(format!("{} path is required", label));
    }
    let relative = Path::new(trimmed);
    if relative.is_absolute() {
        return Err(format!("{} path must be relative to the workspace", label));
    }
    for component in relative.components() {
        match component {
            Component::Normal(_) => {}
            Component::CurDir => {}
            _ => return Err(format!("{} path contains unsafe components", label)),
        }
    }
    Ok(())
}

fn resolve_workspace_file_target(
    workspace_path: Option<String>,
    path: String,
) -> Result<(PathBuf, PathBuf), String> {
    reject_unsafe_relative_path(&path, "File action")?;
    let workspace_root = resolve_workspace_root(workspace_path)?;
    let target = workspace_root.join(path.trim());
    assert_workspace_child(
        &workspace_root,
        &target,
        "Access Denied: File action path escapes workspace",
    )?;
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("File action target not found: {}", e))?;
    if !canonical_target.is_file() {
        return Err("File action target must be a file".to_string());
    }
    assert_workspace_child(
        &workspace_root,
        &canonical_target,
        "Access Denied: File action path escapes workspace",
    )?;
    Ok((workspace_root, canonical_target))
}

fn run_open_command(mut command: Command, failure_label: &str) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|e| format!("{} failed to start: {}", failure_label, e))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("{} failed", failure_label)
    } else {
        format!("{} failed: {}", failure_label, stderr)
    })
}

#[tauri::command]
pub fn get_workspace_root() -> Result<String, String> {
    Ok(get_active_workspace_root()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_workspace_root(path: String) -> Result<String, String> {
    let candidate = PathBuf::from(path);
    let canonical = candidate
        .canonicalize()
        .map_err(|e| format!("Workspace not found: {}", e))?;
    if !canonical.is_dir() {
        return Err("Workspace path must be a directory".to_string());
    }

    let mut root = workspace_root_cell()
        .lock()
        .map_err(|_| "Workspace root lock poisoned".to_string())?;
    *root = canonical.clone();
    Ok(canonical.to_string_lossy().to_string())
}

fn walk_dir(dir: &Path, base: &Path, files: &mut Vec<String>) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            if is_ignored(&file_name) {
                continue;
            }
            if path.is_dir() {
                walk_dir(&path, base, files)?;
            } else {
                if let Ok(rel) = path.strip_prefix(base) {
                    files.push(rel.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_workspace_files(workspace_path: Option<String>) -> Result<Vec<String>, String> {
    let current_dir = resolve_workspace_root(workspace_path)?;
    let mut files = Vec::new();
    walk_dir(&current_dir, &current_dir, &mut files).map_err(|e| e.to_string())?;
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn read_workspace_file(path: String, workspace_path: Option<String>) -> Result<String, String> {
    let current_dir = resolve_workspace_root(workspace_path)?;

    let target_path = current_dir.join(&path);
    assert_workspace_child(
        &current_dir,
        &target_path,
        "Access Denied: Path traversal detected",
    )?;

    let content = fs::read_to_string(target_path).map_err(|e| e.to_string())?;
    Ok(content)
}

fn is_allowed_context_path(path: &str) -> bool {
    if path == "ORBIT.md" || path == ".orbit/rules" || path == ".orbit/rules.md" {
        return true;
    }
    let parts: Vec<&str> = path.split('/').collect();
    parts.len() == 4
        && parts[0] == ".orbit"
        && parts[1] == "skills"
        && !parts[2].is_empty()
        && parts[3] == "SKILL.md"
}

#[tauri::command]
pub fn write_workspace_context_file(
    workspace_path: String,
    path: String,
    content: String,
) -> Result<(), String> {
    if workspace_path.trim().is_empty() {
        return Err("workspace_path is required".to_string());
    }
    reject_unsafe_relative_path(&path, "Context file")?;
    let normalized = path.trim().replace('\\', "/");
    if !is_allowed_context_path(&normalized) {
        return Err("Context file path is not allowed".to_string());
    }

    let workspace_root = resolve_workspace_root(Some(workspace_path))?;
    let target = workspace_root.join(&normalized);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        assert_workspace_child(
            &workspace_root,
            parent,
            "Access Denied: Context file path escapes workspace",
        )?;
    }
    if target.exists() {
        assert_workspace_child(
            &workspace_root,
            &target,
            "Access Denied: Context file path escapes workspace",
        )?;
    }
    fs::write(target, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn search_workspace_files(
    query: String,
    workspace_path: String,
    max_results: Option<usize>,
) -> Result<Vec<String>, String> {
    if query.trim().is_empty() {
        return Err("query is required".to_string());
    }
    if workspace_path.trim().is_empty() {
        return Err("workspace_path is required".to_string());
    }
    let workspace_root = resolve_workspace_root(Some(workspace_path))?;
    let limit = max_results.unwrap_or(30).min(200);

    let output = Command::new("rg")
        .args([
            "--line-number",
            "--no-heading",
            "--color",
            "never",
            "--max-count",
            "20",
            "--",
            &query,
        ])
        .current_dir(&workspace_root)
        .output();

    match output {
        Ok(output) => {
            if !output.status.success() && output.status.code() != Some(1) {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
            }
            let stdout = String::from_utf8_lossy(&output.stdout);
            Ok(stdout
                .lines()
                .take(limit)
                .map(|line| line.chars().take(240).collect::<String>())
                .collect())
        }
        Err(_) => {
            let mut results = Vec::new();
            let files = list_workspace_files(Some(workspace_root.to_string_lossy().to_string()))?;
            let query_lower = query.to_lowercase();
            for file in files {
                if results.len() >= limit {
                    break;
                }
                let content = match read_workspace_file(
                    file.clone(),
                    Some(workspace_root.to_string_lossy().to_string()),
                ) {
                    Ok(content) => content,
                    Err(_) => continue,
                };
                for (index, line) in content.lines().enumerate() {
                    if line.to_lowercase().contains(&query_lower) {
                        let preview: String = line.trim().chars().take(160).collect();
                        results.push(format!("{}:{}:{}", file, index + 1, preview));
                        if results.len() >= limit {
                            break;
                        }
                    }
                }
            }
            Ok(results)
        }
    }
}

#[tauri::command]
pub fn open_workspace_path(
    path: String,
    workspace_path: Option<String>,
    action: String,
) -> Result<(), String> {
    let (_workspace_root, target) = resolve_workspace_file_target(workspace_path, path)?;
    let target_arg = target.to_string_lossy().to_string();

    match action.as_str() {
        "reveal" => {
            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.args(["-R", &target_arg]);
                run_open_command(cmd, "Reveal in Finder")
            }
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("explorer");
                cmd.arg(format!("/select,{}", target_arg));
                run_open_command(cmd, "Reveal in File Explorer")
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                let parent = target
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .to_string_lossy()
                    .to_string();
                let mut cmd = Command::new("xdg-open");
                cmd.arg(parent);
                run_open_command(cmd, "Reveal in file manager")
            }
        }
        "default" => {
            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.arg(&target_arg);
                run_open_command(cmd, "Open with default app")
            }
            #[cfg(target_os = "windows")]
            {
                let mut cmd = Command::new("cmd");
                cmd.args(["/C", "start", "", &target_arg]);
                run_open_command(cmd, "Open with default app")
            }
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                let mut cmd = Command::new("xdg-open");
                cmd.arg(&target_arg);
                run_open_command(cmd, "Open with default app")
            }
        }
        "vscode" => {
            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.args(["-a", "Visual Studio Code", &target_arg]);
                run_open_command(cmd, "Open in VS Code")
            }
            #[cfg(not(target_os = "macos"))]
            {
                let mut cmd = Command::new("code");
                cmd.arg(&target_arg);
                run_open_command(cmd, "Open in VS Code")
            }
        }
        "cursor" => {
            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("open");
                cmd.args(["-a", "Cursor", &target_arg]);
                run_open_command(cmd, "Open in Cursor")
            }
            #[cfg(not(target_os = "macos"))]
            {
                let mut cmd = Command::new("cursor");
                cmd.arg(&target_arg);
                run_open_command(cmd, "Open in Cursor")
            }
        }
        _ => Err("Unsupported file action".to_string()),
    }
}

/* ==========================================================================
异步 Shell 进程流式执行模块 (Async Shell & Stream Output)
========================================================================== */

#[tauri::command]
pub fn run_command_async(
    app: AppHandle,
    task_id: String,
    command: String,
    args: Vec<String>,
    sandbox_mode: String,
    workspace_path: Option<String>,
    cwd: Option<String>,
) -> Result<(), String> {
    thread::spawn(move || {
        let workspace_root = match resolve_workspace_root(workspace_path) {
            Ok(d) => d,
            Err(e) => {
                let err_msg = format!("workspace root failed: {}\n", e);
                let _ = app.emit(
                    "command-output",
                    serde_json::json!({
                        "taskId": task_id,
                        "text": err_msg,
                        "done": true,
                        "exitCode": Some(1)
                    }),
                );
                return;
            }
        };
        let current_dir = match resolve_command_cwd(&workspace_root, cwd) {
            Ok(d) => d,
            Err(e) => {
                let err_msg = format!("command cwd failed: {}\n", e);
                let _ = app.emit(
                    "command-output",
                    serde_json::json!({
                        "taskId": task_id,
                        "text": err_msg,
                        "done": true,
                        "exitCode": Some(1)
                    }),
                );
                return;
            }
        };
        let canonical_dir = match current_dir.canonicalize() {
            Ok(d) => d,
            Err(e) => {
                let err_msg = format!("canonicalize failed: {}\n", e);
                let _ = app.emit(
                    "command-output",
                    serde_json::json!({
                        "taskId": task_id,
                        "text": err_msg,
                        "done": true,
                        "exitCode": Some(1)
                    }),
                );
                return;
            }
        };

        let mut cmd = if sandbox_mode == "docker" {
            let mut docker_cmd = Command::new("docker");
            let mut docker_args = vec![
                "run".to_string(),
                "--rm".to_string(),
                "-v".to_string(),
                format!("{}:/workspace", canonical_dir.to_string_lossy()),
                "-w".to_string(),
                "/workspace".to_string(),
                "node:18-alpine".to_string(),
                "sh".to_string(),
                "-c".to_string(),
            ];

            let full_command = if args.is_empty() {
                command.clone()
            } else {
                format!("{} {}", command, args.join(" "))
            };
            docker_args.push(full_command);

            docker_cmd.args(&docker_args);
            docker_cmd
        } else {
            let mut local_cmd = Command::new(&command);
            local_cmd.args(&args);
            local_cmd.current_dir(&canonical_dir);

            if sandbox_mode == "restricted" {
                local_cmd.env_clear();
                local_cmd.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin");
            }
            local_cmd
        };

        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let err_msg = format!("Failed to spawn command: {}\n", e);
                let _ = app.emit(
                    "command-output",
                    serde_json::json!({
                        "taskId": task_id,
                        "text": err_msg,
                        "done": true,
                        "exitCode": Some(1)
                    }),
                );
                return;
            }
        };

        let pid = child.id();
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                return;
            }
        };
        let stderr = match child.stderr.take() {
            Some(s) => s,
            None => {
                return;
            }
        };

        let app_stdout = app.clone();
        let task_id_stdout = task_id.clone();
        let stdout_handle = thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let _ = app_stdout.emit(
                        "command-output",
                        serde_json::json!({
                            "taskId": task_id_stdout,
                            "text": format!("{}\n", text),
                            "done": false,
                            "exitCode": null
                        }),
                    );
                }
            }
        });

        let app_stderr = app.clone();
        let task_id_stderr = task_id.clone();
        let stderr_handle = thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(text) = line {
                    let _ = app_stderr.emit(
                        "command-output",
                        serde_json::json!({
                            "taskId": task_id_stderr,
                            "text": format!("{}\n", text),
                            "done": false,
                            "exitCode": null
                        }),
                    );
                }
            }
        });

        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;
        let is_done = Arc::new(AtomicBool::new(false));

        let is_done_monitor = is_done.clone();
        let app_monitor = app.clone();
        let task_id_monitor = task_id.clone();

        let monitor_handle = thread::spawn(move || {
            let start_time = std::time::Instant::now();
            let limit_rss_increment = 512 * 1024 * 1024;
            let mut initial_rss = 0;

            for _ in 0..10 {
                if let Some(rss) = process_monitor::get_process_rss(pid) {
                    initial_rss = rss;
                    break;
                }
                thread::sleep(std::time::Duration::from_millis(50));
            }

            loop {
                if is_done_monitor.load(Ordering::SeqCst) {
                    break;
                }

                if start_time.elapsed().as_secs() >= 120 {
                    let _ = app_monitor.emit("command-output", serde_json::json!({
                        "taskId": task_id_monitor,
                        "text": "\n[Verifier Guard] Error: Time Limit Exceeded (120s). Process killed.\n",
                        "done": false,
                        "exitCode": null
                    }));
                    if let Err(e) = Command::new("kill")
                        .args(&["-9", &pid.to_string()])
                        .output()
                    {
                        eprintln!("Failed to kill process {}: {}", pid, e);
                    }
                    return Err("timeout".to_string());
                }

                if let Some(rss) = process_monitor::get_process_rss(pid) {
                    if initial_rss > 0 && rss > initial_rss + limit_rss_increment {
                        let _ = app_monitor.emit("command-output", serde_json::json!({
                                "taskId": task_id_monitor,
                                "text": format!("\n[Verifier Guard] Error: Resource Limit Exceeded (RSS increased by >512MB. Initial: {}MB, Current: {}MB). Process killed.\n", initial_rss / 1024 / 1024, rss / 1024 / 1024),
                                "done": false,
                                "exitCode": null
                            }));
                        if let Err(e) = Command::new("kill")
                            .args(&["-9", &pid.to_string()])
                            .output()
                        {
                            eprintln!("Failed to kill process {}: {}", pid, e);
                        }
                        return Err("leak".to_string());
                    }
                }

                thread::sleep(std::time::Duration::from_millis(200));
            }
            Ok(())
        });

        let _ = stdout_handle.join();
        let _ = stderr_handle.join();

        is_done.store(true, Ordering::SeqCst);
        let monitor_result = monitor_handle.join();

        let was_killed = match monitor_result {
            Ok(Err(reason)) => Some(reason),
            _ => None,
        };

        let exit_code = if let Some(reason) = was_killed {
            if reason == "timeout" {
                124
            } else {
                137
            }
        } else {
            match child.wait() {
                Ok(status) => status.code().unwrap_or(0),
                Err(_) => 1,
            }
        };

        let _ = app.emit(
            "command-output",
            serde_json::json!({
                "taskId": task_id,
                "text": "",
                "done": true,
                "exitCode": Some(exit_code)
            }),
        );
    });

    Ok(())
}

#[tauri::command]
pub fn run_command_sync(
    command: String,
    args: Vec<String>,
    sandbox_mode: String,
    workspace_path: Option<String>,
    cwd: Option<String>,
) -> Result<String, String> {
    let workspace_root = resolve_workspace_root(workspace_path)?;
    let current_dir = resolve_command_cwd(&workspace_root, cwd)?;
    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&command);
    cmd.args(&args);
    if sandbox_mode == "restricted" {
        cmd.env_clear();
        cmd.env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin");
    }
    cmd.current_dir(&canonical_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let child = cmd.spawn().map_err(|e| format!("Failed to spawn: {}", e))?;
    let pid = child.id();

    let guard = process_monitor::ProcessGuard::new();
    let done_flag = guard.is_done_handle();
    let policy = process_monitor::ProcessMonitorPolicy::default();

    let monitor_done = done_flag.clone();
    let monitor_handle =
        thread::spawn(move || process_monitor::ProcessGuard::monitor(monitor_done, pid, policy));

    let output = child.wait_with_output().map_err(|e| {
        guard.signal_done();
        format!("Process failed: {}", e)
    })?;

    guard.signal_done();
    let _ = monitor_handle.join();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    let mut result = stdout;
    if !stderr.is_empty() {
        result = format!("{}\n[stderr]:\n{}", result, stderr);
    }
    result = format!("{}\n[exit_code: {}]", result, exit_code);
    Ok(result)
}

/* ==========================================================================
Patch & 文件事务写入模块
========================================================================== */

#[tauri::command]
#[allow(dead_code)]
pub fn apply_workspace_patch(path: String, new_content: String) -> Result<(), String> {
    let current_dir = get_active_workspace_root()?;
    let target_path = current_dir.join(&path);

    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;

    if target_path.exists() {
        let canonical_target = target_path.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_dir) {
            return Err("Access Denied: Path traversal writing detected".to_string());
        }
    } else {
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_parent.starts_with(&canonical_dir) {
                return Err("Access Denied: Path traversal directory writing detected".to_string());
            }
        }
    }

    fs::write(&target_path, new_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct FilePatch {
    pub path: String,
    pub old_content: String,
    pub new_content: String,
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct FileSnapshot {
    pub path: String,
    pub content: String,
    pub existed: bool,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct GitShadowCheckpointResult {
    pub checkpoint_id: String,
    pub shadow_path: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct SandboxPreviewResult {
    pub id: String,
    pub proposal_id: String,
    pub sandbox_path: String,
    pub status: String,
    pub output: String,
    pub created_at: String,
}

fn validate_relative_patch_path(path: &str) -> Result<(), String> {
    let patch_path = Path::new(path);
    if patch_path.is_absolute() {
        return Err(format!("Patch path must be relative: {}", path));
    }
    for component in patch_path.components() {
        match component {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(format!(
                    "Access Denied: Path traversal detected for {}",
                    path
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

fn timestamp_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[tauri::command]
pub fn preview_workspace_patches_in_sandbox(
    workspace_path: String,
    proposal_id: String,
    patches: Vec<FilePatch>,
) -> Result<SandboxPreviewResult, String> {
    let current_dir = if workspace_path.is_empty() {
        get_active_workspace_root()?
    } else {
        PathBuf::from(workspace_path)
    };
    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;
    let created_at = format!("{}", timestamp_millis());
    let id = format!("sandbox-{}-{}", proposal_id, created_at);
    let sandbox_dir = std::env::temp_dir().join("orbit-code-sandboxes").join(&id);

    fs::create_dir_all(&sandbox_dir).map_err(|e| format!("Create sandbox failed: {}", e))?;
    let canonical_sandbox = sandbox_dir.canonicalize().map_err(|e| e.to_string())?;

    let fail = |output: String| -> Result<SandboxPreviewResult, String> {
        Ok(SandboxPreviewResult {
            id: id.clone(),
            proposal_id: proposal_id.clone(),
            sandbox_path: canonical_sandbox.to_string_lossy().to_string(),
            status: "failed".to_string(),
            output,
            created_at: created_at.clone(),
        })
    };

    for patch in &patches {
        if let Err(error) = validate_relative_patch_path(&patch.path) {
            return fail(error);
        }

        let source_path = canonical_dir.join(&patch.path);
        if source_path.exists() {
            let canonical_source = source_path.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_source.starts_with(&canonical_dir) {
                return fail(format!(
                    "Access Denied: Path traversal detected for {}",
                    patch.path
                ));
            }
            let original = fs::read_to_string(&canonical_source).map_err(|e| e.to_string())?;
            if !patch.old_content.is_empty() && original != patch.old_content {
                return fail(format!(
                    "Stale write detected for {}. Refresh the diff and resolve conflicts before applying.",
                    patch.path
                ));
            }
        } else if let Some(parent) = source_path.parent() {
            let mut first_existing_parent = parent;
            while !first_existing_parent.exists() {
                if let Some(next_parent) = first_existing_parent.parent() {
                    first_existing_parent = next_parent;
                } else {
                    break;
                }
            }
            let canonical_parent = first_existing_parent
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if !canonical_parent.starts_with(&canonical_dir) {
                return fail(format!(
                    "Access Denied: Path traversal directory detected for {}",
                    patch.path
                ));
            }
        }

        let sandbox_target = canonical_sandbox.join(&patch.path);
        if let Some(parent) = sandbox_target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Create sandbox parent failed: {}", e))?;
            let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_parent.starts_with(&canonical_sandbox) {
                return fail(format!(
                    "Access Denied: Sandbox path traversal detected for {}",
                    patch.path
                ));
            }
        }

        fs::write(&sandbox_target, &patch.new_content)
            .map_err(|e| format!("Sandbox write failed for {}: {}", patch.path, e))?;
    }

    Ok(SandboxPreviewResult {
        id,
        proposal_id,
        sandbox_path: canonical_sandbox.to_string_lossy().to_string(),
        status: "sandboxed".to_string(),
        output: format!(
            "Sandbox preview created for {} patch(es). No workspace files were changed.",
            patches.len()
        ),
        created_at,
    })
}

#[tauri::command]
pub fn apply_workspace_patches_transactional(
    workspace_path: String,
    patches: Vec<FilePatch>,
) -> Result<(), String> {
    let current_dir = if workspace_path.is_empty() {
        get_active_workspace_root()?
    } else {
        PathBuf::from(workspace_path)
    };
    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;

    let mut backups: Vec<(PathBuf, Option<String>)> = Vec::new();

    for patch in &patches {
        let target_path = canonical_dir.join(&patch.path);

        if target_path.exists() {
            let canonical_target = target_path.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_target.starts_with(&canonical_dir) {
                return Err(format!(
                    "Access Denied: Path traversal writing detected for {}",
                    patch.path
                ));
            }
            let original = fs::read_to_string(&canonical_target).map_err(|e| e.to_string())?;
            if !patch.old_content.is_empty() && original != patch.old_content {
                return Err(format!("Stale write detected for {}. Refresh the diff and resolve conflicts before applying.", patch.path));
            }
            backups.push((canonical_target, Some(original)));
        } else {
            if let Some(parent) = target_path.parent() {
                let mut first_existing_parent = parent;
                while !first_existing_parent.exists() {
                    if let Some(p) = first_existing_parent.parent() {
                        first_existing_parent = p;
                    } else {
                        break;
                    }
                }
                let canonical_parent = first_existing_parent
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                if !canonical_parent.starts_with(&canonical_dir) {
                    return Err(format!(
                        "Access Denied: Path traversal directory writing detected for {}",
                        patch.path
                    ));
                }
            }
            backups.push((target_path, None));
        }
    }

    let mut written_temps: Vec<(PathBuf, PathBuf)> = Vec::new();
    for patch in &patches {
        let target_path = canonical_dir.join(&patch.path);
        let temp_path = target_path.with_extension(format!(
            "tmp{}",
            target_path
                .extension()
                .map(|e| format!(".{}", e.to_string_lossy()))
                .unwrap_or_default()
        ));

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        if let Err(e) = fs::write(&temp_path, &patch.new_content) {
            for (t, _) in &written_temps {
                let _ = fs::remove_file(t);
            }
            for (path, backup_opt) in backups {
                match backup_opt {
                    Some(original) => {
                        if let Err(re) = fs::write(&path, original) {
                            eprintln!("ROLLBACK FAILED for {}: {}", path.display(), re);
                        }
                    }
                    None => {
                        if path.exists() {
                            if let Err(re) = fs::remove_file(&path) {
                                eprintln!("ROLLBACK FAILED for {}: {}", path.display(), re);
                            }
                        }
                    }
                }
            }
            return Err(format!("Write temp failed: {}. Rolled back.", e));
        }

        written_temps.push((temp_path.clone(), target_path.clone()));
    }

    for (temp_path, target_path) in &written_temps {
        if let Err(e) = fs::rename(temp_path, target_path) {
            for (t, _) in written_temps.iter().filter(|(tp, _)| {
                if let Ok(md) = std::fs::metadata(tp) {
                    md.is_file()
                } else {
                    false
                }
            }) {
                let _ = fs::remove_file(t);
            }
            return Err(format!("Atomic rename failed: {}.", e));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn restore_workspace_file_snapshot(
    workspace_path: String,
    files: Vec<FileSnapshot>,
) -> Result<(), String> {
    let current_dir = if workspace_path.is_empty() {
        get_active_workspace_root()?
    } else {
        PathBuf::from(workspace_path)
    };
    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;
    let mut backups: Vec<(PathBuf, Option<String>)> = Vec::new();

    for file in &files {
        validate_relative_patch_path(&file.path)?;
        let target_path = canonical_dir.join(&file.path);
        if target_path.exists() {
            let canonical_target = target_path.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_target.starts_with(&canonical_dir) {
                return Err(format!(
                    "Access Denied: Snapshot restore path escapes workspace for {}",
                    file.path
                ));
            }
            let original = fs::read_to_string(&canonical_target).map_err(|e| e.to_string())?;
            backups.push((canonical_target, Some(original)));
        } else {
            if let Some(parent) = target_path.parent() {
                let mut first_existing_parent = parent;
                while !first_existing_parent.exists() {
                    if let Some(p) = first_existing_parent.parent() {
                        first_existing_parent = p;
                    } else {
                        break;
                    }
                }
                let canonical_parent = first_existing_parent
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                if !canonical_parent.starts_with(&canonical_dir) {
                    return Err(format!(
                        "Access Denied: Snapshot restore directory escapes workspace for {}",
                        file.path
                    ));
                }
            }
            backups.push((target_path, None));
        }
    }

    for file in &files {
        let target_path = canonical_dir.join(&file.path);
        let result = if file.existed {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent)
            } else {
                Ok(())
            }
            .and_then(|_| fs::write(&target_path, &file.content))
        } else if target_path.exists() {
            fs::remove_file(&target_path)
        } else {
            Ok(())
        };

        if let Err(e) = result {
            for (path, backup_opt) in backups {
                match backup_opt {
                    Some(original) => {
                        let _ = fs::write(&path, original);
                    }
                    None => {
                        if path.exists() {
                            let _ = fs::remove_file(&path);
                        }
                    }
                }
            }
            return Err(format!(
                "Snapshot restore failed for {}: {}. Rolled back.",
                file.path, e
            ));
        }
    }

    Ok(())
}

fn orbit_git_shadow_root() -> PathBuf {
    std::env::temp_dir().join("orbit-code-git-shadows")
}

fn run_git_command(dir: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Failed to run git: {}", e))?;
    if output.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

#[tauri::command]
pub fn create_workspace_git_shadow_checkpoint(
    workspace_path: String,
    checkpoint_id: String,
    files: Vec<FileSnapshot>,
) -> Result<GitShadowCheckpointResult, String> {
    if workspace_path.trim().is_empty() {
        return Err("workspace_path is required".to_string());
    }
    let workspace_root = resolve_workspace_root(Some(workspace_path))?;
    if !workspace_root.join(".git").exists() {
        return Err("Git workspace required for git-shadow checkpoint".to_string());
    }

    let shadow_root = orbit_git_shadow_root();
    fs::create_dir_all(&shadow_root).map_err(|e| e.to_string())?;
    let shadow_path = shadow_root.join(&checkpoint_id);
    if shadow_path.exists() {
        fs::remove_dir_all(&shadow_path).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(&shadow_path).map_err(|e| e.to_string())?;
    let canonical_shadow = shadow_path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_shadow.starts_with(shadow_root.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Access Denied: git shadow path escapes shadow root".to_string());
    }

    for file in &files {
        validate_relative_patch_path(&file.path)?;
        if !file.existed {
            continue;
        }
        let target = canonical_shadow.join(&file.path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&target, &file.content)
            .map_err(|e| format!("Git shadow write failed for {}: {}", file.path, e))?;
    }

    run_git_command(&canonical_shadow, &["init"])?;
    run_git_command(
        &canonical_shadow,
        &["config", "user.email", "orbit-code@example.local"],
    )?;
    run_git_command(&canonical_shadow, &["config", "user.name", "Orbit Code"])?;
    run_git_command(&canonical_shadow, &["add", "-A"])?;
    run_git_command(
        &canonical_shadow,
        &["commit", "--allow-empty", "-m", "orbit shadow checkpoint"],
    )?;

    Ok(GitShadowCheckpointResult {
        checkpoint_id,
        shadow_path: canonical_shadow.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn restore_workspace_git_shadow_checkpoint(
    workspace_path: String,
    shadow_path: String,
    files: Vec<FileSnapshot>,
) -> Result<(), String> {
    let shadow_root = orbit_git_shadow_root()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let canonical_shadow = PathBuf::from(shadow_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !canonical_shadow.starts_with(&shadow_root) {
        return Err("Access Denied: git shadow path escapes shadow root".to_string());
    }

    let mut restored = Vec::new();
    for file in files {
        validate_relative_patch_path(&file.path)?;
        if file.existed {
            let shadow_file = canonical_shadow.join(&file.path);
            let canonical_shadow_file = shadow_file.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_shadow_file.starts_with(&canonical_shadow) {
                return Err(format!(
                    "Access Denied: git shadow file escapes checkpoint for {}",
                    file.path
                ));
            }
            let content = fs::read_to_string(&canonical_shadow_file).map_err(|e| e.to_string())?;
            restored.push(FileSnapshot {
                path: file.path,
                content,
                existed: true,
            });
        } else {
            restored.push(FileSnapshot {
                path: file.path,
                content: String::new(),
                existed: false,
            });
        }
    }

    restore_workspace_file_snapshot(workspace_path, restored)
}

/* ==========================================================================
Symbol Index & Code Graph
========================================================================== */

#[derive(serde::Serialize, Clone, Debug)]
pub struct SymbolInfo {
    pub name: String,
    pub kind: String,
    pub file_path: String,
    pub line_number: usize,
}

#[tauri::command]
pub fn build_workspace_symbol_index() -> Result<Vec<SymbolInfo>, String> {
    let current_dir = get_active_workspace_root()?;
    let mut files = Vec::new();
    walk_dir(&current_dir, &current_dir, &mut files).map_err(|e| e.to_string())?;

    let mut symbols = Vec::new();

    for file in files {
        let full_path = current_dir.join(&file);
        if let Ok(content) = fs::read_to_string(&full_path) {
            if let Some(graph) = crate::ast_parser::parse_with_ts(&file, &content) {
                for node in &graph.nodes {
                    symbols.push(SymbolInfo {
                        name: node.name.clone(),
                        kind: node.kind.clone(),
                        file_path: file.clone(),
                        line_number: node.line,
                    });
                }
            }
        }
    }

    Ok(symbols)
}

#[tauri::command]
pub fn build_code_graph(workspace_path: String) -> Result<code_graph::CodeGraph, String> {
    let dir = if workspace_path.is_empty() {
        get_active_workspace_root()?
    } else {
        PathBuf::from(workspace_path)
    };
    let graph = code_graph::build_code_graph_from_dir(&dir, std::time::Duration::from_secs(10));
    Ok(graph)
}

/* ==========================================================================
Embeddings
========================================================================== */

#[tauri::command]
pub async fn build_embeddings(app: AppHandle) -> Result<embedding::BuildStats, String> {
    let conn = db::get_connection(&app)?;
    let current_dir = get_active_workspace_root()?;
    let api_key =
        get_provider_credential("openai")?.ok_or("OpenAI API Key not configured for embeddings")?;

    embedding::build_all_embeddings(&conn, &current_dir, &api_key)
}

#[tauri::command]
pub async fn semantic_search_cmd(
    app: AppHandle,
    query: String,
    top_k: usize,
) -> Result<Vec<embedding::SearchResult>, String> {
    let conn = db::get_connection(&app)?;
    let api_key = get_provider_credential("openai")?.ok_or("OpenAI API Key not configured")?;

    let embedding_vec =
        embedding::compute_embedding(&query, &api_key, "text-embedding-3-small", None).await?;
    embedding::search_similar(&conn, &embedding_vec, top_k.max(1).min(50))
}

/* ==========================================================================
Merge & Conflict Resolution
========================================================================== */

#[derive(serde::Serialize, Clone, Debug)]
pub struct MergeResult {
    pub success: bool,
    pub merged_content: String,
    pub has_conflict: bool,
}

#[tauri::command]
pub fn resolve_patch_conflict(
    path: String,
    old_content: String,
    new_content: String,
    workspace_path: Option<String>,
) -> Result<MergeResult, String> {
    let current_dir = resolve_workspace_root(workspace_path)?;
    let target_path = current_dir.join(&path);

    let canonical_dir = current_dir.canonicalize().map_err(|e| e.to_string())?;

    if target_path.exists() {
        let canonical_target = target_path.canonicalize().map_err(|e| e.to_string())?;
        if !canonical_target.starts_with(&canonical_dir) {
            return Err("Access Denied: Path traversal detected".to_string());
        }
    }

    let disk_content = if target_path.exists() {
        fs::read_to_string(&target_path).map_err(|e| e.to_string())?
    } else {
        "".to_string()
    };

    if disk_content == old_content {
        return Ok(MergeResult {
            success: true,
            merged_content: new_content,
            has_conflict: false,
        });
    }

    let merge_res = diffy::MergeOptions::new().merge(&old_content, &new_content, &disk_content);
    match merge_res {
        Ok(merged) => Ok(MergeResult {
            success: true,
            merged_content: merged,
            has_conflict: false,
        }),
        Err(conflict) => Ok(MergeResult {
            success: false,
            merged_content: conflict,
            has_conflict: true,
        }),
    }
}

/* ==========================================================================
LLM API
========================================================================== */

#[tauri::command]
pub async fn call_llm_api(
    provider: String,
    api_url: String,
    payload: serde_json::Value,
) -> Result<String, String> {
    let api_key = get_provider_credential(&provider)?.ok_or_else(|| {
        format!(
            "API Key for {} is not unlocked in Orbit credential vault",
            provider
        )
    })?;

    let final_url = if provider == "google" && !api_url.contains("key=") {
        let separator = if api_url.contains('?') { "&" } else { "?" };
        format!("{}{}key={}", api_url, separator, api_key)
    } else {
        api_url
    };

    ensure_provider_host(&provider, &final_url)?;

    let client = reqwest::Client::new();
    let mut req = client
        .post(&final_url)
        .header("Content-Type", "application/json");

    if provider == "anthropic" {
        req = req
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01");
    } else if provider != "google" {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let res = req
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(text)
}

fn provider_allowed_hosts(provider: &str) -> Result<Vec<&'static str>, String> {
    match provider {
        "openai" => Ok(vec!["api.openai.com"]),
        "anthropic" => Ok(vec!["api.anthropic.com"]),
        "google" => Ok(vec!["generativelanguage.googleapis.com"]),
        "deepseek" => Ok(vec!["api.deepseek.com"]),
        "openrouter" => Ok(vec!["openrouter.ai"]),
        "xai" => Ok(vec!["api.x.ai"]),
        "mistral" => Ok(vec!["api.mistral.ai"]),
        "groq" => Ok(vec!["api.groq.com"]),
        "qwen" => Ok(vec!["dashscope.aliyuncs.com"]),
        "kimi" => Ok(vec!["api.moonshot.cn"]),
        "siliconflow" => Ok(vec!["api.siliconflow.cn"]),
        "zhipu" => Ok(vec!["open.bigmodel.cn"]),
        "ollama" => Ok(vec!["127.0.0.1", "localhost"]),
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

fn ensure_provider_host(provider: &str, url: &str) -> Result<(), String> {
    let parsed_url = reqwest::Url::parse(url).map_err(|e| format!("Invalid API URL: {}", e))?;
    let host = parsed_url.host_str().unwrap_or("");
    let allowed_hosts = provider_allowed_hosts(provider)?;
    if !allowed_hosts
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{}", h)))
    {
        return Err(format!(
            "URL host '{}' not allowed for provider '{}'. Allowed: {:?}",
            host, provider, allowed_hosts
        ));
    }
    Ok(())
}

fn model_list_url(
    provider: &str,
    base_url: Option<String>,
    api_key: Option<&str>,
) -> Result<String, String> {
    let clean_base = base_url
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim_end_matches('/').to_string());

    let url = match provider {
        "openai" | "openrouter" | "xai" | "mistral" | "groq" | "qwen" | "kimi" | "siliconflow"
        | "zhipu" => clean_base
            .map(|base| {
                if base.ends_with("/models") {
                    base
                } else {
                    format!("{}/models", base)
                }
            })
            .unwrap_or_else(|| match provider {
                "openrouter" => "https://openrouter.ai/api/v1/models".to_string(),
                "xai" => "https://api.x.ai/v1/models".to_string(),
                "mistral" => "https://api.mistral.ai/v1/models".to_string(),
                "groq" => "https://api.groq.com/openai/v1/models".to_string(),
                "qwen" => "https://dashscope.aliyuncs.com/compatible-mode/v1/models".to_string(),
                "kimi" => "https://api.moonshot.cn/v1/models".to_string(),
                "siliconflow" => "https://api.siliconflow.cn/v1/models".to_string(),
                "zhipu" => "https://open.bigmodel.cn/api/paas/v4/models".to_string(),
                _ => "https://api.openai.com/v1/models".to_string(),
            }),
        "anthropic" => clean_base
            .map(|base| {
                if base.ends_with("/models") {
                    base
                } else {
                    format!("{}/models", base)
                }
            })
            .unwrap_or_else(|| "https://api.anthropic.com/v1/models".to_string()),
        "google" => {
            let base = clean_base.unwrap_or_else(|| {
                "https://generativelanguage.googleapis.com/v1beta/models".to_string()
            });
            let separator = if base.contains('?') { "&" } else { "?" };
            let key = api_key.ok_or_else(|| "Gemini API key not configured".to_string())?;
            if base.contains("key=") {
                base
            } else {
                format!("{}{}key={}", base, separator, key)
            }
        }
        "deepseek" => clean_base
            .map(|base| {
                if base.ends_with("/models") {
                    base
                } else {
                    format!("{}/models", base)
                }
            })
            .unwrap_or_else(|| "https://api.deepseek.com/models".to_string()),
        "ollama" => clean_base
            .map(|base| {
                if base.ends_with("/api/tags") {
                    base
                } else {
                    format!("{}/api/tags", base)
                }
            })
            .unwrap_or_else(|| "http://127.0.0.1:11434/api/tags".to_string()),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    ensure_provider_host(provider, &url)?;
    Ok(url)
}

fn extract_model_ids(provider: &str, body: &str) -> Vec<String> {
    let parsed: serde_json::Value = match serde_json::from_str(body) {
        Ok(value) => value,
        Err(_) => return vec![],
    };

    let raw_models = match provider {
        "google" => parsed
            .get("models")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default(),
        "ollama" => parsed
            .get("models")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default(),
        _ => parsed
            .get("data")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default(),
    };

    let mut models = Vec::new();
    for item in raw_models {
        let supports_generation = item
            .get("supportedGenerationMethods")
            .and_then(|value| value.as_array())
            .map(|methods| {
                methods
                    .iter()
                    .any(|method| method.as_str() == Some("generateContent"))
            })
            .unwrap_or(true);
        if provider == "google" && !supports_generation {
            continue;
        }

        let id = item
            .get("id")
            .or_else(|| item.get("name"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .trim_start_matches("models/")
            .to_string();
        if !id.is_empty() && !models.contains(&id) {
            models.push(id);
        }
    }
    models
}

#[tauri::command]
pub async fn list_llm_models(
    provider: String,
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let api_key = if provider == "ollama" {
        None
    } else {
        Some(get_provider_credential(&provider)?.ok_or_else(|| {
            format!(
                "API Key for {} is not unlocked in Orbit credential vault",
                provider
            )
        })?)
    };

    let url = model_list_url(&provider, base_url, api_key.as_deref())?;
    let client = reqwest::Client::new();
    let mut req = client.get(&url).header("Content-Type", "application/json");

    if provider == "anthropic" {
        if let Some(key) = api_key.as_deref() {
            req = req
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01");
        }
    } else if provider != "google" && provider != "ollama" {
        if let Some(key) = api_key.as_deref() {
            req = req.header("Authorization", format!("Bearer {}", key));
        }
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Model list request failed: {}", e))?;
    let status = res.status();
    let text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read model list response body: {}", e))?;
    if !status.is_success() {
        return Err(format!("Model list request returned {}: {}", status, text));
    }

    let models = extract_model_ids(&provider, &text);
    if models.is_empty() {
        return Err("Provider returned no usable models".to_string());
    }
    Ok(models)
}

#[tauri::command]
pub async fn call_llm_api_streaming(
    app: AppHandle,
    stream_id: String,
    provider: String,
    api_url: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let api_key = get_provider_credential(&provider)?.ok_or_else(|| {
        format!(
            "API Key for {} is not unlocked in Orbit credential vault",
            provider
        )
    })?;

    let final_url = if provider == "google" && !api_url.contains("key=") {
        let separator = if api_url.contains('?') { "&" } else { "?" };
        format!("{}{}key={}", api_url, separator, api_key)
    } else {
        api_url
    };

    ensure_provider_host(&provider, &final_url)?;

    let mut payload_with_stream = payload.clone();
    if let Some(obj) = payload_with_stream.as_object_mut() {
        obj.insert("stream".to_string(), serde_json::Value::Bool(true));
    }

    let client = reqwest::Client::new();
    let mut req = client
        .post(&final_url)
        .header("Content-Type", "application/json");

    if provider == "anthropic" {
        req = req
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01");
    } else if provider != "google" {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }

    let mut res = req
        .json(&payload_with_stream)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let app_clone = app.clone();
    let sid = stream_id.clone();

    let _ = app.emit(
        "llm-stream-start",
        serde_json::json!({
            "streamId": sid,
            "status": "started"
        }),
    );

    tauri::async_runtime::spawn(async move {
        let mut buffer = String::new();

        loop {
            match res.chunk().await {
                Ok(Some(bytes)) => {
                    let text = String::from_utf8_lossy(&bytes);
                    buffer.push_str(&text);

                    while let Some(pos) = buffer.find("\n\n") {
                        let line = buffer[..pos].to_string();
                        buffer.drain(..=pos + 1);

                        for data_line in line.lines() {
                            let data_line = data_line.trim();
                            if data_line == "data: [DONE]" {
                                continue;
                            }
                            if let Some(json_str) = data_line.strip_prefix("data: ") {
                                let trimmed = json_str.trim();
                                if !trimmed.is_empty() {
                                    if let Ok(parsed) =
                                        serde_json::from_str::<serde_json::Value>(trimmed)
                                    {
                                        let content = parsed["choices"][0]["delta"]["content"]
                                            .as_str()
                                            .or_else(|| parsed["choices"][0]["text"].as_str())
                                            .or_else(|| parsed["content_block"]["text"].as_str())
                                            .or_else(|| parsed["delta"]["text"].as_str())
                                            .or_else(|| {
                                                parsed["candidates"][0]["content"]["parts"][0]
                                                    ["text"]
                                                    .as_str()
                                            })
                                            .unwrap_or("");

                                        if !content.is_empty() {
                                            let _ = app_clone.emit(
                                                "llm-stream-chunk",
                                                serde_json::json!({
                                                    "streamId": sid,
                                                    "content": content
                                                }),
                                            );
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = app_clone.emit(
                        "llm-stream-error",
                        serde_json::json!({
                            "streamId": sid,
                            "error": format!("Stream error: {}", e)
                        }),
                    );
                    return;
                }
            }
        }

        let _ = app_clone.emit(
            "llm-stream-end",
            serde_json::json!({
                "streamId": sid,
                "status": "completed"
            }),
        );
    });

    Ok(())
}

#[cfg(test)]
mod provider_tests {
    use super::*;

    #[test]
    fn tauri_dev_defaults_to_frontend_project_root() {
        let temp = std::env::temp_dir().join(format!("orbit-root-test-{}", uuid::Uuid::new_v4()));
        let src_tauri = temp.join("src-tauri");
        std::fs::create_dir_all(&src_tauri).unwrap();
        std::fs::write(temp.join("package.json"), "{}").unwrap();

        assert_eq!(default_workspace_root(src_tauri), temp);
    }

    #[test]
    fn non_tauri_dirs_stay_as_workspace_root() {
        let temp = std::env::temp_dir().join(format!("orbit-root-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp).unwrap();

        assert_eq!(default_workspace_root(temp.clone()), temp);
    }

    #[test]
    fn credential_vault_encrypts_and_rejects_wrong_passphrase() {
        let envelope = encrypt_secret("deepseek", "sk-test", "correct horse").unwrap();
        assert_ne!(envelope.ciphertext, "sk-test");
        assert_eq!(
            decrypt_secret(&envelope, "correct horse").unwrap(),
            "sk-test"
        );
        assert!(decrypt_secret(&envelope, "wrong horse").is_err());
    }

    #[test]
    fn allows_new_provider_hosts() {
        assert!(provider_allowed_hosts("openrouter")
            .unwrap()
            .contains(&"openrouter.ai"));
        assert!(provider_allowed_hosts("siliconflow")
            .unwrap()
            .contains(&"api.siliconflow.cn"));
        assert!(provider_allowed_hosts("qwen")
            .unwrap()
            .contains(&"dashscope.aliyuncs.com"));
    }

    #[test]
    fn builds_model_list_urls_for_new_providers() {
        assert_eq!(
            model_list_url("kimi", None, Some("key")).unwrap(),
            "https://api.moonshot.cn/v1/models"
        );
        assert_eq!(
            model_list_url("groq", None, Some("key")).unwrap(),
            "https://api.groq.com/openai/v1/models"
        );
    }

    #[test]
    fn parses_openai_compatible_model_lists() {
        let body = r#"{"data":[{"id":"deepseek-ai/DeepSeek-V3.2"},{"id":"Qwen/Qwen3-Coder"}]}"#;
        assert_eq!(
            extract_model_ids("siliconflow", body),
            vec!["deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-Coder"]
        );
    }
}
