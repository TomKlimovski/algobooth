mod library;
mod settings;
mod slug;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![
      settings::get_settings,
      settings::set_settings,
      library::commands::list_tree,
      library::commands::read_pattern,
      library::commands::write_pattern,
      library::commands::create_heading,
      library::commands::rename_entry,
      library::commands::move_entry,
      library::commands::delete_entry,
      library::commands::ensure_library,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
