//! # Database Schema — Orbit Code v1.0.0
//!
//! SQLite database (`orbit_code.db`) with WAL journal mode and foreign keys enabled.
//! All tables are created via `init_schema()` on first connection.
//!
//! ## Table: kv_store (Legacy KV Store)
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | key | TEXT PK | Storage key |
//! | value | TEXT | JSON-encoded value |
//!
//! ## Table: projects
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | name | TEXT NOT NULL | Project name |
//! | workspace_path | TEXT NOT NULL | Filesystem path |
//! | created_at | TEXT | ISO 8601 |
//! | updated_at | TEXT | ISO 8601 |
//!
//! ## Table: threads
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | project_id | TEXT FK→projects.id | Parent project |
//! | title | TEXT | Thread title (usually task title) |
//! | status | TEXT | active/archived |
//! | created_at | TEXT | ISO 8601 |
//! | updated_at | TEXT | ISO 8601 |
//!
//! ## Table: messages
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | thread_id | TEXT FK→threads.id | Parent thread |
//! | role | TEXT NOT NULL | user/assistant/system/agent |
//! | agent_role | TEXT | planner/coder/reviewer/verifier |
//! | content | TEXT NOT NULL | Message body (JSON for agent iterations) |
//! | metadata | TEXT | JSON: tokens, iteration info |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: artifacts
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | thread_id | TEXT FK→threads.id | Parent thread |
//! | message_id | TEXT FK→messages.id | Source message |
//! | kind | TEXT NOT NULL | patch/terminal_output/diff/file_preview |
//! | path | TEXT | File path |
//! | content | TEXT | Artifact content |
//! | metadata | TEXT | JSON |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: plans
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | thread_id | TEXT FK→threads.id | Parent thread |
//! | title | TEXT NOT NULL | Plan title |
//! | goals | TEXT | JSON array |
//! | constraints | TEXT | JSON array |
//! | acceptance_criteria | TEXT | JSON array |
//! | risks | TEXT | JSON array |
//! | references_json | TEXT | JSON array of file paths |
//! | raw_yaml | TEXT | Original YAML source |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: plan_tasks
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | Task UUID |
//! | plan_id | TEXT FK→plans.id | Parent plan |
//! | title | TEXT NOT NULL | Task title |
//! | description | TEXT | Task description |
//! | status | TEXT | queued/running/blocked/review/verified/done |
//! | depends_on | TEXT | JSON array of task IDs |
//! | agent_hint | TEXT | planner/coder/reviewer/verifier |
//! | files_hint | TEXT | JSON array of file paths |
//! | verification | TEXT | JSON array of commands |
//! | sort_order | INTEGER | Display order |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: runtime_events
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | thread_id | TEXT FK→threads.id | Parent thread |
//! | task_id | TEXT | Related task UUID |
//! | kind | TEXT NOT NULL | message/tool_call/permission/patch/test |
//! | title | TEXT | Event title |
//! | summary | TEXT | Event summary |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: permission_requests
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | thread_id | TEXT FK→threads.id | Parent thread |
//! | command | TEXT NOT NULL | Shell command |
//! | cwd | TEXT | Working directory |
//! | reason | TEXT | Why this command is needed |
//! | levels | TEXT | JSON array of permission levels |
//! | default_mode | TEXT | ask/allow_once/deny |
//! | status | TEXT | pending/approved/denied |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: provider_configs
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | provider | TEXT UNIQUE | openai/anthropic/google/deepseek |
//! | label | TEXT | Display label |
//! | api_key_provider_id | TEXT NOT NULL | Credential vault provider ID |
//! | base_url | TEXT | Custom API endpoint |
//! | default_model | TEXT | Default model name |
//! | capabilities | TEXT | JSON capability flags |
//! | config_json | TEXT | Extra config |
//! | created_at | TEXT | ISO 8601 |
//! | updated_at | TEXT | ISO 8601 |
//!
//! ## Table: code_chunks (v0.6.0 — Vector RAG)
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | file_path | TEXT NOT NULL | Relative file path |
//! | start_line | INTEGER NOT NULL | Chunk start line |
//! | end_line | INTEGER NOT NULL | Chunk end line |
//! | content | TEXT NOT NULL | Source code |
//! | content_hash | TEXT NOT NULL | SHA-256 for incremental update |
//! | symbol_kind | TEXT | class/function/interface (from code_graph) |
//! | symbol_name | TEXT | Symbol name |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Table: code_embeddings (v0.6.0 — Vector RAG)
//! | Column | Type | Description |
//! |--------|------|-------------|
//! | id | TEXT PK | UUID |
//! | chunk_id | TEXT FK→code_chunks.id | Parent chunk |
//! | model | TEXT NOT NULL | text-embedding-3-small |
//! | dimensions | INTEGER NOT NULL | 1536 |
//! | embedding_blob | BLOB NOT NULL | float32[1536] (6144 bytes) |
//! | created_at | TEXT | ISO 8601 |
//!
//! ## Indexes
//! - `idx_chunks_file` ON code_chunks(file_path)
//! - `idx_embeddings_chunk` ON code_embeddings(chunk_id)
//!
//! ## CRUD Commands (18 total)
//! | Command | Table | Operation |
//! |---------|-------|-----------|
//! | `db_get` | kv_store | Read key |
//! | `db_set` | kv_store | Upsert key |
//! | `db_delete` | kv_store | Delete key |
//! | `db_query` | any | Read-only parameterized query |
//! | `create_project` | projects | Insert |
//! | `list_projects` | projects | Select all |
//! | `create_thread` | threads | Insert |
//! | `list_threads` | threads | Select by project_id |
//! | `update_thread` | threads | Update title/status |
//! | `create_message` | messages | Insert |
//! | `list_messages` | messages | Select by thread_id |
//! | `save_plan` | plans | Upsert |
//! | `load_plan` | plans | Select latest by thread_id |
//! | `save_plan_tasks` | plan_tasks | Replace all for plan_id |
//! | `load_plan_tasks` | plan_tasks | Select by plan_id |
//! | `save_provider_config` | provider_configs | Upsert by provider |
//! | `load_provider_config` | provider_configs | Select by provider |
//! | `list_provider_configs` | provider_configs | Select all |
//! | `delete_provider_config` | provider_configs | Delete by provider |
//! | `save_session_state` | kv_store | Upsert (session key) |
//! | `load_session_state` | kv_store | Read (session key) |

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/* ==========================================================================
数据库持久化模块 (SQLite Multi-Table Schema v2)
========================================================================== */

