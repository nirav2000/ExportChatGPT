#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
    sync::Mutex,
};
use zip::ZipArchive;

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
    fingerprint: Option<String>,
    exported_fingerprint: Option<String>,
}

#[derive(Serialize)]
struct Diagnostics {
    queued_jobs: i64,
    failed_jobs: i64,
    resumable_jobs: i64,
    missing_markdown_exports: i64,
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
    rawHtml: Option<String>,
}

#[derive(Deserialize)]
struct OfficialConversation {
    id: Option<String>,
    title: Option<String>,
    create_time: Option<f64>,
    update_time: Option<f64>,
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
          exported_fingerprint TEXT,
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
          last_error TEXT,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        ",
    )?;
    Ok(())
}

fn ensure_default_workspace(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO workspaces (id, name) VALUES ('default', 'Default Workspace')",
        [],
    )?;
    Ok(())
}

fn chat_fingerprint(conn: &Connection, chat_id: &str) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare("SELECT role, body FROM messages WHERE chat_id = ?1 ORDER BY id")?;
    let rows = stmt.query_map(params![chat_id], |row| {
        let role: String = row.get(0)?;
        let body: String = row.get(1)?;
        Ok(format!("{}:{}", role, body))
    })?;

    let mut hasher = Sha256::new();
    for row in rows {
        hasher.update(row.unwrap_or_default());
        hasher.update("\n");
    }
    Ok(hex::encode(hasher.finalize()))
}

#[tauri::command]
fn diagnostics_health(state: tauri::State<AppState>) -> Result<Health, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    ensure_default_workspace(&conn).map_err(|e| e.to_string())?;
    Ok(Health {
        status: "ok".into(),
    })
}

#[tauri::command]
fn diagnostics_report(state: tauri::State<AppState>) -> Result<Diagnostics, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    let queued_jobs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM export_jobs WHERE status = 'queued'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let failed_jobs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM export_jobs WHERE status = 'failed'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let resumable_jobs: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM export_jobs WHERE status IN ('failed', 'running')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let missing_markdown_exports: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chats WHERE exported_fingerprint IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(Diagnostics {
        queued_jobs,
        failed_jobs,
        resumable_jobs,
        missing_markdown_exports,
    })
}

#[tauri::command]
fn list_projects_chats(state: tauri::State<AppState>) -> Result<Vec<ProjectChatRow>, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "
            SELECT p.name as project_name, c.title as chat_title, COUNT(m.id) as message_count, c.fingerprint, c.exported_fingerprint
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
                fingerprint: row.get(3)?,
                exported_fingerprint: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok(rows)
}

#[tauri::command]
fn import_capture_bundle(state: tauri::State<AppState>, bundle_json: String) -> Result<String, String> {
    let bundle: CaptureBundle =
        serde_json::from_str(&bundle_json).map_err(|e| format!("invalid bundle: {}", e))?;
    let mut conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?1, ?2)",
        params![
            bundle.workspace.id,
            bundle
                .workspace
                .name
                .unwrap_or("Default Workspace".to_string())
        ],
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
        )
        .map_err(|e| e.to_string())?;
    }

    for m in bundle.messages {
        tx.execute(
            "INSERT OR REPLACE INTO messages (id, chat_id, role, body) VALUES (?1, ?2, ?3, ?4)",
            params![m.id, m.chatId, m.role, m.rawHtml.unwrap_or_default()],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok("Capture bundle imported successfully".to_string())
}

#[tauri::command]
fn import_official_export_zip(state: tauri::State<AppState>, zip_path: String) -> Result<String, String> {
    let file = fs::File::open(&zip_path).map_err(|e| format!("zip open failed: {}", e))?;
    let mut archive = ZipArchive::new(file).map_err(|e| format!("invalid zip: {}", e))?;
    let mut conversations = String::new();

    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        if f.name().ends_with("conversations.json") {
            f.read_to_string(&mut conversations)
                .map_err(|e| e.to_string())?;
            break;
        }
    }

    if conversations.is_empty() {
        return Err("conversations.json not found in official export zip".to_string());
    }

    let parsed: Vec<OfficialConversation> =
        serde_json::from_str(&conversations).map_err(|e| format!("json parse failed: {}", e))?;
    let mut conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    ensure_default_workspace(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, workspace_id, name) VALUES ('imported', 'default', 'Unassigned / Imported')",
        [],
    )
    .map_err(|e| e.to_string())?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for c in parsed {
        let id = c.id.unwrap_or(format!("official-{}", rand_id()));
        tx.execute(
            "INSERT OR REPLACE INTO chats (id, workspace_id, project_id, title, updated_at) VALUES (?1, 'default', 'imported', ?2, ?3)",
            params![id, c.title.unwrap_or("Untitled Chat".to_string()), c.update_time.map(|v| v.to_string())],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(format!("Imported {} official conversations", parsed.len()))
}

fn rand_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{}", now)
}

