pub mod ast_parser;
pub mod code_graph;
mod commands;
mod db;
pub mod embedding;
mod process_monitor;
mod window_manager;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = std::panic::set_hook(Box::new(|panic_info| {
        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Unknown panic".to_string()
        };
        let location = panic_info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_default();
        if let Ok(mut log_path) = std::env::current_dir() {
            log_path.push("agent_gui_crash.log");
            let entry = format!("[PANIC {}] {}\n", location, payload);
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .map(|mut f| {
                    let _ = std::io::Write::write_all(&mut f, entry.as_bytes());
                });
        }
        eprintln!("CRASH: {} - {}", location, payload);
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window_manager::apply_native_vibrancy(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            window_manager::create_project_window,
            window_manager::list_open_windows,
            window_manager::close_project_window,
            commands::greet,
            db::db_get,
            db::db_set,
            db::db_delete,
            db::create_project,
            db::list_projects,
            db::create_thread,
            db::list_threads,
            db::update_thread,
            db::create_message,
            db::list_messages,
            db::save_plan,
            db::load_plan,
            db::save_plan_tasks,
            db::load_plan_tasks,
            db::save_provider_config,
            db::load_provider_config,
            db::list_provider_configs,
            db::delete_provider_config,
            db::save_session_state,
            db::load_session_state,
            commands::store_vault_credential,
            commands::unlock_credential_vault,
            commands::list_vault_credential_providers,
            commands::delete_vault_credential,
            commands::get_workspace_root,
            commands::set_workspace_root,
            commands::list_workspace_files,
            commands::read_workspace_file,
            commands::run_command_async,
            commands::run_command_sync,
            commands::preview_workspace_patches_in_sandbox,
            commands::apply_workspace_patches_transactional,
            commands::call_llm_api,
            commands::call_llm_api_streaming,
            commands::list_llm_models,
            commands::build_workspace_symbol_index,
            commands::build_code_graph,
            commands::build_embeddings,
            commands::semantic_search_cmd,
            commands::resolve_patch_conflict
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::commands::*;
    use std::fs;

    #[test]
    fn test_apply_workspace_patch_path_traversal() {
        let test_file = "src-tauri/test_temp.txt";
        let res = apply_workspace_patch(test_file.to_string(), "hello world".to_string());
        assert!(res.is_ok());

        let read_res = fs::read_to_string(test_file);
        assert_eq!(read_res.unwrap(), "hello world");

        let _ = fs::remove_file(test_file);

        let traversal_file = "../illegal_outside.txt";
        let res_traversal = apply_workspace_patch(traversal_file.to_string(), "hacked".to_string());

        assert!(res_traversal.is_err());
        let err_msg = res_traversal.unwrap_err();
        assert!(err_msg.contains("Access Denied"));
    }

    #[test]
    fn test_apply_workspace_patches_transactional() {
        let file1 = "src-tauri/test_tx_1.txt";
        let file2 = "src-tauri/test_tx_2.txt";

        let patches = vec![
            FilePatch {
                path: file1.to_string(),
                old_content: "".to_string(),
                new_content: "content 1".to_string(),
            },
            FilePatch {
                path: file2.to_string(),
                old_content: "".to_string(),
                new_content: "content 2".to_string(),
            },
        ];

        let res = apply_workspace_patches_transactional("".to_string(), patches);
        assert!(res.is_ok());
        assert_eq!(fs::read_to_string(file1).unwrap(), "content 1");
        assert_eq!(fs::read_to_string(file2).unwrap(), "content 2");

        let patches_fail = vec![
            FilePatch {
                path: file1.to_string(),
                old_content: "content 1".to_string(),
                new_content: "modified content 1".to_string(),
            },
            FilePatch {
                path: "../illegal_outside_tx.txt".to_string(),
                old_content: "".to_string(),
                new_content: "hacked".to_string(),
            },
        ];

        let res_fail = apply_workspace_patches_transactional("".to_string(), patches_fail);
        assert!(res_fail.is_err());

        assert_eq!(fs::read_to_string(file1).unwrap(), "content 1");

        let _ = fs::remove_file(file1);
        let _ = fs::remove_file(file2);
    }

    #[test]
    fn test_apply_workspace_patches_transactional_rejects_stale_old_content() {
        let file = "src-tauri/test_stale_write.txt";
        let _ = fs::write(file, "disk content");

        let patches = vec![FilePatch {
            path: file.to_string(),
            old_content: "older content".to_string(),
            new_content: "agent content".to_string(),
        }];

        let res = apply_workspace_patches_transactional("".to_string(), patches);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Stale write detected"));
        assert_eq!(fs::read_to_string(file).unwrap(), "disk content");

        let _ = fs::remove_file(file);
    }

    #[test]
    fn test_preview_workspace_patches_in_sandbox_does_not_write_workspace() {
        let file = "src-tauri/test_sandbox_preview.txt";
        let _ = fs::write(file, "original");
        let root = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        let res = preview_workspace_patches_in_sandbox(
            root,
            "proposal-test".to_string(),
            vec![FilePatch {
                path: file.to_string(),
                old_content: "original".to_string(),
                new_content: "sandboxed".to_string(),
            }],
        );

        assert!(res.is_ok());
        let preview = res.unwrap();
        assert_eq!(preview.status, "sandboxed");
        assert_eq!(fs::read_to_string(file).unwrap(), "original");
        assert_eq!(
            fs::read_to_string(std::path::Path::new(&preview.sandbox_path).join(file)).unwrap(),
            "sandboxed"
        );

        let _ = fs::remove_file(file);
        let _ = fs::remove_dir_all(preview.sandbox_path);
    }

    #[test]
    fn test_preview_workspace_patches_in_sandbox_rejects_stale_content() {
        let file = "src-tauri/test_sandbox_stale.txt";
        let _ = fs::write(file, "disk");
        let root = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();

        let res = preview_workspace_patches_in_sandbox(
            root,
            "proposal-stale".to_string(),
            vec![FilePatch {
                path: file.to_string(),
                old_content: "old".to_string(),
                new_content: "sandboxed".to_string(),
            }],
        );

        assert!(res.is_ok());
        let preview = res.unwrap();
        assert_eq!(preview.status, "failed");
        assert!(preview.output.contains("Stale write detected"));
        assert_eq!(fs::read_to_string(file).unwrap(), "disk");

        let _ = fs::remove_file(file);
        let _ = fs::remove_dir_all(preview.sandbox_path);
    }

    #[test]
    fn test_preview_workspace_patches_in_sandbox_rejects_path_traversal() {
        let root = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let res = preview_workspace_patches_in_sandbox(
            root,
            "proposal-traversal".to_string(),
            vec![FilePatch {
                path: "../outside.txt".to_string(),
                old_content: "".to_string(),
                new_content: "bad".to_string(),
            }],
        );

        assert!(res.is_ok());
        let preview = res.unwrap();
        assert_eq!(preview.status, "failed");
        assert!(preview.output.contains("Access Denied"));

        let _ = fs::remove_dir_all(preview.sandbox_path);
    }

    #[test]
    fn test_build_workspace_symbol_index() {
        let test_file = "src-tauri/test_symbol.ts";
        let content = "
            export interface TestUser { id: string; }
            export class UserService {
                getUser() {}
            }
            function helperFunction() {}
        ";
        let _ = fs::write(test_file, content);

        let res = build_workspace_symbol_index();
        assert!(res.is_ok());
        let symbols = res.unwrap();

        let has_user = symbols
            .iter()
            .any(|s| s.name == "TestUser" && s.kind == "interface");
        let has_service = symbols
            .iter()
            .any(|s| s.name == "UserService" && s.kind == "class");
        let has_helper = symbols
            .iter()
            .any(|s| s.name == "helperFunction" && s.kind == "function");

        assert!(has_user);
        assert!(has_service);
        assert!(has_helper);

        let _ = fs::remove_file(test_file);
    }

    #[test]
    fn test_resolve_patch_conflict_no_conflict() {
        let original = "line1\nline2\nline3\nline4\nline5\nline6\n";
        let modified_ai = "line1\nline2_modified\nline3\nline4\nline5\nline6\n";
        let modified_user = "line1\nline2\nline3\nline4\nline5_modified\nline6\n";

        let file = "src-tauri/test_conflict.txt";
        let _ = fs::write(file, modified_user);

        let res = resolve_patch_conflict(
            file.to_string(),
            original.to_string(),
            modified_ai.to_string(),
            None,
        );
        assert!(res.is_ok());
        let merge_res = res.unwrap();
        assert!(merge_res.success);
        assert!(!merge_res.has_conflict);
        assert!(merge_res.merged_content.contains("line2_modified"));
        assert!(merge_res.merged_content.contains("line5_modified"));

        let _ = fs::remove_file(file);
    }

    #[test]
    fn test_resolve_patch_conflict_with_conflict() {
        let original = "line1\nline2\nline3\n";
        let modified_ai = "line1\nline2_ai\nline3\n";
        let modified_user = "line1\nline2_user\nline3\n";

        let file = "src-tauri/test_conflict_2.txt";
        let _ = fs::write(file, modified_user);

        let res = resolve_patch_conflict(
            file.to_string(),
            original.to_string(),
            modified_ai.to_string(),
            None,
        );
        assert!(res.is_ok());
        let merge_res = res.unwrap();
        assert!(!merge_res.success);
        assert!(merge_res.has_conflict);
        assert!(merge_res.merged_content.contains("<<<<<<<"));
        assert!(merge_res.merged_content.contains("======="));
        assert!(merge_res.merged_content.contains(">>>>>>>"));

        let _ = fs::remove_file(file);
    }

    #[test]
    fn test_run_command_sync_structured_args() {
        let root = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let res = run_command_sync(
            "printf".to_string(),
            vec!["hello structured args".to_string()],
            "restricted".to_string(),
            Some(root),
        );

        assert!(res.is_ok());
        let output = res.unwrap();
        assert!(output.contains("hello structured args"));
        assert!(output.contains("[exit_code: 0]"));
    }
}
