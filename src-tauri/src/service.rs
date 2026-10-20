//! Launches the Python analysis service (`python -m algorip`), learns its port from the one line it
//! prints on stdout, and restarts it when it crashes.
//!
//! The service binds 127.0.0.1 on a random port and checks a per-launch token, which it reads from
//! the environment so it never appears in `ps` output.

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::settings::{self, Settings};

/// How long a launch may take to print its port line (the first launch imports torch).
const START_TIMEOUT: Duration = Duration::from_secs(20);
/// Pause before restarting a crashed service.
const RESTART_DELAY: Duration = Duration::from_secs(1);
/// At most `MAX_RESTARTS` restarts within any `RESTART_WINDOW`.
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
/// How often the supervisor checks whether the child has exited.
const POLL_INTERVAL: Duration = Duration::from_millis(200);

const NOT_FOUND: &str = "Python service not found: run `uv sync` in service/";
const KEEPS_CRASHING: &str = "service keeps crashing; see the log";

/// 16 random bytes as 32 lowercase hex characters.
pub fn generate_token(rng: &mut impl rand::RngCore) -> String {
  let mut bytes = [0u8; 16];
  rng.fill_bytes(&mut bytes);
  bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The port from the service's `{"port": N}` line; `None` for any other line.
pub fn parse_port_line(line: &str) -> Option<u16> {
  #[derive(Deserialize)]
  struct PortLine {
    port: u16,
  }
  serde_json::from_str::<PortLine>(line.trim()).ok().map(|p| p.port)
}

/// The service's python: the override when set, else the bundled venv under the resource dir, else
/// the dev venv next to `src-tauri/`.
pub fn python_path(
  env_override: Option<String>,
  resource_dir: Option<PathBuf>,
  manifest_dir: &Path,
  exists: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
  if let Some(p) = env_override.filter(|p| !p.is_empty()) {
    return Some(PathBuf::from(p));
  }
  let venv_python = |base: PathBuf| base.join("service").join(".venv").join("bin").join("python");
  let candidates = resource_dir.map(venv_python).into_iter().chain([venv_python(manifest_dir.join(".."))]);
  candidates.into_iter().find(|p| exists(p))
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServiceConfig {
  pub python: PathBuf,
  pub cache_dir: PathBuf,
  pub models_dir: PathBuf,
  pub keep_downloads: bool,
  pub token: String,
}

/// `python -m algorip`, run from the `service/` folder that holds the venv.
pub fn command(cfg: &ServiceConfig) -> Command {
  let mut cmd = Command::new(&cfg.python);
  cmd.args(["-m", "algorip"]);
  // <service>/.venv/bin/python -> <service>
  if let Some(service_dir) = cfg.python.ancestors().nth(3) {
    cmd.current_dir(service_dir);
  }
  cmd
    .env("ALGOBOOTH_TOKEN", &cfg.token)
    .env("ALGOBOOTH_CACHE_DIR", &cfg.cache_dir)
    .env("ALGOBOOTH_MODELS_DIR", &cfg.models_dir)
    .env("ALGOBOOTH_KEEP_DOWNLOADS", if cfg.keep_downloads { "1" } else { "0" })
    .env("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::inherit());
  cmd
}

/// Where the running service's pid is recorded: `<models_dir>/../algorip.pid`.
pub fn pidfile_path(models_dir: &Path) -> PathBuf {
  models_dir.parent().unwrap_or(models_dir).join("algorip.pid")
}

/// The pid in a pidfile's text. Rejects 0 and 1: `kill 0` would hit our own process group, and 1 is launchd.
pub fn parse_pidfile(text: &str) -> Option<u32> {
  text.trim().parse::<u32>().ok().filter(|pid| *pid > 1)
}

pub fn read_pidfile(path: &Path) -> Option<u32> {
  std::fs::read_to_string(path).ok().as_deref().and_then(parse_pidfile)
}

pub fn write_pidfile(path: &Path, pid: u32) -> std::io::Result<()> {
  std::fs::write(path, format!("{pid}\n"))
}

/// True when a `ps -o ppid=,command=` line is an orphaned algorip: its app died (it was reparented to
/// launchd, pid 1). A live service belonging to another running app instance, or a recycled pid, is
/// left alone.
pub fn is_stale_service(ps_line: &str) -> bool {
  let mut words = ps_line.split_whitespace();
  words.next() == Some("1") && words.any(|word| word == "algorip")
}

/// Kills a service left behind by an earlier app process that died without stopping it (a crash, or
/// a `tauri dev` rebuild, which SIGKILLs the app).
fn reap_stale(pidfile: &Path) {
  let Some(pid) = read_pidfile(pidfile) else { return };
  let pid = pid.to_string();
  let ps_line = Command::new("ps").args(["-p", &pid, "-o", "ppid=,command="]).output();
  if ps_line.is_ok_and(|out| is_stale_service(&String::from_utf8_lossy(&out.stdout))) {
    log::warn!("killing stale analysis service (pid {pid})");
    let _ = Command::new("kill").arg(&pid).status();
  }
  let _ = std::fs::remove_file(pidfile);
}

/// What the webview needs to call the service.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServiceInfo {
  pub port: u16,
  pub token: String,
}

/// True when a setting the service reads at launch changed.
pub fn restart_needed(old: &Settings, new: &Settings) -> bool {
  old.rip_cache_dir != new.rip_cache_dir || old.keep_downloads != new.keep_downloads
}

/// The crash-restart rule: at most `MAX_RESTARTS` restarts in any `RESTART_WINDOW`.
#[derive(Debug, Default)]
pub struct RestartBudget {
  restarts: VecDeque<Instant>,
}

impl RestartBudget {
  /// Records a restart at `now` and returns true, or returns false when the budget is spent.
  pub fn allow(&mut self, now: Instant) -> bool {
    while self.restarts.front().is_some_and(|t| now.duration_since(*t) >= RESTART_WINDOW) {
      self.restarts.pop_front();
    }
    if self.restarts.len() >= MAX_RESTARTS {
      return false;
    }
    self.restarts.push_back(now);
    true
  }

  pub fn reset(&mut self) {
    self.restarts.clear();
  }
}

/// Payload of the `service-status` event.
#[derive(Debug, Clone, Serialize)]
struct ServiceStatus {
  state: &'static str,
  #[serde(skip_serializing_if = "Option::is_none")]
  port: Option<u16>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

#[derive(Debug, Clone)]
enum Status {
  NotStarted,
  Starting,
  Running(ServiceInfo),
  Down(String),
}

struct Inner {
  status: Status,
  child: Option<Child>,
  /// Bumped by every `start` and `stop`; a supervisor or launch from an older generation stands down.
  generation: u64,
  budget: RestartBudget,
  app: Option<AppHandle>,
  /// Holds the current child's pid, so the next launch can reap it if this app dies without `stop()`.
  pidfile: Option<PathBuf>,
}

struct Shared {
  inner: Mutex<Inner>,
  changed: Condvar,
}

/// Managed state owning the service child process.
#[derive(Clone)]
pub struct ServiceState {
  shared: Arc<Shared>,
}

impl Default for ServiceState {
  fn default() -> Self {
    let inner = Inner {
      status: Status::NotStarted,
      child: None,
      generation: 0,
      budget: RestartBudget::default(),
      app: None,
      pidfile: None,
    };
    ServiceState { shared: Arc::new(Shared { inner: Mutex::new(inner), changed: Condvar::new() }) }
  }
}

fn emit(app: &AppHandle, state: &'static str, port: Option<u16>, error: Option<String>) {
  if let Err(e) = app.emit("service-status", ServiceStatus { state, port, error }) {
    log::warn!("could not emit service-status: {e}");
  }
}

fn config(app: &AppHandle, token: String) -> Result<ServiceConfig, String> {
  let python = python_path(
    std::env::var("ALGOBOOTH_PYTHON").ok(),
    app.path().resource_dir().ok(),
    Path::new(env!("CARGO_MANIFEST_DIR")),
    |p| p.exists(),
  )
  .ok_or(NOT_FOUND)?;
  let settings = settings::load(app);
  let models_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("models");
  Ok(ServiceConfig {
    python,
    cache_dir: PathBuf::from(settings.rip_cache_dir),
    models_dir,
    keep_downloads: settings.keep_downloads,
    token,
  })
}

/// Reads the child's stdout until the port line, then keeps draining it into the log so the
/// child never blocks on a full pipe.
fn read_port(stdout: impl Read + Send + 'static) -> mpsc::Receiver<u16> {
  let (tx, rx) = mpsc::channel();
  thread::spawn(move || {
    let mut tx = Some(tx);
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    // Byte lines, decoded lossily: only EOF or an I/O error stops the read, so the read end stays open
    // and later prints in the service never hit a broken pipe.
    loop {
      buf.clear();
      match reader.read_until(b'\n', &mut buf) {
        Ok(0) | Err(_) => break,
        Ok(_) => {}
      }
      let line = String::from_utf8_lossy(&buf);
      let line = line.trim_end();
      match (parse_port_line(line), tx.as_ref()) {
        (Some(port), Some(sender)) => {
          let _ = sender.send(port);
          tx = None;
        }
        _ => log::info!("algorip: {line}"),
      }
    }
  });
  rx
}

impl ServiceState {
  fn lock(&self) -> MutexGuard<'_, Inner> {
    self.shared.inner.lock().unwrap_or_else(|e| e.into_inner())
  }

  fn set_status(&self, inner: &mut Inner, status: Status) {
    inner.status = status;
    self.shared.changed.notify_all();
  }

  /// Launches the service and blocks until it reports its port (or `START_TIMEOUT` passes), then
  /// leaves a supervisor thread watching it.
  pub fn start(&self, app: &AppHandle) -> Result<ServiceInfo, String> {
    self.start_generation(app, false).1
  }

  /// `start`, also returning the generation it ran as. A supervisor `retrying` after a crash keeps the
  /// status at Starting and reports a failed attempt as `stopped`; only the supervisor decides `failed`.
  fn start_generation(&self, app: &AppHandle, retrying: bool) -> (u64, Result<ServiceInfo, String>) {
    let generation = {
      let mut inner = self.lock();
      inner.generation += 1;
      inner.app = Some(app.clone());
      self.set_status(&mut inner, Status::Starting);
      inner.generation
    };
    emit(app, "starting", None, None);
    let result = match self.launch(app, generation) {
      Ok(info) => Ok(info),
      Err(error) => {
        let mut inner = self.lock();
        if inner.generation == generation {
          let child = inner.child.take();
          if !retrying {
            self.set_status(&mut inner, Status::Down(error.clone()));
          }
          drop(inner);
          if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
          }
          log::error!("analysis service failed to start: {error}");
          emit(app, if retrying { "stopped" } else { "failed" }, None, Some(error.clone()));
        }
        Err(error)
      }
    };
    (generation, result)
  }

  fn launch(&self, app: &AppHandle, generation: u64) -> Result<ServiceInfo, String> {
    let cfg = config(app, generate_token(&mut rand::rng()))?;
    for dir in [&cfg.cache_dir, &cfg.models_dir] {
      std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    }
    let pidfile = pidfile_path(&cfg.models_dir);
    reap_stale(&pidfile);
    let mut child = command(&cfg).spawn().map_err(|e| format!("could not launch {}: {e}", cfg.python.display()))?;
    let stdout = child.stdout.take().ok_or("service stdout was not piped")?;
    if let Err(e) = write_pidfile(&pidfile, child.id()) {
      log::warn!("could not write {}: {e}", pidfile.display());
    }
    {
      let mut inner = self.lock();
      if inner.generation != generation {
        drop(inner);
        let _ = child.kill();
        let _ = child.wait();
        return Err("service start was superseded".into());
      }
      inner.pidfile = Some(pidfile);
      if let Some(mut old) = inner.child.replace(child) {
        // Never orphan a previous child, whoever started it.
        let _ = old.kill();
        let _ = old.wait();
      }
    }
    let port = read_port(stdout).recv_timeout(START_TIMEOUT).map_err(|_| "service did not report a port")?;
    let info = ServiceInfo { port, token: cfg.token };
    {
      let mut inner = self.lock();
      if inner.generation != generation {
        return Err("service start was superseded".into());
      }
      self.set_status(&mut inner, Status::Running(info.clone()));
    }
    log::info!("analysis service running on 127.0.0.1:{port}");
    emit(app, "running", Some(port), None);
    let (state, app) = (self.clone(), app.clone());
    thread::spawn(move || state.supervise(&app, generation));
    Ok(info)
  }

  /// Watches the child of `generation`; when it exits on its own, restarts it within the budget.
  fn supervise(&self, app: &AppHandle, mut generation: u64) {
    let exit = loop {
      thread::sleep(POLL_INTERVAL);
      let mut inner = self.lock();
      if inner.generation != generation {
        return; // stopped or restarted by someone else
      }
      let Some(child) = inner.child.as_mut() else { return };
      match child.try_wait() {
        Ok(None) => continue,
        Ok(Some(status)) => {
          inner.child = None;
          break status.to_string();
        }
        Err(e) => {
          inner.child = None;
          break e.to_string();
        }
      }
    };
    emit(app, "stopped", None, Some(exit.clone()));
    let mut reason = exit;
    loop {
      let allowed = {
        let mut inner = self.lock();
        if inner.generation != generation {
          return;
        }
        let allowed = inner.budget.allow(Instant::now());
        if allowed {
          // `service_info` waits through the restart delay instead of failing fast.
          self.set_status(&mut inner, Status::Starting);
        }
        allowed
      };
      if allowed {
        log::warn!("service stopped, restarting ({reason})");
      } else {
        log::warn!("service stopped ({reason})");
        let mut inner = self.lock();
        if inner.generation == generation {
          self.set_status(&mut inner, Status::Down(KEEPS_CRASHING.into()));
          drop(inner);
          log::error!("{KEEPS_CRASHING}");
          emit(app, "failed", None, Some(KEEPS_CRASHING.into()));
        }
        return;
      }
      thread::sleep(RESTART_DELAY);
      if self.lock().generation != generation {
        return;
      }
      // A successful start hands supervision to a new thread; a failed one counts as another crash.
      match self.start_generation(app, true) {
        (_, Ok(_)) => return,
        (next, Err(e)) => (generation, reason) = (next, e),
      }
    }
  }

  /// Kills the child (if any) and waits for it to exit.
  pub fn stop(&self) {
    let child = {
      let mut inner = self.lock();
      inner.generation += 1;
      self.set_status(&mut inner, Status::Down("service stopped".into()));
      if let Some(pidfile) = inner.pidfile.take() {
        let _ = std::fs::remove_file(pidfile);
      }
      inner.child.take()
    };
    if let Some(mut child) = child {
      let _ = child.kill();
      let _ = child.wait();
    }
  }

  /// Stops the service and starts it again with a fresh restart budget.
  pub fn restart(&self, app: &AppHandle) -> Result<ServiceInfo, String> {
    self.stop();
    self.lock().budget.reset();
    self.start(app)
  }

  /// Restarts the service in the background when a setting it reads at launch changed.
  pub fn restart_if_changed(&self, old: &Settings, new: &Settings) {
    if !restart_needed(old, new) {
      return;
    }
    let Some(app) = self.lock().app.clone() else { return };
    let state = self.clone();
    thread::spawn(move || {
      let _ = state.restart(&app);
    });
  }

  /// The running service's port and token, waiting up to `START_TIMEOUT` for a start in progress.
  pub fn info(&self) -> Result<ServiceInfo, String> {
    let deadline = Instant::now() + START_TIMEOUT;
    let mut inner = self.lock();
    loop {
      match &inner.status {
        Status::Running(info) => return Ok(info.clone()),
        Status::Down(reason) => return Err(format!("service not running: {reason}")),
        Status::Starting | Status::NotStarted => {
          let now = Instant::now();
          if now >= deadline {
            return Err("service not running: still starting".into());
          }
          inner = self.shared.changed.wait_timeout(inner, deadline - now).unwrap_or_else(|e| e.into_inner()).0;
        }
      }
    }
  }
}

pub mod commands {
  use tauri::{AppHandle, Manager};

  use super::{ServiceInfo, ServiceState};

  /// The service's port and token; waits for a start in progress.
  #[tauri::command]
  pub async fn service_info(app: AppHandle) -> Result<ServiceInfo, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<ServiceState>().info()).await.map_err(|e| e.to_string())?
  }

  /// Stops and relaunches the service, clearing the crash budget.
  #[tauri::command]
  pub async fn restart_service(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<ServiceState>().restart(&app).map(|_| ()))
      .await
      .map_err(|e| e.to_string())?
  }
}

