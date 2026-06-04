fn main() {
    if let Ok(target) = std::env::var("TARGET") {
        println!("cargo:rustc-env=ORBIT_BUILD_TARGET={target}");
        let extension = if target.contains("windows") {
            ".exe"
        } else {
            ""
        };
        let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
        let sidecar_path = std::path::Path::new(&manifest_dir)
            .join("binaries")
            .join(format!("codex-{target}{extension}"));
        if !sidecar_path.exists() && std::env::var("TAURI_CONFIG").is_err() {
            println!("cargo:warning=Codex sidecar binary is not prepared; omitting externalBin for Cargo-only builds.");
            println!(r#"cargo:rustc-env=TAURI_CONFIG={{"bundle":{{"externalBin":[]}}}}"#);
            std::env::set_var("TAURI_CONFIG", r#"{"bundle":{"externalBin":[]}}"#);
        }
    }
    tauri_build::build()
}
