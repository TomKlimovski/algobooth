//! The pattern library on disk: headings are folders, patterns are one JSON file each.
//!
//! Every function takes the library root plus paths relative to it (with `/` separators),
//! and rejects any path that would leave the root.

use std::cmp::Ordering;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::slug::slugify;

/// A pattern file. Only `code` is required, so a hand-written `{"code": ...}` file is readable: `name`
/// falls back to the file stem (see `parse_pattern`), `cpm` to 120, and the rest to empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pattern {
  #[serde(default)]
  pub name: String,
  pub code: String,
  #[serde(default = "default_cpm")]
  pub cpm: f64,
  #[serde(default)]
  pub key: String,
  #[serde(default)]
  pub tags: Vec<String>,
  #[serde(default)]
  pub source: Source,
  #[serde(default)]
  pub notes: String,
  /// The method keyboard layout for this pattern. Opaque here: the webview owns its shape, and a
  /// file without one serialises without the field.
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub keys: Option<serde_json::Value>,
}

fn default_cpm() -> f64 {
  120.0
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum Source {
  Rip {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    start: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    end: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    ripped_at: Option<String>,
  },
  #[default]
  Mine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeKind {
  Heading,
  Pattern,
  Unreadable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TreeNode {
  pub name: String,
  pub path: String,
  pub kind: NodeKind,
  pub cpm: Option<f64>,
  pub children: Vec<TreeNode>,
}

/// Joins `rel` onto `root`, rejecting absolute paths, `..` segments, and paths whose deepest
/// existing part resolves (through a symlink) outside the root.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let rel_path = Path::new(rel);
  if rel_path.is_absolute() {
    return Err(format!("path must be relative to the library: {rel}"));
  }
  let mut out = root.to_path_buf();
  for part in rel_path.components() {
    match part {
      Component::Normal(p) => out.push(p),
      Component::CurDir => {}
      _ => return Err(format!("path escapes the library: {rel}")),
    }
  }
  // The deepest part that already exists must really be inside the root (symlinks included).
  if let Some(existing) = out.ancestors().find(|p| p.exists()) {
    let real_root = root.canonicalize().map_err(|e| e.to_string())?;
    let real = existing.canonicalize().map_err(|e| e.to_string())?;
    if !real.starts_with(&real_root) {
      return Err(format!("path escapes the library: {rel}"));
    }
  }
  Ok(out)
}

/// Like `resolve`, but refuses the root itself (for rename, move and delete).
fn resolve_entry(root: &Path, rel: &str) -> Result<PathBuf, String> {
  let path = resolve(root, rel)?;
  if path == root {
    return Err("the library folder itself cannot be changed here".into());
  }
  if !path.exists() {
    return Err(format!("not found: {rel}"));
  }
  Ok(path)
}

pub(crate) fn relative(root: &Path, path: &Path) -> String {
  path
    .strip_prefix(root)
    .unwrap_or(path)
    .components()
    .map(|c| c.as_os_str().to_string_lossy())
    .collect::<Vec<_>>()
    .join("/")
}

fn file_name(path: &Path) -> String {
  path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn is_hidden(name: &str) -> bool {
  name.starts_with('.')
}

fn same_file(a: &Path, b: &Path) -> bool {
  match (a.canonicalize(), b.canonicalize()) {
    (Ok(a), Ok(b)) => a == b,
    _ => false,
  }
}

/// Reads a pattern file; a missing or empty `name` becomes the file stem.
fn parse_pattern(path: &Path) -> Result<Pattern, String> {
  let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
  let mut pattern: Pattern = serde_json::from_str(&text).map_err(|e| format!("not a valid pattern: {e}"))?;
  if pattern.name.is_empty() {
    pattern.name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
  }
  Ok(pattern)
}

/// Writes JSON via a hidden temp file in the same folder, then renames it into place.
fn write_json(path: &Path, pattern: &Pattern) -> Result<(), String> {
  let tmp = path.with_file_name(format!(".{}.tmp", file_name(path)));
  let text = serde_json::to_string_pretty(pattern).map_err(|e| e.to_string())?;
  fs::write(&tmp, text).map_err(|e| e.to_string())?;
  fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// First of `slug.json`, `slug-2.json`, ... in `dir` that is free or accepted by `reuse`.
fn unique_file(dir: &Path, slug: &str, reuse: impl Fn(&Path) -> bool) -> PathBuf {
  let mut n = 1;
  loop {
    let name = if n == 1 { format!("{slug}.json") } else { format!("{slug}-{n}.json") };
    let candidate = dir.join(name);
    if !candidate.exists() || reuse(&candidate) {
      return candidate;
    }
    n += 1;
  }
}

/// Heading names are folder names shown as-is, so refuse anything that is not one plain segment.
fn check_heading_name(name: &str) -> Result<&str, String> {
  let name = name.trim();
  if name.is_empty() || name == "." || name == ".." {
    return Err("a heading needs a name".into());
  }
  if is_hidden(name) || name.contains(['/', '\\', '\0']) {
    return Err(format!("a heading name cannot start with a dot or contain / or \\: {name}"));
  }
  Ok(name)
}

fn by_kind_then_name(a: &TreeNode, b: &TreeNode) -> Ordering {
  let rank = |n: &TreeNode| if n.kind == NodeKind::Heading { 0 } else { 1 };
  rank(a)
    .cmp(&rank(b))
    .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    .then_with(|| a.name.cmp(&b.name))
}

fn tree_at(root: &Path, dir: &Path) -> Vec<TreeNode> {
  let entries = WalkDir::new(dir)
    .min_depth(1)
    .max_depth(1)
    .into_iter()
    .filter_entry(|e| !is_hidden(&e.file_name().to_string_lossy()))
    .filter_map(Result::ok);
  let mut nodes = Vec::new();
  for entry in entries {
    let path = entry.path();
    let rel = relative(root, path);
    if entry.file_type().is_dir() {
      nodes.push(TreeNode {
        name: file_name(path),
        path: rel,
        kind: NodeKind::Heading,
        cpm: None,
        children: tree_at(root, path),
      });
    } else if entry.file_type().is_file() && path.extension().is_some_and(|x| x == "json") {
      let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
      let node = match parse_pattern(path) {
        Ok(p) => TreeNode {
          name: if p.name.is_empty() { stem } else { p.name },
          path: rel,
          kind: NodeKind::Pattern,
          cpm: Some(p.cpm),
          children: vec![],
        },
        Err(_) => TreeNode { name: stem, path: rel, kind: NodeKind::Unreadable, cpm: None, children: vec![] },
      };
      nodes.push(node);
    }
  }
  nodes.sort_by(by_kind_then_name);
  nodes
}

/// The whole library as a tree. Hidden entries, non-JSON files and symlinks are skipped;
/// JSON that does not parse as a pattern is listed as `unreadable`.
pub fn list_tree(root: &Path) -> Result<TreeNode, String> {
  if !root.is_dir() {
    return Err(format!("library folder not found: {}", root.display()));
  }
  Ok(TreeNode {
    name: file_name(root),
    path: String::new(),
    kind: NodeKind::Heading,
    cpm: None,
    children: tree_at(root, root),
  })
}

pub fn read_pattern(root: &Path, path: &str) -> Result<Pattern, String> {
  parse_pattern(&resolve(root, path)?)
}

/// Writes `pattern` into the heading as `slugify(name).json`, creating the heading if needed.
/// A file already holding an identical pattern is reused; any other file at that name gets
/// a `-2`, `-3`, ... suffix instead. Returns the relative file path.
pub fn write_pattern(root: &Path, heading_path: &str, pattern: &Pattern) -> Result<String, String> {
  let dir = resolve(root, heading_path)?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let target = unique_file(&dir, &slugify(&pattern.name), |p| parse_pattern(p).is_ok_and(|old| old == *pattern));
  write_json(&target, pattern)?;
  Ok(relative(root, &target))
}

/// Overwrites the existing pattern file at `path` in place. The file name never changes,
/// even when `pattern.name` does.
pub fn save_pattern(root: &Path, path: &str, pattern: &Pattern) -> Result<(), String> {
  let file = resolve(root, path)?;
  if file.extension().is_none_or(|x| x != "json") {
    return Err(format!("not a pattern file: {path}"));
  }
  if !file.is_file() {
    return Err(format!("not found: {path}"));
  }
  write_json(&file, pattern)
}

pub fn create_heading(root: &Path, parent_path: &str, name: &str) -> Result<String, String> {
  let parent = resolve(root, parent_path)?;
  let dir = parent.join(check_heading_name(name)?);
  if dir.exists() {
    return Err(format!("{} already exists", relative(root, &dir)));
  }
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(relative(root, &dir))
}

/// Renames a heading folder, or a pattern file (re-slugged) together with its JSON `name`.
pub fn rename_entry(root: &Path, path: &str, new_name: &str) -> Result<String, String> {
  let src = resolve_entry(root, path)?;
  let parent = src.parent().ok_or("entry has no parent")?.to_path_buf();
  if src.is_dir() {
    let dest = parent.join(check_heading_name(new_name)?);
    if dest.exists() && !same_file(&dest, &src) {
      return Err(format!("{} already exists", relative(root, &dest)));
    }
    fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    return Ok(relative(root, &dest));
  }
  let mut pattern = parse_pattern(&src)?;
  pattern.name = new_name.to_string();
  let dest = unique_file(&parent, &slugify(new_name), |p| same_file(p, &src));
  write_json(&dest, &pattern)?;
  if !same_file(&dest, &src) {
    fs::remove_file(&src).map_err(|e| e.to_string())?;
  }
  Ok(relative(root, &dest))
}

/// Moves a heading or pattern under `new_parent_path`. A pattern whose file name is taken there
/// gets a numeric suffix; a heading whose name is taken is an error.
pub fn move_entry(root: &Path, path: &str, new_parent_path: &str) -> Result<String, String> {
  let src = resolve_entry(root, path)?;
  let parent = resolve(root, new_parent_path)?;
  if !parent.is_dir() {
    return Err(format!("not a heading: {new_parent_path}"));
  }
  if src.parent().is_some_and(|p| same_file(p, &parent)) {
    return Ok(relative(root, &src));
  }
  let dest = if src.is_dir() {
    if parent.canonicalize().map_err(|e| e.to_string())?.starts_with(src.canonicalize().map_err(|e| e.to_string())?) {
      return Err("a heading cannot move inside itself".into());
    }
    let dest = parent.join(file_name(&src));
    if dest.exists() {
      return Err(format!("{} already exists", relative(root, &dest)));
    }
    dest
  } else {
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    unique_file(&parent, &stem, |_| false)
  };
  fs::rename(&src, &dest).map_err(|e| e.to_string())?;
  Ok(relative(root, &dest))
}

/// Moves the entry to the system Trash; never deletes outright.
pub fn delete_entry(root: &Path, path: &str) -> Result<(), String> {
  trash::delete(resolve_entry(root, path)?).map_err(|e| e.to_string())
}

/// Example patterns from `library-example/`, written into a brand-new library.
const SEED_PATTERNS: [(&str, &str); 3] = [
  ("mine/drums/four-on-the-floor.json", include_str!("../../library-example/mine/drums/four-on-the-floor.json")),
  ("mine/bass/acid-line.json", include_str!("../../library-example/mine/bass/acid-line.json")),
  ("mine/pads/warm-pad.json", include_str!("../../library-example/mine/pads/warm-pad.json")),
];

/// Creates the library folder if missing, seeding examples when it does, and checks it is writable.
pub fn ensure_library(root: &Path) -> Result<(), String> {
  let creating = !root.exists();
  fs::create_dir_all(root).map_err(|e| e.to_string())?;
  if creating {
    for (rel, json) in SEED_PATTERNS {
      let path = root.join(rel);
      if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
      }
      fs::write(&path, json).map_err(|e| e.to_string())?;
    }
  }
  let probe = root.join(".algobooth-write-check");
  fs::write(&probe, b"").map_err(|e| e.to_string())?;
  fs::remove_file(&probe).map_err(|e| e.to_string())
}

/// Thin Tauri wrappers. The library root is Rust's own (`LibraryRoot`), never the webview's: pattern
/// code runs with full IPC access, so the webview may only name paths inside the library.
pub mod commands {
  use std::path::PathBuf;
  use std::sync::Mutex;

  use tauri::State;

  use super::{Pattern, TreeNode};

  /// The library folder every library and watcher command works in. Read from the settings store at
  /// startup and replaced whenever `set_settings` saves a new `library_dir`.
  pub struct LibraryRoot(Mutex<PathBuf>);

  impl LibraryRoot {
    pub fn new(root: impl Into<PathBuf>) -> Self {
      LibraryRoot(Mutex::new(root.into()))
    }

    pub fn get(&self) -> Result<PathBuf, String> {
      self.0.lock().map(|root| root.clone()).map_err(|e| e.to_string())
    }

    pub fn set(&self, root: impl Into<PathBuf>) -> Result<(), String> {
      *self.0.lock().map_err(|e| e.to_string())? = root.into();
      Ok(())
    }
  }

  type Root<'a> = State<'a, LibraryRoot>;

  #[tauri::command]
  pub fn list_tree(root: Root<'_>) -> Result<TreeNode, String> {
    super::list_tree(&root.get()?)
  }

  #[tauri::command]
  pub fn read_pattern(root: Root<'_>, path: String) -> Result<Pattern, String> {
    super::read_pattern(&root.get()?, &path)
  }

  #[tauri::command]
  pub fn write_pattern(root: Root<'_>, heading_path: String, pattern: Pattern) -> Result<String, String> {
    super::write_pattern(&root.get()?, &heading_path, &pattern)
  }

  #[tauri::command]
  pub fn save_pattern(root: Root<'_>, path: String, pattern: Pattern) -> Result<(), String> {
    super::save_pattern(&root.get()?, &path, &pattern)
  }

  #[tauri::command]
  pub fn create_heading(root: Root<'_>, parent_path: String, name: String) -> Result<String, String> {
    super::create_heading(&root.get()?, &parent_path, &name)
  }

  #[tauri::command]
  pub fn rename_entry(root: Root<'_>, path: String, new_name: String) -> Result<String, String> {
    super::rename_entry(&root.get()?, &path, &new_name)
  }

  #[tauri::command]
  pub fn move_entry(root: Root<'_>, path: String, new_parent_path: String) -> Result<String, String> {
    super::move_entry(&root.get()?, &path, &new_parent_path)
  }

  #[tauri::command]
  pub fn delete_entry(root: Root<'_>, path: String) -> Result<(), String> {
    super::delete_entry(&root.get()?, &path)
  }

  #[tauri::command]
  pub fn ensure_library(root: Root<'_>) -> Result<(), String> {
    super::ensure_library(&root.get()?)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::path::Path;

  fn pattern(name: &str, code: &str) -> Pattern {
    Pattern {
      name: name.into(),
      code: code.into(),
      cpm: 120.0,
      key: String::new(),
      tags: vec![],
      source: Source::Mine,
      notes: String::new(),
      keys: None,
    }
  }

  fn child<'a>(node: &'a TreeNode, name: &str) -> &'a TreeNode {
    node.children.iter().find(|c| c.name == name).unwrap_or_else(|| panic!("no child {name}"))
  }

  #[test]
  fn tree_mirrors_folders_and_marks_bad_json_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("ripped/french house")).unwrap();
    fs::create_dir_all(root.join("mine")).unwrap();
    fs::write(
      root.join("ripped/french house/a.json"),
      r#"{"name":"Around","code":"s(\"bd*4\")","cpm":126,"key":"A minor","tags":["house"],
         "source":{"kind":"rip","url":"https://example.com","start":1,"end":9,"rippedAt":"2026-10-19"},"notes":""}"#,
    )
    .unwrap();
    fs::write(root.join("mine/b.json"), "not json {").unwrap();
    // Only invalid JSON or a missing `code` makes a file unreadable.
    fs::write(root.join("mine/c.json"), r#"{"name":"c","cpm":120}"#).unwrap();
    fs::write(root.join("mine/.hidden.json"), "{}").unwrap();
    fs::write(root.join(".DS_Store"), "x").unwrap();

    let tree = list_tree(root).unwrap();
    assert_eq!(tree.kind, NodeKind::Heading);
    assert_eq!(tree.path, "");
    let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["mine", "ripped"]);

    let ripped = child(&tree, "ripped");
    assert_eq!(ripped.kind, NodeKind::Heading);
    let fh = child(ripped, "french house");
    assert_eq!(fh.path, "ripped/french house");
    let a = child(fh, "Around");
    assert_eq!(a.kind, NodeKind::Pattern);
    assert_eq!(a.cpm, Some(126.0));
    assert_eq!(a.path, "ripped/french house/a.json");

    let mine = child(&tree, "mine");
    assert_eq!(mine.children.len(), 2);
    for n in ["b", "c"] {
      let leaf = child(mine, n);
      assert_eq!(leaf.kind, NodeKind::Unreadable);
      assert_eq!(leaf.cpm, None);
    }
    assert!(read_pattern(root, "mine/b.json").is_err());
    assert!(read_pattern(root, "mine/c.json").is_err());
  }

  #[test]
  fn tree_sorts_headings_first_then_case_insensitive() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir(root.join("zeta")).unwrap();
    fs::create_dir(root.join("Alpha")).unwrap();
    write_pattern(root, "", &pattern("beta", "x")).unwrap();
    write_pattern(root, "", &pattern("Able", "x")).unwrap();
    let tree = list_tree(root).unwrap();
    let names: Vec<_> = tree.children.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Alpha", "zeta", "Able", "beta"]);
  }

  #[test]
  fn kind_serialises_lowercase_and_source_matches_schema() {
    let json = serde_json::to_value(NodeKind::Unreadable).unwrap();
    assert_eq!(json, "unreadable");
    let mine = serde_json::to_value(pattern("n", "c")).unwrap();
    assert_eq!(mine["source"], serde_json::json!({ "kind": "mine" }));
    let rip = Source::Rip { url: Some("u".into()), start: Some(1.0), end: Some(2.0), ripped_at: Some("t".into()) };
    assert_eq!(
      serde_json::to_value(rip).unwrap(),
      serde_json::json!({ "kind": "rip", "url": "u", "start": 1.0, "end": 2.0, "rippedAt": "t" })
    );
  }

  #[test]
  fn hand_written_files_need_only_code() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("named.json"), r#"{"name":"Hand Made","code":"s(\"bd\")"}"#).unwrap();
    fs::write(root.join("bare-bones.json"), r#"{"code":"s(\"hh\")"}"#).unwrap();
    let named = read_pattern(root, "named.json").unwrap();
    assert_eq!((named.name.as_str(), named.cpm), ("Hand Made", 120.0));
    assert_eq!(named.source, Source::Mine);
    let bare = read_pattern(root, "bare-bones.json").unwrap();
    assert_eq!((bare.name.as_str(), bare.code.as_str(), bare.cpm), ("bare-bones", "s(\"hh\")", 120.0));
    let tree = list_tree(root).unwrap();
    assert!(tree.children.iter().all(|c| c.kind == NodeKind::Pattern && c.cpm == Some(120.0)));
    assert!(tree.children.iter().any(|c| c.name == "bare-bones"));
  }

  #[test]
  fn read_tolerates_missing_optional_fields() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("p.json"), r#"{"name":"p","code":"c","cpm":120,"source":{"kind":"mine"}}"#).unwrap();
    let p = read_pattern(dir.path(), "p.json").unwrap();
    assert_eq!(p.key, "");
    assert!(p.tags.is_empty());
    assert_eq!(p.notes, "");
  }

  #[test]
  fn write_then_read_round_trips_and_keeps_real_name() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let mut p = pattern("Acid: Line/2", "note(\"c2\")");
    p.source = Source::Rip { url: Some("https://x".into()), start: Some(3.0), end: None, ripped_at: None };
    let rel = write_pattern(root, "mine/bass", &p).unwrap();
    assert_eq!(rel, "mine/bass/acid-line-2.json");
    let back = read_pattern(root, &rel).unwrap();
    assert_eq!(back.name, "Acid: Line/2");
    assert_eq!(back, p);
  }

  #[test]
  fn write_collision_suffixes() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    assert_eq!(write_pattern(root, "mine", &pattern("x", "one")).unwrap(), "mine/x.json");
    assert_eq!(write_pattern(root, "mine", &pattern("x", "two")).unwrap(), "mine/x-2.json");
    assert_eq!(write_pattern(root, "mine", &pattern("x", "three")).unwrap(), "mine/x-3.json");
    assert_eq!(read_pattern(root, "mine/x.json").unwrap().code, "one");
    assert_eq!(read_pattern(root, "mine/x-2.json").unwrap().code, "two");
  }

  #[test]
  fn ensure_library_creates_missing_and_reports_unwritable() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("Algobooth/library");
    ensure_library(&missing).unwrap();
    assert!(missing.is_dir());

    let locked = dir.path().join("locked");
    fs::create_dir(&locked).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).unwrap();
    let under = ensure_library(&locked.join("library"));
    let itself = ensure_library(&locked);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(under.is_err(), "creating under a read-only dir must fail");
    assert!(itself.is_err(), "an existing read-only dir must fail");
  }

  #[test]
  fn ensure_library_seeds_examples_only_when_creating() {
    let dir = tempfile::tempdir().unwrap();
    let fresh = dir.path().join("fresh");
    ensure_library(&fresh).unwrap();
    for rel in ["mine/drums/four-on-the-floor.json", "mine/bass/acid-line.json", "mine/pads/warm-pad.json"] {
      let p = read_pattern(&fresh, rel).unwrap();
      assert!(p.code.starts_with("setcpm("), "{rel} should start with setcpm");
    }
    assert_eq!(read_pattern(&fresh, "mine/bass/acid-line.json").unwrap().cpm, 126.0);

    let empty = dir.path().join("empty");
    fs::create_dir(&empty).unwrap();
    ensure_library(&empty).unwrap();
    assert_eq!(fs::read_dir(&empty).unwrap().count(), 0, "an existing empty folder stays empty");
  }

  #[test]
  fn move_and_rename_keep_json_in_sync() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let rel = write_pattern(root, "mine", &pattern("old name", "c")).unwrap();
    let renamed = rename_entry(root, &rel, "New: Name").unwrap();
    assert_eq!(renamed, "mine/new-name.json");
    assert!(!root.join(&rel).exists());
    assert_eq!(read_pattern(root, &renamed).unwrap().name, "New: Name");

    let heading = create_heading(root, "", "french house").unwrap();
    assert_eq!(heading, "french house");
    let moved = move_entry(root, &renamed, &heading).unwrap();
    assert_eq!(moved, "french house/new-name.json");
    assert_eq!(read_pattern(root, &moved).unwrap().name, "New: Name");

    let heading2 = rename_entry(root, "french house", "deep house").unwrap();
    assert_eq!(heading2, "deep house");
    assert!(root.join("deep house/new-name.json").is_file());

    let nested = move_entry(root, "deep house", "mine").unwrap();
    assert_eq!(nested, "mine/deep house");
    assert!(move_entry(root, "mine", "mine/deep house").is_err(), "a heading cannot move into itself");
  }

  #[test]
  fn move_suffixes_on_collision() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write_pattern(root, "a", &pattern("x", "one")).unwrap();
    let other = write_pattern(root, "b", &pattern("x", "two")).unwrap();
    assert_eq!(move_entry(root, &other, "a").unwrap(), "a/x-2.json");
  }

  #[test]
  fn create_heading_rejects_unsafe_names() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    for bad in ["", "  ", "a/b", ".hidden", "..", "a\\b"] {
      assert!(create_heading(root, "", bad).is_err(), "{bad:?} should be rejected");
    }
    create_heading(root, "", "dup").unwrap();
    assert!(create_heading(root, "", "dup").is_err());
  }

  #[test]
  fn every_command_rejects_paths_escaping_the_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("lib");
    fs::create_dir(&root).unwrap();
    fs::write(dir.path().join("outside.json"), r#"{"name":"o","code":"c","cpm":1}"#).unwrap();
    let rel = write_pattern(&root, "", &pattern("in", "c")).unwrap();
    let outside = dir.path().join("outside.json").to_string_lossy().into_owned();
    let p = pattern("x", "c");

    for bad in ["../outside.json", "a/../../outside.json", outside.as_str(), "/etc"] {
      assert!(read_pattern(&root, bad).is_err(), "read {bad}");
      assert!(write_pattern(&root, bad, &p).is_err(), "write {bad}");
      assert!(create_heading(&root, bad, "h").is_err(), "create {bad}");
      assert!(rename_entry(&root, bad, "y").is_err(), "rename {bad}");
      assert!(move_entry(&root, bad, "").is_err(), "move src {bad}");
      assert!(move_entry(&root, &rel, bad).is_err(), "move dest {bad}");
      assert!(delete_entry(&root, bad).is_err(), "delete {bad}");
      assert!(save_pattern(&root, bad, &p).is_err(), "save {bad}");
    }
    assert!(delete_entry(&root, "").is_err(), "the root itself cannot be deleted");
    assert!(rename_entry(&root, "", "y").is_err(), "the root itself cannot be renamed");
    assert!(dir.path().join("outside.json").is_file());
    assert!(root.join(&rel).is_file());
  }

  #[test]
  fn symlink_out_of_root_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("lib");
    fs::create_dir(&root).unwrap();
    fs::create_dir(dir.path().join("elsewhere")).unwrap();
    std::os::unix::fs::symlink(dir.path().join("elsewhere"), root.join("link")).unwrap();
    assert!(write_pattern(&root, "link", &pattern("x", "c")).is_err());
    assert!(write_pattern(&root, "link/new/sub", &pattern("x", "c")).is_err());
    assert!(!dir.path().join("elsewhere/new").exists());
    assert!(!dir.path().join("elsewhere/x.json").exists());
    assert!(list_tree(&root).unwrap().children.is_empty(), "symlinks are not followed");
  }

  #[test]
  fn save_overwrites_in_place_and_keeps_the_filename() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let rel = write_pattern(root, "mine", &pattern("x", "old")).unwrap();
    let mut edited = pattern("Renamed Elsewhere", "new");
    edited.cpm = 126.0;
    save_pattern(root, &rel, &edited).unwrap();
    assert_eq!(read_pattern(root, &rel).unwrap(), edited);
    let names: Vec<_> = fs::read_dir(root.join("mine")).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names, ["x.json"]);
  }

  #[test]
  fn save_rejects_missing_non_json_and_escaping_paths() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("lib");
    fs::create_dir_all(root.join("mine")).unwrap();
    fs::write(root.join("mine/notes.txt"), "x").unwrap();
    fs::write(dir.path().join("outside.json"), r#"{"name":"o","code":"c","cpm":1}"#).unwrap();
    let p = pattern("x", "c");
    assert!(save_pattern(&root, "mine/missing.json", &p).is_err());
    assert!(!root.join("mine/missing.json").exists());
    assert!(save_pattern(&root, "mine", &p).is_err(), "a heading is not a file");
    assert!(save_pattern(&root, "mine/notes.txt", &p).is_err());
    assert!(save_pattern(&root, "../outside.json", &p).is_err());
    let abs = dir.path().join("outside.json").to_string_lossy().into_owned();
    assert!(save_pattern(&root, &abs, &p).is_err());
    assert_eq!(read_pattern(dir.path(), "outside.json").unwrap().code, "c");
  }

  #[test]
  fn library_root_is_replaced_when_settings_change() {
    let root = commands::LibraryRoot::new("/first/library");
    assert_eq!(root.get().unwrap(), Path::new("/first/library"));
    root.set("/second/library").unwrap();
    assert_eq!(root.get().unwrap(), Path::new("/second/library"));
  }

  #[test]
  fn keys_round_trip_and_are_absent_when_none() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let p = Pattern { name: "k".into(), code: "c".into(), cpm: 120.0, key: String::new(), tags: vec![], source: Source::Mine, notes: String::new(), keys: None };
    let path = write_pattern(root, "", &p).unwrap();
    let text = fs::read_to_string(root.join(&path)).unwrap();
    assert!(!text.contains("\"keys\""));
    let with = Pattern { keys: Some(serde_json::json!({"bindings": {"KeyQ": {"kind":"method","name":"lpenv","snippet":".lpenv(2)","argRange":[7,8]}}})), ..p.clone() };
    save_pattern(root, &path, &with).unwrap();
    assert_eq!(read_pattern(root, &path).unwrap().keys, with.keys);
  }
}
