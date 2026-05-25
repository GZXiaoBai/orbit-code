use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn apply_native_vibrancy(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::HudWindow,
            Some(NSVisualEffectState::FollowsWindowActiveState),
            Some(18.0),
        );
    }

    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::apply_blur;
        let _ = apply_blur(window, Some((18, 18, 18, 110)));
    }
}

#[tauri::command]
pub fn create_project_window(
    app: AppHandle,
    project_path: String,
    label: String,
) -> Result<(), String> {
    let window_label = format!("project-{}", label);

    if let Some(window) = app.get_webview_window(&window_label) {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window =
        WebviewWindowBuilder::new(&app, &window_label, WebviewUrl::App("index.html".into()))
            .title(format!("Orbit Code — {}", project_path))
            .inner_size(1440.0, 920.0)
            .min_inner_size(900.0, 600.0)
            .center()
            .transparent(true)
            .visible(true)
            .build()
            .map_err(|e| format!("Failed to create window: {}", e))?;
    apply_native_vibrancy(&window);

    Ok(())
}

#[tauri::command]
pub fn list_open_windows(app: AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|k| k.starts_with("project-"))
        .map(|k| k.to_string())
        .collect()
}

#[tauri::command]
pub fn close_project_window(app: AppHandle, label: String) -> Result<(), String> {
    let window_label = format!("project-{}", label);
    if let Some(window) = app.get_webview_window(&window_label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}
