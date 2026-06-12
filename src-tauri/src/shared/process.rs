use std::process::{ExitStatus, Output};
use std::time::Duration;

use crate::shared::ffmpeg_progress::{FfmpegProgressWatchdog, FfmpegProgressWatchdogConfig};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn tokio_command<S: AsRef<std::ffi::OsStr>>(program: S) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(program);
    configure_tokio_command(&mut command);
    command
}

#[cfg_attr(not(any(windows, target_os = "linux")), allow(dead_code))]
pub(crate) fn std_command<S: AsRef<std::ffi::OsStr>>(program: S) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    configure_std_command(&mut command);
    command
}

#[cfg(windows)]
fn configure_tokio_command(command: &mut tokio::process::Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_tokio_command(_: &mut tokio::process::Command) {}

#[cfg(windows)]
fn configure_std_command(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[cfg(not(windows))]
fn configure_std_command(_: &mut std::process::Command) {}

pub(crate) fn terminate_process(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(unix)]
    {
        // SAFETY: Best-effort process termination for a known PID.
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }

    #[cfg(windows)]
    {
        let _ = std_command("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
    }
}

pub(crate) fn force_terminate_process(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(unix)]
    {
        // SAFETY: Best-effort forced process termination for a known PID.
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }

    #[cfg(windows)]
    {
        let _ = std_command("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .output();
    }
}

pub(crate) async fn wait_with_output_timeout(
    mut child: tokio::process::Child,
    label: &str,
    timeout_duration: Duration,
) -> Result<Output, String> {
    use tokio::io::AsyncReadExt;
    use tokio::time::timeout;

    let pid = child.id();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(mut stdout) = stdout {
            stdout.read_to_end(&mut buffer).await?;
        }
        Ok::<Vec<u8>, std::io::Error>(buffer)
    });
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(mut stderr) = stderr {
            stderr.read_to_end(&mut buffer).await?;
        }
        Ok::<Vec<u8>, std::io::Error>(buffer)
    });

    let status = match timeout(timeout_duration, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("{} error: {}", label, error));
        }
        Err(_) => {
            if let Some(pid) = pid {
                force_terminate_process(pid);
            }
            let _ = timeout(Duration::from_secs(5), child.wait()).await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!(
                "{} timeout after {} seconds",
                label,
                timeout_duration.as_secs()
            ));
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|e| format!("Failed to read {} stdout: {}", label, e))?
        .map_err(|e| format!("Failed to read {} stdout: {}", label, e))?;
    let stderr = stderr_task
        .await
        .map_err(|e| format!("Failed to read {} stderr: {}", label, e))?
        .map_err(|e| format!("Failed to read {} stderr: {}", label, e))?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

pub(crate) async fn wait_status_progress_watchdog(
    mut child: tokio::process::Child,
    label: &str,
    activity_rx: tokio::sync::mpsc::UnboundedReceiver<()>,
    config: FfmpegProgressWatchdogConfig,
) -> Result<ExitStatus, String> {
    wait_child_status_progress_watchdog(&mut child, label, activity_rx, config).await
}

pub(crate) async fn wait_with_output_progress_watchdog(
    mut child: tokio::process::Child,
    label: &str,
    activity_rx: tokio::sync::mpsc::UnboundedReceiver<()>,
    config: FfmpegProgressWatchdogConfig,
) -> Result<Output, String> {
    use tokio::io::AsyncReadExt;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(mut stdout) = stdout {
            stdout.read_to_end(&mut buffer).await?;
        }
        Ok::<Vec<u8>, std::io::Error>(buffer)
    });
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(mut stderr) = stderr {
            stderr.read_to_end(&mut buffer).await?;
        }
        Ok::<Vec<u8>, std::io::Error>(buffer)
    });

    let status =
        match wait_child_status_progress_watchdog(&mut child, label, activity_rx, config).await {
            Ok(status) => status,
            Err(error) => {
                stdout_task.abort();
                stderr_task.abort();
                return Err(error);
            }
        };

    let stdout = stdout_task
        .await
        .map_err(|e| format!("Failed to read {} stdout: {}", label, e))?
        .map_err(|e| format!("Failed to read {} stdout: {}", label, e))?;
    let stderr = stderr_task
        .await
        .map_err(|e| format!("Failed to read {} stderr: {}", label, e))?
        .map_err(|e| format!("Failed to read {} stderr: {}", label, e))?;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

