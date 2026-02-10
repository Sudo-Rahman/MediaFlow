use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::LazyLock;
use std::thread;

static SERVICE: LazyLock<SleepInhibitService> = LazyLock::new(SleepInhibitService::new);

pub(crate) fn acquire_sleep_inhibit(reason: impl Into<String>) -> Result<u64, String> {
    SERVICE.acquire(reason.into())
}

pub(crate) fn release_sleep_inhibit(token: u64) -> Result<(), String> {
    SERVICE.release(token)
}

pub(crate) struct SleepInhibitGuard {
    token: u64,
}

impl SleepInhibitGuard {
    pub(crate) fn try_acquire(reason: impl Into<String>) -> Result<Self, String> {
        let token = acquire_sleep_inhibit(reason)?;
        Ok(Self { token })
    }
}

impl Drop for SleepInhibitGuard {
    fn drop(&mut self) {
        SERVICE.release_best_effort(self.token);
    }
}

enum Request {
    Acquire {
        reason: String,
        reply: mpsc::Sender<Result<u64, String>>,
    },
    Release {
        token: u64,
        reply: mpsc::Sender<Result<(), String>>,
    },
    ReleaseBestEffort {
        token: u64,
    },
}

struct SleepInhibitService {
    tx: mpsc::Sender<Request>,
}

impl SleepInhibitService {
    fn new() -> Self {
        let (tx, rx) = mpsc::channel::<Request>();

        thread::Builder::new()
            .name("sleep-inhibit".to_string())
            .spawn(move || {
                let mut state = ManagerState::new();
                while let Ok(request) = rx.recv() {
                    state.handle_request(request);
                }
            })
            .expect("failed to spawn sleep inhibit thread");

        Self { tx }
    }

    fn acquire(&self, reason: String) -> Result<u64, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Request::Acquire {
                reason,
                reply: reply_tx,
            })
            .map_err(|_| "Sleep inhibit service unavailable".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "Sleep inhibit service unavailable".to_string())?
    }

    fn release(&self, token: u64) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Request::Release {
                token,
                reply: reply_tx,
            })
            .map_err(|_| "Sleep inhibit service unavailable".to_string())?;
        reply_rx
            .recv()
            .map_err(|_| "Sleep inhibit service unavailable".to_string())?
    }

    fn release_best_effort(&self, token: u64) {
        let _ = self.tx.send(Request::ReleaseBestEffort { token });
    }
}

struct ManagerState {
    next_token: u64,
    leases: HashMap<u64, String>,
    handle: Option<PlatformInhibitHandle>,
}

impl ManagerState {
    fn new() -> Self {
        Self {
            next_token: 1,
            leases: HashMap::new(),
            handle: None,
        }
    }

