#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Health {
    status: String,
}

#[tauri::command]
fn diagnostics_health() -> Health {
    let _conn = Connection::open_in_memory().expect("sqlite in-memory startup");
    Health { status: "ok".into() }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![diagnostics_health])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