async fn wait_child_status_progress_watchdog(
    child: &mut tokio::process::Child,
    label: &str,
    mut activity_rx: tokio::sync::mpsc::UnboundedReceiver<()>,
    config: FfmpegProgressWatchdogConfig,
) -> Result<ExitStatus, String> {
    use std::time::Instant;
    use tokio::time::{interval, timeout};

    let pid = child.id();
    let started_at = Instant::now();
    let mut watchdog = FfmpegProgressWatchdog::new(config);
    let mut progress_check = interval(config.check_interval);

    loop {
        tokio::select! {
            status = child.wait() => {
                return status.map_err(|error| format!("{} error: {}", label, error));
            }
            Some(()) = activity_rx.recv() => {
                watchdog.record_activity(started_at.elapsed());
            }
            _ = progress_check.tick() => {
                if let Some(message) = watchdog.timeout_message(started_at.elapsed()) {
                    if let Some(pid) = pid {
                        force_terminate_process(pid);
                    }
                    let _ = timeout(config.shutdown_timeout, child.wait()).await;
                    return Err(format!("{} {}", label, message));
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::process::{Child, ExitStatus, Stdio};
    use std::thread;
    use std::time::{Duration, Instant};

    use super::{
        force_terminate_process, std_command, tokio_command, wait_with_output_progress_watchdog,
        wait_with_output_timeout,
    };
    use crate::shared::ffmpeg_progress::FfmpegProgressWatchdogConfig;

    #[test]
    fn force_terminate_process_ignores_zero_pid() {
        force_terminate_process(0);
    }

    #[test]
    fn force_terminate_process_stops_running_process() {
        let mut child = spawn_sleeping_child();
        let pid = child.id();

        force_terminate_process(pid);

        let status = wait_for_child_exit(&mut child).unwrap_or_else(|| {
            let _ = child.kill();
            let _ = child.wait();
            panic!("force_terminate_process did not stop child process");
        });

        assert!(!status.success());
    }

    #[tokio::test]
    async fn wait_with_output_timeout_captures_output() {
        let child = spawn_async_output_child();

        let output = wait_with_output_timeout(child, "test process", Duration::from_secs(5))
            .await
            .expect("process should finish");

        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("hello"));
    }

    #[tokio::test]
    async fn wait_with_output_timeout_kills_on_timeout() {
        let child = spawn_async_sleeping_child();

        let error = wait_with_output_timeout(child, "test process", Duration::from_millis(100))
            .await
            .expect_err("process should time out");

        assert!(error.starts_with("test process timeout after "));
    }

    #[tokio::test]
    async fn wait_with_output_progress_watchdog_kills_on_startup_timeout() {
        let child = spawn_async_sleeping_child();
        let (_activity_tx, activity_rx) = tokio::sync::mpsc::unbounded_channel();

        let error = wait_with_output_progress_watchdog(
            child,
            "test process",
            activity_rx,
            FfmpegProgressWatchdogConfig {
                startup_timeout: Duration::from_millis(100),
                stall_timeout: Duration::from_secs(10),
                check_interval: Duration::from_millis(10),
                shutdown_timeout: Duration::from_millis(100),
            },
        )
        .await
        .expect_err("process should time out without activity");

        assert_eq!(
            error,
            "test process did not report progress within 0 seconds"
        );
    }

    #[cfg(unix)]
    fn spawn_sleeping_child() -> Child {
        std_command("sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn sleep process")
    }

    #[cfg(windows)]
    fn spawn_sleeping_child() -> Child {
        std_command("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn ping process")
    }

    #[cfg(unix)]
    fn spawn_async_output_child() -> tokio::process::Child {
        tokio_command("sh")
            .args(["-c", "printf hello"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn output process")
    }

    #[cfg(windows)]
    fn spawn_async_output_child() -> tokio::process::Child {
        tokio_command("cmd")
            .args(["/C", "echo hello"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn output process")
    }

    #[cfg(unix)]
    fn spawn_async_sleeping_child() -> tokio::process::Child {
        tokio_command("sh")
            .args(["-c", "sleep 30"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn sleep process")
    }

    #[cfg(windows)]
    fn spawn_async_sleeping_child() -> tokio::process::Child {
        tokio_command("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 >NUL"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn sleep process")
    }

    fn wait_for_child_exit(child: &mut Child) -> Option<ExitStatus> {
        let timeout = Duration::from_secs(3);
        let started_at = Instant::now();

        while started_at.elapsed() < timeout {
            if let Some(status) = child.try_wait().expect("failed to poll child process") {
                return Some(status);
            }

            thread::sleep(Duration::from_millis(25));
        }

        None
    }
}
