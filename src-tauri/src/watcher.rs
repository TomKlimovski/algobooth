//! Watches the library folder and reports, debounced, which entries changed on disk.
//!
//! Only pattern files (`*.json`) and folders (headings) are reported; hidden entries such as
//! `.DS_Store` or the library's own `.name.json.tmp` write files never are. The mini debouncer
//! gives paths but not event kinds, so the watcher remembers which paths are folders in order
//! to report one after it has been removed or renamed away.

use std::collections::{BTreeSet, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{DebounceEventResult, Debouncer, new_debouncer};
use walkdir::WalkDir;

use crate::library::relative;

/// Receives each debounced batch of changed paths, relative to the library root with `/` separators.
pub type Sink = Box<dyn Fn(Vec<String>) + Send>;

pub type LibraryWatcher = Debouncer<RecommendedWatcher>;

pub const DEBOUNCE: Duration = Duration::from_millis(300);

/// Starts watching `root` recursively; the watch stops when the returned handle is dropped.
pub fn start(root: &Path, sink: Sink) -> Result<LibraryWatcher, String> {
  // FSEvents reports real paths (e.g. /private/var/... for /var/...), so work from the real root.
  let root = root.canonicalize().map_err(|e| format!("cannot watch {}: {e}", root.display()))?;
  let mut tracker = Tracker::new(root.clone());
  let mut debouncer = new_debouncer(DEBOUNCE, move |result: DebounceEventResult| match result {
    Ok(events) => {
      let paths = tracker.changed(events.into_iter().map(|e| e.path));
      if !paths.is_empty() {
        sink(paths);
      }
    }
    Err(e) => log::warn!("library watcher: {e}"),
  })
  .map_err(|e| e.to_string())?;
  debouncer.watcher().watch(&root, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
  Ok(debouncer)
}

/// Decides which changed paths to report, remembering the folders seen so far.
struct Tracker {
  root: PathBuf,
  folders: HashSet<PathBuf>,
}

impl Tracker {
  fn new(root: PathBuf) -> Self {
    let folders = WalkDir::new(&root)
      .min_depth(1)
      .into_iter()
      .filter_map(Result::ok)
      .filter(|e| e.file_type().is_dir())
      .map(|e| e.into_path())
      .collect();
    Tracker { root, folders }
  }

  /// The sorted, de-duplicated relative paths among `paths` that the library cares about.
  fn changed(&mut self, paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    let mut out = BTreeSet::new();
    for path in paths {
      let Ok(rel) = path.strip_prefix(&self.root) else { continue };
      if rel.as_os_str().is_empty() || rel.components().any(is_hidden) {
        continue;
      }
      let folder = if path.is_dir() {
        self.folders.insert(path.clone());
        true
      } else if self.folders.remove(&path) {
        self.folders.retain(|f| !f.starts_with(&path));
        true
      } else {
        false
      };
      if folder || path.extension().is_some_and(|ext| ext == "json") {
        out.insert(relative(&self.root, &path));
      }
    }
    out.into_iter().collect()
  }
}

fn is_hidden(part: Component) -> bool {
  part.as_os_str().to_string_lossy().starts_with('.')
}

pub mod commands {
  use std::path::Path;
  use std::sync::Mutex;

  use serde::Serialize;
  use tauri::{AppHandle, Emitter, State};

  use super::LibraryWatcher;

  /// Holds the one active watcher; replacing it drops (and so stops) the previous one.
  #[derive(Default)]
  pub struct WatcherState(Mutex<Option<LibraryWatcher>>);

  #[derive(Clone, Serialize)]
  struct LibraryChanged {
    paths: Vec<String>,
  }

  #[tauri::command]
  pub fn watch_library(app: AppHandle, state: State<'_, WatcherState>, root: String) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    let sink = Box::new(move |paths| {
      if let Err(e) = app.emit("library-changed", LibraryChanged { paths }) {
        log::warn!("library watcher: {e}");
      }
    });
    *slot = Some(super::start(Path::new(&root), sink)?);
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use std::collections::BTreeSet;
  use std::fs;
  use std::sync::mpsc;
  use std::time::Duration;

  use super::*;

  /// Collects every batch until none arrives for `quiet`, waiting at most `first` for the first one.
  fn collect(rx: &mpsc::Receiver<Vec<String>>, first: Duration, quiet: Duration) -> Vec<Vec<String>> {
    let mut batches = Vec::new();
    let mut wait = first;
    while let Ok(batch) = rx.recv_timeout(wait) {
      batches.push(batch);
      wait = quiet;
    }
    batches
  }

  fn watch(root: &Path) -> (LibraryWatcher, mpsc::Receiver<Vec<String>>) {
    let (tx, rx) = mpsc::channel();
    let watcher = start(root, Box::new(move |paths| tx.send(paths).unwrap())).unwrap();
    // Give the backend a moment to begin streaming before the test touches the folder.
    std::thread::sleep(Duration::from_millis(200));
    (watcher, rx)
  }

  #[test]
  fn watcher_reports_json_changes_relative_to_root_and_ignores_ds_store() {
    let dir = tempfile::tempdir().unwrap();
    fs::create_dir(dir.path().join("mine")).unwrap();
    let (_watcher, rx) = watch(dir.path());

    fs::write(dir.path().join("mine/x.json"), "{}").unwrap();
    fs::write(dir.path().join(".DS_Store"), "junk").unwrap();
    fs::write(dir.path().join("mine/.DS_Store"), "junk").unwrap();
    fs::write(dir.path().join("mine/notes.txt"), "junk").unwrap();

    let batches = collect(&rx, Duration::from_secs(2), Duration::from_millis(800));
    assert!(!batches.is_empty(), "no change reported");
    let seen: BTreeSet<&str> = batches.iter().flatten().map(String::as_str).collect();
    assert_eq!(seen, BTreeSet::from(["mine/x.json"]), "batches: {batches:?}");
  }

  #[test]
  fn watcher_reports_folder_creation_and_removal() {
    let dir = tempfile::tempdir().unwrap();
    let (_watcher, rx) = watch(dir.path());

    fs::create_dir(dir.path().join("new-heading")).unwrap();
    let created = collect(&rx, Duration::from_secs(2), Duration::from_millis(800));
    assert!(created.iter().flatten().any(|p| p == "new-heading"), "batches: {created:?}");

    fs::remove_dir(dir.path().join("new-heading")).unwrap();
    let removed = collect(&rx, Duration::from_secs(2), Duration::from_millis(800));
    assert!(removed.iter().flatten().any(|p| p == "new-heading"), "batches: {removed:?}");
  }

  #[test]
  fn tracker_reports_removed_folders_and_skips_hidden_and_foreign_paths() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    fs::create_dir_all(root.join("old/inner")).unwrap();
    let mut tracker = Tracker::new(root.clone());
    fs::remove_dir_all(root.join("old")).unwrap();

    let changed = tracker.changed([
      root.join("old/inner"),
      root.join("old"),
      root.join("gone.txt"),
      root.join("gone.json"),
      root.join(".git/x.json"),
      root.join("mine/.x.json.tmp"),
      root.clone(),
      PathBuf::from("/elsewhere/y.json"),
    ]);
    assert_eq!(changed, ["gone.json", "old", "old/inner"]);
  }
}