    fn handle_request(&mut self, request: Request) {
        match request {
            Request::Acquire { reason, reply } => {
                let token = self.next_token;
                self.next_token = self.next_token.saturating_add(1);

                let should_activate = self.leases.is_empty();
                self.leases.insert(token, reason.clone());

                if should_activate {
                    self.handle = PlatformInhibitHandle::new_best_effort(&reason);
                }

                let _ = reply.send(Ok(token));
            }
            Request::Release { token, reply } => {
                if self.leases.remove(&token).is_none() {
                    let _ = reply.send(Err("Unknown sleep inhibit token".to_string()));
                    return;
                }

                if self.leases.is_empty() {
                    self.handle = None;
                }

                let _ = reply.send(Ok(()));
            }
            Request::ReleaseBestEffort { token } => {
                let _ = self.leases.remove(&token);
                if self.leases.is_empty() {
                    self.handle = None;
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
struct PlatformInhibitHandle {
    assertion_id: u32,
}

#[cfg(target_os = "windows")]
struct PlatformInhibitHandle;

#[cfg(target_os = "linux")]
struct PlatformInhibitHandle {
    kind: linux::LinuxInhibitKind,
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
struct PlatformInhibitHandle;

impl PlatformInhibitHandle {
    fn new_best_effort(reason: &str) -> Option<Self> {
        match Self::new(reason) {
            Ok(handle) => Some(handle),
            Err(error) => {
                eprintln!("Failed to enable sleep inhibition: {}", error);
                None
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn new(reason: &str) -> Result<Self, String> {
        macos::create_assertion(reason).map(|assertion_id| Self { assertion_id })
    }

    #[cfg(target_os = "windows")]
    fn new(_reason: &str) -> Result<Self, String> {
        windows::set_awake(true)?;
        Ok(Self)
    }

    #[cfg(target_os = "linux")]
    fn new(reason: &str) -> Result<Self, String> {
        linux::create_inhibit(reason).map(|kind| Self { kind })
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    fn new(_reason: &str) -> Result<Self, String> {
        Err("Unsupported platform".to_string())
    }
}

#[cfg(target_os = "macos")]
impl Drop for PlatformInhibitHandle {
    fn drop(&mut self) {
        macos::release_assertion(self.assertion_id);
    }
}

#[cfg(target_os = "windows")]
impl Drop for PlatformInhibitHandle {
    fn drop(&mut self) {
        let _ = windows::set_awake(false);
    }
}

#[cfg(target_os = "linux")]
impl Drop for PlatformInhibitHandle {
    fn drop(&mut self) {
        linux::release_inhibit(&mut self.kind);
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_void};

    type CFAllocatorRef = *const c_void;
    type CFStringRef = *const c_void;
    type CFTypeRef = *const c_void;

    type IOPMAssertionID = u32;
    type IOPMAssertionLevel = u32;
    type IOReturn = i32;

    const K_CFSTRING_ENCODING_UTF8: u32 = 0x0800_0100;
    const K_IOPM_ASSERTION_LEVEL_ON: IOPMAssertionLevel = 255;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            alloc: CFAllocatorRef,
            c_str: *const c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "IOKit", kind = "framework")]
    unsafe extern "C" {
        fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            level: IOPMAssertionLevel,
            assertion_name: CFStringRef,
            assertion_id: *mut IOPMAssertionID,
        ) -> IOReturn;
        fn IOPMAssertionRelease(assertion_id: IOPMAssertionID) -> IOReturn;
    }

    fn cf_string(s: &str) -> Result<CFStringRef, String> {
        let cstr = CString::new(s).map_err(|_| "Invalid string for CFString".to_string())?;
        // SAFETY: `cstr` is NUL-terminated and stays alive for the duration of the call.
        let cf = unsafe { CFStringCreateWithCString(std::ptr::null(), cstr.as_ptr(), K_CFSTRING_ENCODING_UTF8) };
        if cf.is_null() {
            return Err("Failed to create CFString".to_string());
        }
        Ok(cf)
    }

    pub(super) fn create_assertion(reason: &str) -> Result<u32, String> {
        let assertion_type = cf_string("PreventUserIdleSystemSleep")?;
        let name = if reason.trim_start().starts_with("RsExtractor:") {
            reason.to_string()
        } else {
            format!("RsExtractor: {}", reason)
        };
        let assertion_name = cf_string(&name)?;

        let mut id: IOPMAssertionID = 0;

        // SAFETY: we pass valid CFStringRefs and a valid pointer for the output assertion id.
        let result = unsafe {
            IOPMAssertionCreateWithName(
                assertion_type,
                K_IOPM_ASSERTION_LEVEL_ON,
                assertion_name,
                &mut id as *mut IOPMAssertionID,
            )
        };

        // SAFETY: CFRelease accepts any CFTypeRef created by CoreFoundation.
        unsafe {
            CFRelease(assertion_type as CFTypeRef);
            CFRelease(assertion_name as CFTypeRef);
        }

        if result != 0 {
            return Err(format!("IOPMAssertionCreateWithName failed ({})", result));
        }

        Ok(id)
    }

    pub(super) fn release_assertion(id: u32) {
        // SAFETY: releasing an assertion id is safe; errors are non-fatal.
        let _ = unsafe { IOPMAssertionRelease(id) };
    }
}

#[cfg(target_os = "windows")]
mod windows {
    type ExecutionState = u32;

    const ES_SYSTEM_REQUIRED: ExecutionState = 0x0000_0001;
    const ES_CONTINUOUS: ExecutionState = 0x8000_0000;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(es_flags: ExecutionState) -> ExecutionState;
    }

    pub(super) fn set_awake(enable: bool) -> Result<(), String> {
        let flags = if enable {
            ES_CONTINUOUS | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };

        // SAFETY: calling SetThreadExecutionState is safe; it affects system idle behavior.
        let prev = unsafe { SetThreadExecutionState(flags) };
        if prev == 0 {
            return Err("SetThreadExecutionState failed".to_string());
        }
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::process::{Child, Command, Stdio};

    use zbus::blocking::{Connection, Proxy};
    use zbus::zvariant::OwnedFd;

    pub(super) enum LinuxInhibitKind {
        Logind(OwnedFd),
        SystemdInhibit(Child),
    }

    pub(super) fn create_inhibit(reason: &str) -> Result<LinuxInhibitKind, String> {
        if let Ok(conn) = Connection::system() {
            let proxy = Proxy::new(
                &conn,
                "org.freedesktop.login1",
                "/org/freedesktop/login1",
                "org.freedesktop.login1.Manager",
            )
            .map_err(|e| format!("Failed to create logind proxy: {}", e))?;

            let who = "RsExtractor";
            let what = "sleep:idle";
            let mode = "block";

            let fd: Result<OwnedFd, _> = proxy.call("Inhibit", &(what, who, reason, mode));
            match fd {
                Ok(fd) => return Ok(LinuxInhibitKind::Logind(fd)),
                Err(err) => eprintln!(
                    "logind inhibit failed, falling back to systemd-inhibit: {}",
                    err
                ),
            };
        }

        // Fallback: spawn a long-lived systemd-inhibit process.
        let mut child = Command::new("systemd-inhibit")
            .args([
                "--what=sleep:idle",
                "--who=RsExtractor",
                &format!("--why={}", reason),
                "--mode=block",
                "sleep",
                "infinity",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn systemd-inhibit: {}", e))?;

        // Ensure the child stays alive. If it exits immediately, treat it as failure.
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Failed to check systemd-inhibit: {}", e))?
        {
            return Err(format!("systemd-inhibit exited early ({})", status));
        }

        Ok(LinuxInhibitKind::SystemdInhibit(child))
    }

    pub(super) fn release_inhibit(kind: &mut LinuxInhibitKind) {
        match kind {
            LinuxInhibitKind::Logind(_fd) => {
                // Dropping the FD releases the inhibitor lock.
            }
            LinuxInhibitKind::SystemdInhibit(child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
