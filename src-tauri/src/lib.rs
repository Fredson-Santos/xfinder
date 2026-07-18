mod commands;
mod db;
mod m3u;
mod xtream;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Resolve app data directory and initialise SQLite
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to resolve app data directory");
            std::fs::create_dir_all(&app_dir)?;

            let db_path = app_dir.join("xfinder.db");
            let state = db::init(db_path.to_str().unwrap()).expect("Failed to initialise database");
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_servers,
            commands::add_server,
            commands::remove_server,
            commands::sync_server,
            commands::search,
            commands::get_episodes,
            commands::open_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XFinder");
}
