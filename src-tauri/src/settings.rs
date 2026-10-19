use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::library::commands::LibraryRoot;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Visualiser {
  Pianoroll,
  Scope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Engine {
  Webaudio,
  Superdirt,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
  pub library_dir: String,
  pub visualiser: Visualiser,
  pub engine: Engine,
}

pub fn default_settings() -> Settings {
  let home = dirs::home_dir().unwrap_or_default();
  Settings {
    library_dir: home.join("Algobooth").join("library").to_string_lossy().into_owned(),
    visualiser: Visualiser::Pianoroll,
    engine: Engine::Webaudio,
  }
}

/// Reads settings from `path`; a missing or unreadable file yields the defaults.
pub fn read_settings(path: &Path) -> Settings {
  fs::read_to_string(path).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_else(default_settings)
}

/// Writes settings atomically: a temp file in the same directory, then a rename.
pub fn write_settings(path: &Path, settings: &Settings) -> Result<(), String> {
  let dir = path.parent().ok_or("settings path has no parent")?;
  fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  let tmp = path.with_extension("json.tmp");
  let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
  fs::write(&tmp, text).map_err(|e| e.to_string())?;
  fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
  Ok(dir.join("settings.json"))
}

/// The stored settings, or the defaults when the config dir or file cannot be read.
pub fn load(app: &tauri::AppHandle) -> Settings {
  match settings_path(app) {
    Ok(path) => read_settings(&path),
    Err(_) => default_settings(),
  }
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
  load(&app)
}

/// Saves the settings and points the library commands at the new `library_dir`.
#[tauri::command]
pub fn set_settings(
  app: tauri::AppHandle,
  root: tauri::State<'_, LibraryRoot>,
  settings: Settings,
) -> Result<(), String> {
  write_settings(&settings_path(&app)?, &settings)?;
  root.set(&settings.library_dir)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn defaults_use_home_library() {
    let s = default_settings();
    let home = dirs::home_dir().unwrap();
    assert_eq!(s.library_dir, home.join("Algobooth").join("library").to_string_lossy());
    assert_eq!(s.visualiser, Visualiser::Pianoroll);
    assert_eq!(s.engine, Engine::Webaudio);
  }

  #[test]
  fn round_trips_through_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested").join("settings.json");
    let s = Settings { library_dir: "/tmp/lib".into(), visualiser: Visualiser::Scope, engine: Engine::Webaudio };
    write_settings(&path, &s).unwrap();
    assert_eq!(read_settings(&path), s);
    assert!(!path.with_extension("json.tmp").exists());
  }

  #[test]
  fn serialises_with_lowercase_names() {
    let json = serde_json::to_string(&default_settings()).unwrap();
    assert!(json.contains("\"visualiser\":\"pianoroll\""));
    assert!(json.contains("\"engine\":\"webaudio\""));
  }

  #[test]
  fn missing_file_gives_defaults() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(read_settings(&dir.path().join("none.json")), default_settings());
  }
}
