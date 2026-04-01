#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

struct AppState {
    conn: Mutex<Connection>,
}

#[derive(Serialize, Deserialize)]
struct Health {
    status: String,
}

#[derive(Serialize)]
struct ProjectChatRow {
    project_name: Option<String>,
    chat_title: Option<String>,
    message_count: i64,
}

#[derive(Deserialize)]
struct CaptureBundle {
    workspace: Workspace,
    projects: Vec<Project>,
    chats: Vec<Chat>,
    messages: Vec<Message>,
}

#[derive(Deserialize)]
struct Workspace {
    id: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct Project {
    id: String,
    name: String,
}

#[derive(Deserialize)]
struct Chat {
    id: String,
    projectId: Option<String>,
    title: String,
    fingerprint: Option<String>,
    updatedAt: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    id: String,
    chatId: String,
    role: String,
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT,
          title TEXT NOT NULL,
          fingerprint TEXT,
          updated_at TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
          role TEXT NOT NULL,
          body TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS export_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          target TEXT NOT NULL,
          mode TEXT NOT NULL,
          root_dir TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;
    Ok(())
}

#[tauri::command]
fn diagnostics_health(state: tauri::State<AppState>) -> Result<Health, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    Ok(Health { status: "ok".into() })
}

#[tauri::command]
fn list_projects_chats(state: tauri::State<AppState>) -> Result<Vec<ProjectChatRow>, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "
            SELECT p.name as project_name, c.title as chat_title, COUNT(m.id) as message_count
            FROM chats c
            LEFT JOIN projects p ON p.id = c.project_id
            LEFT JOIN messages m ON m.chat_id = c.id
            GROUP BY c.id
            ORDER BY COALESCE(p.name, 'Unassigned'), c.title
            ",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectChatRow {
                project_name: row.get(0)?,
                chat_title: row.get(1)?,
                message_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(rows)
}

#[tauri::command]
fn import_capture_bundle(state: tauri::State<AppState>, bundle_json: String) -> Result<String, String> {
    let bundle: CaptureBundle = serde_json::from_str(&bundle_json).map_err(|e| format!("invalid bundle: {}", e))?;
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?1, ?2)",
        params![bundle.workspace.id, bundle.workspace.name.unwrap_or("Default Workspace".to_string())],
    )
    .map_err(|e| e.to_string())?;

    for p in bundle.projects {
        tx.execute(
            "INSERT OR REPLACE INTO projects (id, workspace_id, name) VALUES (?1, ?2, ?3)",
            params![p.id, "default", p.name],
        )
        .map_err(|e| e.to_string())?;
    }

    for c in bundle.chats {
        tx.execute(
            "INSERT OR REPLACE INTO chats (id, workspace_id, project_id, title, fingerprint, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![c.id, "default", c.projectId, c.title, c.fingerprint, c.updatedAt],
        ).map_err(|e| e.to_string())?;
    }

    for m in bundle.messages {
        tx.execute(
            "INSERT OR REPLACE INTO messages (id, chat_id, role, body) VALUES (?1, ?2, ?3, ?4)",
            params![m.id, m.chatId, m.role, ""],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok("Capture bundle imported successfully".to_string())
}

#[tauri::command]
fn queue_export_job(state: tauri::State<AppState>, target: String, mode: String, root_dir: String) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO export_jobs (target, mode, root_dir, status) VALUES (?1, ?2, ?3, 'queued')",
        params![target, mode, root_dir],
    )
    .map_err(|e| e.to_string())?;
    Ok("Export job queued".to_string())
}

fn main() {
    let conn = Connection::open("project_archivist.db").expect("open sqlite db");
    init_schema(&conn).expect("init schema");

    tauri::Builder::default()
        .manage(AppState {
            conn: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            diagnostics_health,
            list_projects_chats,
            import_capture_bundle,
            queue_export_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