fn write_chat_export(conn: &Connection, root: &str, chat_id: &str, title: &str) -> Result<(), String> {
    let folder = sanitize_for_fs(&format!("{} - {}", chat_id, title));
    let dir = Path::new(root).join("Project Archivist Export").join("standalone-chats").join(folder);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, role, body FROM messages WHERE chat_id = ?1 ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![chat_id], |row| {
            let id: String = row.get(0)?;
            let role: String = row.get(1)?;
            let body: String = row.get(2)?;
            Ok((id, role, body))
        })
        .map_err(|e| e.to_string())?;

    let mut md = String::new();
    let mut json_lines: Vec<serde_json::Value> = Vec::new();
    for row in rows {
        let (id, role, body) = row.map_err(|e| e.to_string())?;
        md.push_str(&format!("### {}\n\n{}\n\n---\n\n", role, body));
        json_lines.push(serde_json::json!({ "id": id, "role": role, "body": body }));
    }

    fs::write(dir.join("chat.md"), md).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("chat.json"),
        serde_json::to_string_pretty(&serde_json::json!({ "id": chat_id, "title": title, "messages": json_lines }))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut html_file = fs::File::create(dir.join("chat.html")).map_err(|e| e.to_string())?;
    html_file
        .write_all(format!("<html><body><h1>{}</h1><pre>{}</pre></body></html>", title, md).as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn sanitize_for_fs(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect::<String>()
}

#[tauri::command]
fn queue_export_job(
    state: tauri::State<AppState>,
    target: String,
    mode: String,
    root_dir: String,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO export_jobs (target, mode, root_dir, status) VALUES (?1, ?2, ?3, 'queued')",
        params![target, mode, root_dir],
    )
    .map_err(|e| e.to_string())?;
    Ok("Export job queued".to_string())
}

#[tauri::command]
fn run_pending_export_jobs(state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, mode, root_dir FROM export_jobs WHERE status IN ('queued', 'failed') ORDER BY id")
        .map_err(|e| e.to_string())?;
    let jobs: Vec<(i64, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    for (job_id, mode, root_dir) in &jobs {
        conn.execute(
            "UPDATE export_jobs SET status='running', updated_at=CURRENT_TIMESTAMP WHERE id=?1",
            params![job_id],
        )
        .map_err(|e| e.to_string())?;

        let mut chat_stmt = conn
            .prepare("SELECT id, title, fingerprint, exported_fingerprint FROM chats")
            .map_err(|e| e.to_string())?;
        let chats = chat_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut any_error = None;
        for c in chats {
            let (chat_id, title, current_fp, exported_fp) = c.map_err(|e| e.to_string())?;
            let live_fp = if let Some(fp) = current_fp {
                fp
            } else {
                chat_fingerprint(&conn, &chat_id).map_err(|e| e.to_string())?
            };

            let should_skip = match mode.as_str() {
                "force" => false,
                "repair_assets" => exported_fp.is_some(),
                _ => exported_fp.as_deref() == Some(live_fp.as_str()),
            };
            if should_skip {
                continue;
            }

            if let Err(e) = write_chat_export(&conn, root_dir, &chat_id, &title) {
                any_error = Some(e);
                break;
            }
            conn.execute(
                "UPDATE chats SET exported_fingerprint = ?1 WHERE id = ?2",
                params![live_fp, chat_id],
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(err) = any_error {
            conn.execute(
                "UPDATE export_jobs SET status='failed', last_error=?1, updated_at=CURRENT_TIMESTAMP WHERE id=?2",
                params![err, job_id],
            )
            .map_err(|e| e.to_string())?;
        } else {
            conn.execute(
                "UPDATE export_jobs SET status='complete', last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?1",
                params![job_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(format!("Processed {} export jobs", jobs.len()))
}

fn main() {
    let conn = Connection::open("project_archivist.db").expect("open sqlite db");
    init_schema(&conn).expect("init schema");
    ensure_default_workspace(&conn).expect("default workspace");

    tauri::Builder::default()
        .manage(AppState {
            conn: Mutex::new(conn),
        })
        .invoke_handler(tauri::generate_handler![
            diagnostics_health,
            diagnostics_report,
            list_projects_chats,
            import_capture_bundle,
            import_official_export_zip,
            queue_export_job,
            run_pending_export_jobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