#[cfg(test)]
mod tests {
  use std::path::{Path, PathBuf};

  use super::*;
  use crate::settings::{Settings, Visualiser, default_settings};

  fn test_config() -> ServiceConfig {
    ServiceConfig {
      python: PathBuf::from("/repo/service/.venv/bin/python"),
      cache_dir: PathBuf::from("/cache"),
      models_dir: PathBuf::from("/models"),
      keep_downloads: false,
      token: "t".into(),
    }
  }

  #[test]
  fn token_is_32_hex_chars() {
    let t = generate_token(&mut rand::rng());
    assert_eq!(t.len(), 32);
    assert!(t.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    assert_ne!(t, generate_token(&mut rand::rng()));
  }

  #[test]
  fn port_line_parses_only_the_json_shape() {
    assert_eq!(parse_port_line(r#"{"port": 51234}"#), Some(51234));
    assert_eq!(parse_port_line("Collecting torch"), None);
  }

  #[test]
  fn python_path_prefers_override_then_resources_then_dev_venv() {
    let exists = |p: &Path| p.to_string_lossy().contains("have");
    assert_eq!(python_path(Some("/x/py".into()), None, Path::new("/m"), exists), Some("/x/py".into()));
    assert_eq!(
      python_path(None, Some("/res-have".into()), Path::new("/m"), exists),
      Some("/res-have/service/.venv/bin/python".into())
    );
    assert_eq!(
      python_path(None, Some("/res".into()), Path::new("/m-have/src-tauri"), exists),
      Some("/m-have/src-tauri/../service/.venv/bin/python".into())
    );
    assert_eq!(python_path(None, None, Path::new("/m"), exists), None);
  }

  #[test]
  fn command_passes_token_in_env_not_argv() {
    let cmd = command(&ServiceConfig { token: "abc".into(), ..test_config() });
    let args: Vec<_> = cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
    assert_eq!(args, ["-m", "algorip"]);
    assert!(cmd.get_envs().any(|(k, v)| k == "ALGOBOOTH_TOKEN" && v == Some("abc".as_ref())));
    assert!(cmd.get_envs().any(|(k, _)| k == "PYTORCH_ENABLE_MPS_FALLBACK"));
  }

  #[test]
  fn command_runs_in_the_service_folder_with_the_rip_env() {
    let cmd = command(&ServiceConfig { keep_downloads: true, ..test_config() });
    assert_eq!(cmd.get_program(), "/repo/service/.venv/bin/python");
    assert_eq!(cmd.get_current_dir(), Some(Path::new("/repo/service")));
    let env = |name: &str| {
      cmd.get_envs().find(|(k, _)| *k == name).and_then(|(_, v)| v).map(|v| v.to_string_lossy().into_owned())
    };
    assert_eq!(env("ALGOBOOTH_CACHE_DIR").as_deref(), Some("/cache"));
    assert_eq!(env("ALGOBOOTH_MODELS_DIR").as_deref(), Some("/models"));
    assert_eq!(env("ALGOBOOTH_KEEP_DOWNLOADS").as_deref(), Some("1"));
    assert_eq!(env("PYTORCH_ENABLE_MPS_FALLBACK").as_deref(), Some("1"));
  }

  #[test]
  fn settings_default_new_rip_fields_when_missing() {
    let s: Settings = serde_json::from_str(r#"{"library_dir":"/l","visualiser":"scope","engine":"webaudio"}"#).unwrap();
    assert!(!s.keep_downloads);
    assert_eq!(s.claude_api_key, "");
    assert!(s.rip_cache_dir.ends_with("Algobooth/cache"));
  }

  #[test]
  fn restart_only_when_service_settings_change() {
    let old = default_settings();
    assert!(restart_needed(&old, &Settings { keep_downloads: true, ..old.clone() }));
    assert!(restart_needed(&old, &Settings { rip_cache_dir: "/elsewhere".into(), ..old.clone() }));
    assert!(!restart_needed(
      &old,
      &Settings { claude_api_key: "k".into(), visualiser: Visualiser::Scope, ..old.clone() }
    ));
  }

  #[test]
  fn pidfile_sits_next_to_the_models_dir() {
    assert_eq!(pidfile_path(Path::new("/data/models")), PathBuf::from("/data/algorip.pid"));
  }

  #[test]
  fn pidfile_parses_a_real_pid_only() {
    assert_eq!(parse_pidfile("4242\n"), Some(4242));
    assert_eq!(parse_pidfile(" 4242 "), Some(4242));
    assert_eq!(parse_pidfile(""), None);
    assert_eq!(parse_pidfile("abc"), None);
    assert_eq!(parse_pidfile("-5"), None);
    // `kill 0` signals our own process group and pid 1 is launchd: never target them.
    assert_eq!(parse_pidfile("0"), None);
    assert_eq!(parse_pidfile("1"), None);
  }

  #[test]
  fn pidfile_round_trips_and_a_missing_one_reads_as_none() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("algorip.pid");
    assert_eq!(read_pidfile(&path), None);
    write_pidfile(&path, 4242).unwrap();
    assert_eq!(read_pidfile(&path), Some(4242));
  }

  #[test]
  fn only_an_orphaned_algorip_counts_as_a_stale_service() {
    assert!(is_stale_service("    1 /repo/service/.venv/bin/python -m algorip\n"));
    // Still owned by a running app (another instance): not stale.
    assert!(!is_stale_service("51314 /repo/service/.venv/bin/python -m algorip"));
    // A recycled pid that is some other orphan.
    assert!(!is_stale_service("    1 /usr/bin/vim notes.txt"));
    assert!(!is_stale_service(""));
  }

  #[test]
  fn read_port_survives_non_utf8_output_before_the_port_line() {
    let out: &[u8] = b"Downloading \xff\xfe weights\n{\"port\": 51234}\nlater output\n";
    let rx = read_port(std::io::Cursor::new(out.to_vec()));
    assert_eq!(rx.recv_timeout(Duration::from_secs(5)), Ok(51234));
  }

  #[test]
  fn three_restarts_in_a_minute_then_failed() {
    let t0 = Instant::now();
    let s = Duration::from_secs;
    let mut b = RestartBudget::default();
    assert!(b.allow(t0));
    assert!(b.allow(t0 + s(10)));
    assert!(b.allow(t0 + s(20)));
    assert!(!b.allow(t0 + s(30)), "a fourth crash inside 60 s gives up");
  }

  #[test]
  fn restart_budget_window_slides() {
    let t0 = Instant::now();
    let s = Duration::from_secs;
    let mut b = RestartBudget::default();
    assert!(b.allow(t0));
    assert!(b.allow(t0 + s(10)));
    assert!(b.allow(t0 + s(20)));
    assert!(b.allow(t0 + s(61)), "the first restart has left the window");
    assert!(!b.allow(t0 + s(62)));
  }

  #[test]
  fn restart_budget_resets() {
    let t0 = Instant::now();
    let mut b = RestartBudget::default();
    for _ in 0..3 {
      assert!(b.allow(t0));
    }
    assert!(!b.allow(t0));
    b.reset();
    assert!(b.allow(t0));
  }
}