pub fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(raw) = std::env::var("ORBIT_APP_DATA_DIR") {
        let path = normalize_app_data_override(&raw)?;
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        return Ok(path);
    }

    let path = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let path = get_app_data_dir(app)?;
    let target = path.join("orbit_code.db");
    migrate_legacy_db_if_needed(&target, &path)?;
    Ok(target)
}

fn normalize_app_data_override(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("ORBIT_APP_DATA_DIR cannot be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path))
    }
}

fn legacy_db_candidates(current_app_data_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![current_app_data_dir.join("agent_gui.db")];
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates
            .push(home.join("Library/Application Support/com.zhoujunjie.agentgui/agent_gui.db"));
        candidates.push(home.join("Library/Application Support/Agent GUI/agent_gui.db"));
        candidates.push(home.join("Library/Application Support/agent-gui/agent_gui.db"));
    }
    candidates
}

fn migrate_legacy_db_if_needed(target: &Path, current_app_data_dir: &Path) -> Result<(), String> {
    if target.exists() {
        return Ok(());
    }
    if let Some(source) = legacy_db_candidates(current_app_data_dir)
        .into_iter()
        .find(|candidate| candidate.exists() && candidate != target)
    {
        std::fs::copy(&source, target)
            .map(|_| ())
            .map_err(|e| format!("Failed to migrate legacy database from {:?}: {}", source, e))?;
    }
    Ok(())
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT OR IGNORE INTO schema_version (version) VALUES (1);

        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES projects(id),
            title TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(id),
            role TEXT NOT NULL,
            agent_role TEXT,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(id),
            message_id TEXT REFERENCES messages(id),
            kind TEXT NOT NULL,
            path TEXT,
            content TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS plans (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(id),
            title TEXT NOT NULL,
            goals TEXT,
            constraints TEXT,
            acceptance_criteria TEXT,
            risks TEXT,
            references_json TEXT,
            raw_yaml TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS plan_tasks (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL REFERENCES plans(id),
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'queued',
            depends_on TEXT,
            agent_hint TEXT,
            files_hint TEXT,
            verification TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS runtime_events (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(id),
            task_id TEXT,
            kind TEXT NOT NULL,
            title TEXT,
            summary TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS permission_requests (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES threads(id),
            command TEXT NOT NULL,
            cwd TEXT,
            reason TEXT,
            levels TEXT,
            default_mode TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS provider_configs (
            id TEXT PRIMARY KEY,
            provider TEXT NOT NULL UNIQUE,
            label TEXT,
            api_key_provider_id TEXT NOT NULL,
            base_url TEXT,
            default_model TEXT,
            capabilities TEXT,
            config_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS code_chunks (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            content TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            symbol_kind TEXT,
            symbol_name TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS code_embeddings (
            id TEXT PRIMARY KEY,
            chunk_id TEXT NOT NULL REFERENCES code_chunks(id),
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding_blob BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_chunks_file ON code_chunks(file_path);
        CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON code_embeddings(chunk_id);",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_connection(app: &AppHandle) -> Result<Connection, String> {
    let path = get_db_path(app)?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    Ok(conn)
}

// ---- 向后兼容的 KV Store 命令 ----

#[tauri::command]
pub fn db_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn
        .prepare("SELECT value FROM kv_store WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([key]).map_err(|e| e.to_string())?;
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let value: String = row.get(0).map_err(|e| e.to_string())?;
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn db_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT INTO kv_store (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=?2",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_delete(app: AppHandle, key: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute("DELETE FROM kv_store WHERE key = ?1", [key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Projects CRUD ----

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    id: String,
    name: String,
    workspace_path: String,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT OR REPLACE INTO projects (id, name, workspace_path, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
        [&id, &name, &workspace_path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_projects(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare("SELECT id, name, workspace_path, created_at, updated_at FROM projects ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "workspace_path": row.get::<_, String>(2)?,
                "created_at": row.get::<_, String>(3)?,
                "updated_at": row.get::<_, String>(4)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

// ---- Threads CRUD ----

#[tauri::command]
pub fn create_thread(
    app: AppHandle,
    id: String,
    project_id: String,
    title: String,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT INTO threads (id, project_id, title, status, updated_at) VALUES (?1, ?2, ?3, 'active', datetime('now'))",
        [&id, &project_id, &title],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_threads(app: AppHandle, project_id: String) -> Result<Vec<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, project_id, title, status, created_at, updated_at FROM threads WHERE project_id = ?1 ORDER BY updated_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&project_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "project_id": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "created_at": row.get::<_, String>(4)?,
                "updated_at": row.get::<_, String>(5)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
pub fn update_thread(
    app: AppHandle,
    id: String,
    title: String,
    status: String,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE threads SET title = ?2, status = ?3, updated_at = datetime('now') WHERE id = ?1",
        [&id, &title, &status],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Messages CRUD ----

#[tauri::command]
pub fn create_message(
    app: AppHandle,
    id: String,
    thread_id: String,
    role: String,
    content: String,
    agent_role: String,
    metadata: String,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT INTO messages (id, thread_id, role, content, agent_role, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        [&id, &thread_id, &role, &content, &agent_role, &metadata],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_messages(app: AppHandle, thread_id: String) -> Result<Vec<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, agent_role, content, metadata, created_at FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&thread_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "thread_id": row.get::<_, String>(1)?,
                "role": row.get::<_, String>(2)?,
                "agent_role": row.get::<_, Option<String>>(3)?,
                "content": row.get::<_, String>(4)?,
                "metadata": row.get::<_, Option<String>>(5)?,
                "created_at": row.get::<_, String>(6)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

// ---- Plans CRUD ----

#[tauri::command]
pub fn save_plan(
    app: AppHandle,
    id: String,
    thread_id: String,
    title: String,
    goals: String,
    constraints: String,
    acceptance_criteria: String,
    risks: String,
    references_json: String,
    raw_yaml: String,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT OR REPLACE INTO plans (id, thread_id, title, goals, constraints, acceptance_criteria, risks, references_json, raw_yaml, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))",
        [&id, &thread_id, &title, &goals, &constraints, &acceptance_criteria, &risks, &references_json, &raw_yaml],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_plan(app: AppHandle, thread_id: String) -> Result<Option<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, title, goals, constraints, acceptance_criteria, risks, references_json, raw_yaml, created_at FROM plans WHERE thread_id = ?1 ORDER BY created_at DESC LIMIT 1"
    ).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([&thread_id], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "thread_id": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
                "goals": row.get::<_, String>(3)?,
                "constraints": row.get::<_, String>(4)?,
                "acceptance_criteria": row.get::<_, String>(5)?,
                "risks": row.get::<_, String>(6)?,
                "references_json": row.get::<_, String>(7)?,
                "raw_yaml": row.get::<_, String>(8)?,
                "created_at": row.get::<_, String>(9)?
            }))
        })
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next() {
        Ok(Some(row.map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

// ---- Plan Tasks CRUD ----

#[tauri::command]
pub fn save_plan_tasks(app: AppHandle, plan_id: String, tasks_json: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    let tasks: Vec<serde_json::Value> =
        serde_json::from_str(&tasks_json).map_err(|e| e.to_string())?;
    conn.execute("BEGIN IMMEDIATE", [])
        .map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        conn.execute("DELETE FROM plan_tasks WHERE plan_id = ?1", [&plan_id])
            .map_err(|e| e.to_string())?;
        for (idx, task) in tasks.iter().enumerate() {
            let id = task["id"].as_str().unwrap_or("");
            let title = task["title"].as_str().unwrap_or("");
            let description = task["description"].as_str().unwrap_or("");
            let status = task["status"].as_str().unwrap_or("queued");
            let depends_on = task["dependsOn"].to_string();
            let agent_hint = task["agentHint"].as_str().unwrap_or("");
            let files_hint = task["filesHint"].to_string();
            let verification = task["verification"].to_string();
            conn.execute(
                "INSERT OR REPLACE INTO plan_tasks (id, plan_id, title, description, status, depends_on, agent_hint, files_hint, verification, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                rusqlite::params![id, &plan_id, title, description, status, &depends_on, agent_hint, &files_hint, &verification, idx as i64],
            ).map_err(|e| e.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = conn.execute("ROLLBACK", []);
        return result;
    }
    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_plan_tasks(app: AppHandle, plan_id: String) -> Result<Vec<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, description, status, depends_on, agent_hint, files_hint, verification, sort_order FROM plan_tasks WHERE plan_id = ?1 ORDER BY sort_order ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([&plan_id], |row| {
            let depends_on_str: String = row.get::<_, String>(4)?;
            let files_hint_str: String = row.get::<_, String>(6)?;
            let verification_str: String = row.get::<_, String>(7)?;
            let depends_on: serde_json::Value =
                serde_json::from_str(&depends_on_str).unwrap_or(serde_json::Value::Array(vec![]));
            let files_hint: serde_json::Value =
                serde_json::from_str(&files_hint_str).unwrap_or(serde_json::Value::Array(vec![]));
            let verification: serde_json::Value =
                serde_json::from_str(&verification_str).unwrap_or(serde_json::Value::Array(vec![]));
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "status": row.get::<_, String>(3)?,
                "dependsOn": depends_on,
                "agentHint": row.get::<_, Option<String>>(5)?,
                "filesHint": files_hint,
                "verification": verification,
                "sortOrder": row.get::<_, i64>(8)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

// ---- Provider Configs CRUD ----

#[tauri::command]
pub fn save_provider_config(
    app: AppHandle,
    id: String,
    provider: String,
    label: String,
    api_key_provider_id: String,
    base_url: String,
    default_model: String,
    capabilities: String,
    config_json: String,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT OR REPLACE INTO provider_configs (id, provider, label, api_key_provider_id, base_url, default_model, capabilities, config_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))",
        [&id, &provider, &label, &api_key_provider_id, &base_url, &default_model, &capabilities, &config_json],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_provider_config(
    app: AppHandle,
    provider: String,
) -> Result<Option<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, provider, label, api_key_provider_id, base_url, default_model, capabilities, config_json FROM provider_configs WHERE provider = ?1"
    ).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map([&provider], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "provider": row.get::<_, String>(1)?,
                "label": row.get::<_, String>(2)?,
                "api_key_provider_id": row.get::<_, String>(3)?,
                "base_url": row.get::<_, Option<String>>(4)?,
                "default_model": row.get::<_, Option<String>>(5)?,
                "capabilities": row.get::<_, Option<String>>(6)?,
                "config_json": row.get::<_, Option<String>>(7)?
            }))
        })
        .map_err(|e| e.to_string())?;
    if let Some(row) = rows.next() {
        Ok(Some(row.map_err(|e| e.to_string())?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn list_provider_configs(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, provider, label, api_key_provider_id, base_url, default_model, capabilities, config_json FROM provider_configs"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "id": row.get::<_, String>(0)?,
                "provider": row.get::<_, String>(1)?,
                "label": row.get::<_, String>(2)?,
                "api_key_provider_id": row.get::<_, String>(3)?,
                "base_url": row.get::<_, Option<String>>(4)?,
                "default_model": row.get::<_, Option<String>>(5)?,
                "capabilities": row.get::<_, Option<String>>(6)?,
                "config_json": row.get::<_, Option<String>>(7)?
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

#[tauri::command]
pub fn delete_provider_config(app: AppHandle, provider: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "DELETE FROM provider_configs WHERE provider = ?1",
        [&provider],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Session persistence (save/restore) ----

#[tauri::command]
pub fn save_session_state(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "INSERT INTO kv_store (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        [&key, &value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_session_state(app: AppHandle, key: String) -> Result<Option<String>, String> {
    db_get(app, key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_candidates_include_current_and_old_app_data_locations() {
        let candidates = legacy_db_candidates(Path::new("/tmp/orbit-code-test"));

        assert!(candidates.iter().any(|path| path.ends_with("agent_gui.db")));
        assert!(candidates
            .iter()
            .any(|path| path.to_string_lossy().contains("com.zhoujunjie.agentgui")));
    }

    #[test]
    fn migrates_current_legacy_database_to_orbit_database() {
        let root =
            std::env::temp_dir().join(format!("orbit-code-db-migration-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let legacy = root.join("agent_gui.db");
        let target = root.join("orbit_code.db");
        std::fs::write(&legacy, b"legacy-db").unwrap();

        migrate_legacy_db_if_needed(&target, &root).unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"legacy-db");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn app_data_override_normalizes_relative_paths_and_rejects_empty_values() {
        assert!(normalize_app_data_override("  ").is_err());

        let relative = normalize_app_data_override("target/orbit-live-app-data").unwrap();
        assert!(relative.is_absolute());
        assert!(relative.ends_with("target/orbit-live-app-data"));

        let absolute = std::env::temp_dir().join("orbit-live-app-data");
        assert_eq!(
            normalize_app_data_override(&absolute.to_string_lossy()).unwrap(),
            absolute
        );
    }
}
