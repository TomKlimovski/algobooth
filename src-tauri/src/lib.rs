mod library;
mod service;
mod settings;
mod slug;
mod watcher;
mod webview;

use tauri::Manager;

// TODO(packaging milestone): tauri.conf.json sets `app.security.csp` to null because the Strudel editor
// needs `eval` and inline scripts. Write a real CSP when the app is packaged (spec milestone 6).
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(watcher::commands::WatcherState::default())
    .manage(service::ServiceState::default())
    .invoke_handler(tauri::generate_handler![
      settings::get_settings,
      settings::set_settings,
      library::commands::list_tree,
      library::commands::read_pattern,
      library::commands::write_pattern,
      library::commands::save_pattern,
      library::commands::create_heading,
      library::commands::rename_entry,
      library::commands::move_entry,
      library::commands::delete_entry,
      library::commands::ensure_library,
      watcher::commands::watch_library,
      service::commands::service_info,
      service::commands::restart_service,
    ])
    .setup(|app| {
      webview::create_main_window(app)?;
      // Rust owns the library root: commands never take it from the webview.
      let library_dir = settings::load(app.handle()).library_dir;
      app.manage(library::commands::LibraryRoot::new(library_dir));
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      // Launch on a thread: the first start can take seconds and must not hold up the window.
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        let _ = handle.state::<service::ServiceState>().start(&handle);
      });
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        app.state::<service::ServiceState>().stop();
      }
    });
}
