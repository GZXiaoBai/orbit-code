use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub struct ProcessMonitorPolicy {
    pub timeout_secs: u64,
    pub max_memory_mb: u64,
}

impl Default for ProcessMonitorPolicy {
    fn default() -> Self {
        ProcessMonitorPolicy {
            timeout_secs: 10,
            max_memory_mb: 50,
        }
    }
}

pub fn get_process_rss(pid: u32) -> Option<u64> {
    let output = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let rss_kb: u64 = stdout.trim().parse().ok()?;
        Some(rss_kb * 1024)
    } else {
        None
    }
}

pub struct ProcessGuard {
    is_done: Arc<AtomicBool>,
}

impl ProcessGuard {
    pub fn new() -> Self {
        ProcessGuard {
            is_done: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_done_handle(&self) -> Arc<AtomicBool> {
        self.is_done.clone()
    }

    pub fn signal_done(&self) {
        self.is_done.store(true, Ordering::SeqCst);
    }

    pub fn monitor(
        done: Arc<AtomicBool>,
        pid: u32,
        policy: ProcessMonitorPolicy,
    ) -> Result<(), String> {
        let start_time = std::time::Instant::now();
        let mut initial_rss = 0u64;
        let limit_rss = policy.max_memory_mb * 1024 * 1024;

        // Sample initial RSS
        for _ in 0..10 {
            if let Some(rss) = get_process_rss(pid) {
                initial_rss = rss;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        loop {
            if done.load(Ordering::SeqCst) {
                return Ok(());
            }

            // Timeout check
            if start_time.elapsed().as_secs() >= policy.timeout_secs {
                let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                return Err(format!(
                    "TIMEOUT_LIMIT_EXCEEDED: Process exceeded {}s limit",
                    policy.timeout_secs
                ));
            }

            // Memory check
            if let Some(rss) = get_process_rss(pid) {
                if initial_rss > 0 && rss > initial_rss + limit_rss {
                    let _ = Command::new("kill").args(["-9", &pid.to_string()]).output();
                    return Err(format!(
                        "MEMORY_LIMIT_EXCEEDED: RSS grew by >{}MB (from {}MB to {}MB)",
                        policy.max_memory_mb,
                        initial_rss / 1024 / 1024,
                        rss / 1024 / 1024
                    ));
                }
            }

            std::thread::sleep(Duration::from_millis(200));
        }
    }
}
