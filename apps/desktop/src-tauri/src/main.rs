#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
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

#[derive(Serialize, Clone)]
struct ArchiveChatNode {
    id: String,
    title: String,
    project_id: Option<String>,
    project_name: Option<String>,
    message_count: i64,
    image_count: i64,
    changed: bool,
}

#[derive(Serialize, Clone)]
struct ArchiveProjectNode {
    id: String,
    name: String,
    chats: Vec<ArchiveChatNode>,
    changed: bool,
}

#[derive(Serialize)]
struct ArchiveTree {
    projects: Vec<ArchiveProjectNode>,
    standalone: Vec<ArchiveChatNode>,
}

#[derive(Deserialize)]
struct CaptureBundle {
    workspace: Workspace,
    projects: Vec<Project>,
    chats: Vec<Chat>,
    messages: Vec<Message>,
    #[serde(default)]
    assets: Vec<Asset>,
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
    #[serde(rename = "projectId")]
    project_id: Option<String>,
    title: String,
    fingerprint: Option<String>,
    #[serde(rename = "updatedAt")]
    updated_at: Option<String>,
}

#[derive(Deserialize)]
struct Message {
    id: String,
    #[serde(rename = "chatId")]
    chat_id: String,
    role: String,
    #[serde(rename = "rawHtml")]
    raw_html: Option<String>,
}

#[derive(Deserialize)]
struct Asset {
    id: String,
    #[serde(rename = "chatId")]
    chat_id: String,
}

#[derive(Deserialize)]
struct OfficialConversation {
    id: Option<String>,
    title: Option<String>,
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
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          chat_id TEXT NOT NULL,
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
        CREATE TABLE IF NOT EXISTS imported_capture_files (
          path TEXT PRIMARY KEY,
          file_hash TEXT UNIQUE NOT NULL,
          imported_at TEXT DEFAULT CURRENT_TIMESTAMP
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

fn hash_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
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

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[tauri::command]
fn diagnostics_health(state: tauri::State<AppState>) -> Result<Health, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    ensure_default_workspace(&conn).map_err(|e| e.to_string())?;
    Ok(Health { status: "ok".into() })
}

#[tauri::command]
fn diagnostics_report(state: tauri::State<AppState>) -> Result<Diagnostics, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    let queued_jobs: i64 = conn
        .query_row("SELECT COUNT(*) FROM export_jobs WHERE status = 'queued'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let failed_jobs: i64 = conn
        .query_row("SELECT COUNT(*) FROM export_jobs WHERE status = 'failed'", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let resumable_jobs: i64 = conn
        .query_row("SELECT COUNT(*) FROM export_jobs WHERE status IN ('failed', 'running')", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let missing_markdown_exports: i64 = conn
        .query_row("SELECT COUNT(*) FROM chats WHERE exported_fingerprint IS NULL", [], |row| row.get(0))
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
fn list_archive_tree(state: tauri::State<AppState>) -> Result<ArchiveTree, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "
            SELECT
              c.id,
              c.title,
              c.project_id,
              p.name,
              COUNT(DISTINCT m.id) as message_count,
              COUNT(DISTINCT a.id) as image_count,
              CASE WHEN c.fingerprint IS NOT NULL AND c.exported_fingerprint IS NOT NULL AND c.fingerprint = c.exported_fingerprint THEN 0 ELSE 1 END as changed
            FROM chats c
            LEFT JOIN projects p ON p.id = c.project_id
            LEFT JOIN messages m ON m.chat_id = c.id
            LEFT JOIN assets a ON a.chat_id = c.id
            GROUP BY c.id, c.title, c.project_id, p.name, c.fingerprint, c.exported_fingerprint
            ORDER BY COALESCE(p.name, ''), c.title
            ",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<ArchiveChatNode> = stmt
        .query_map([], |row| {
            Ok(ArchiveChatNode {
                id: row.get(0)?,
                title: row.get(1)?,
                project_id: row.get(2)?,
                project_name: row.get(3)?,
                message_count: row.get(4)?,
                image_count: row.get(5)?,
                changed: row.get::<_, i64>(6)? != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let mut by_project: HashMap<String, ArchiveProjectNode> = HashMap::new();
    let mut standalone = Vec::new();

    for chat in rows {
        if let (Some(pid), Some(pname)) = (chat.project_id.clone(), chat.project_name.clone()) {
            let entry = by_project.entry(pid.clone()).or_insert_with(|| ArchiveProjectNode {
                id: pid.clone(),
                name: pname.clone(),
                chats: vec![],
                changed: false,
            });
            if chat.changed {
                entry.changed = true;
            }
            entry.chats.push(chat);
        } else {
            standalone.push(chat);
        }
    }

    let mut projects: Vec<ArchiveProjectNode> = by_project.into_values().collect();
    projects.sort_by(|a, b| a.name.cmp(&b.name));
    standalone.sort_by(|a, b| a.title.cmp(&b.title));

    Ok(ArchiveTree { projects, standalone })
}

#[tauri::command]
fn delete_archive_items(
    state: tauri::State<AppState>,
    project_ids: Vec<String>,
    chat_ids: Vec<String>,
) -> Result<String, String> {
    let mut conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut all_chat_ids: Vec<String> = chat_ids.clone();

    for pid in &project_ids {
        let mut stmt = tx
            .prepare("SELECT id FROM chats WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pid], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok(cid) = row {
                all_chat_ids.push(cid);
            }
        }
    }

    all_chat_ids.sort();
    all_chat_ids.dedup();

    for cid in &all_chat_ids {
        tx.execute("DELETE FROM assets WHERE chat_id = ?1", params![cid])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM messages WHERE chat_id = ?1", params![cid])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM chats WHERE id = ?1", params![cid])
            .map_err(|e| e.to_string())?;
    }

    for pid in &project_ids {
        tx.execute("DELETE FROM projects WHERE id = ?1", params![pid])
            .map_err(|e| e.to_string())?;
    }

    tx.execute(
        "DELETE FROM projects WHERE id NOT IN (SELECT DISTINCT project_id FROM chats WHERE project_id IS NOT NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(format!("Removed {} chat(s) and {} project(s)", all_chat_ids.len(), project_ids.len()))
}

fn rand_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{}", now)
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
            bundle.workspace.name.unwrap_or("Default Workspace".to_string())
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
            params![c.id, "default", c.project_id, c.title, c.fingerprint, c.updated_at],
        )
        .map_err(|e| e.to_string())?;
    }

    for m in bundle.messages {
        tx.execute(
            "INSERT OR REPLACE INTO messages (id, chat_id, role, body) VALUES (?1, ?2, ?3, ?4)",
            params![m.id, m.chat_id, m.role, m.raw_html.unwrap_or_default()],
        )
        .map_err(|e| e.to_string())?;
    }

    for a in bundle.assets {
        tx.execute(
            "INSERT OR REPLACE INTO assets (id, chat_id) VALUES (?1, ?2)",
            params![a.id, a.chat_id],
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
            f.read_to_string(&mut conversations).map_err(|e| e.to_string())?;
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

    let imported_count = parsed.len();
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
    Ok(format!("Imported {} official conversations", imported_count))
}

fn write_chat_export(conn: &Connection, root: &str, chat_id: &str, title: &str) -> Result<(), String> {
    let project_name: Option<String> = conn
        .query_row(
            "SELECT p.name FROM chats c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?1",
            params![chat_id],
            |row| row.get(0),
        )
        .ok();

    let folder = sanitize_for_fs(&format!("{} - {}", chat_id, title));
    let dir = if let Some(project_name) = project_name {
        Path::new(root)
            .join("Project Archivist Export")
            .join("projects")
            .join(sanitize_for_fs(&project_name))
            .join("chats")
            .join(folder)
    } else {
        Path::new(root)
            .join("Project Archivist Export")
            .join("standalone-chats")
            .join(folder)
    };
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

    fs::write(dir.join("chat.md"), &md).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("chat.json"),
        serde_json::to_string_pretty(&serde_json::json!({ "id": chat_id, "title": title, "messages": json_lines }))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let html = format!(
        "<html><body><h1>{}</h1><pre>{}</pre></body></html>",
        escape_html(title),
        escape_html(&md)
    );
    fs::write(dir.join("chat.html"), html).map_err(|e| e.to_string())?;
    Ok(())
}

fn build_archive_index_html(conn: &Connection, root: &str) -> Result<(), String> {
    let export_root = Path::new(root).join("Project Archivist Export");
    fs::create_dir_all(&export_root).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "
            SELECT c.id, c.title, p.name
            FROM chats c
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.exported_fingerprint IS NOT NULL
            ORDER BY COALESCE(p.name, ''), c.title
            ",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, Option<String>)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let mut projects: HashMap<String, Vec<(String, String)>> = HashMap::new();
    let mut standalone: Vec<(String, String)> = vec![];

    for (chat_id, title, project_name) in rows {
        let folder = sanitize_for_fs(&format!("{} - {}", chat_id, title));
        if let Some(project_name) = project_name {
            let project_folder = sanitize_for_fs(&project_name);
            let rel = format!("projects/{}/chats/{}/chat.html", project_folder, folder);
            projects.entry(project_name).or_default().push((title, rel));
        } else {
            let rel = format!("standalone-chats/{}/chat.html", folder);
            standalone.push((title, rel));
        }
    }

    let mut project_sections = String::new();
    let mut project_names: Vec<String> = projects.keys().cloned().collect();
    project_names.sort();

    for pname in project_names {
        let mut chats = projects.remove(&pname).unwrap_or_default();
        chats.sort_by(|a, b| a.0.cmp(&b.0));
        let items = chats
            .into_iter()
            .map(|(title, rel)| format!(r#"<li class="chat-item"><a href="{}" target="_blank">{}</a></li>"#, rel, escape_html(&title)))
            .collect::<Vec<_>>()
            .join("");
        project_sections.push_str(&format!(
            r#"<details open class="project-group"><summary>{}</summary><ul>{}</ul></details>"#,
            escape_html(&pname),
            items
        ));
    }

    standalone.sort_by(|a, b| a.0.cmp(&b.0));
    let standalone_html = standalone
        .into_iter()
        .map(|(title, rel)| format!(r#"<li class="chat-item"><a href="{}" target="_blank">{}</a></li>"#, rel, escape_html(&title)))
        .collect::<Vec<_>>()
        .join("");

    let html = format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Project Archivist Export Index</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #111827; color: #e5e7eb; }}
    .wrap {{ display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }}
    .sidebar {{ border-right: 1px solid #374151; padding: 16px; background: #0f172a; overflow:auto; transition: width .2s ease, padding .2s ease, opacity .2s ease; }}
    .sidebar.collapsed {{ width: 0; padding: 0; opacity: 0; overflow: hidden; border-right: none; }}
    .main {{ padding: 0; display:flex; flex-direction:column; min-width:0; }}
    .topbar {{ display:flex; gap:8px; align-items:center; padding:12px; border-bottom:1px solid #374151; background:#0b1220; }}
    input {{ width: 100%; box-sizing: border-box; padding: 10px; border-radius: 8px; border: 1px solid #475569; background: #0b1220; color: #e5e7eb; }}
    details {{ margin: 10px 0; border: 1px solid #334155; border-radius: 8px; padding: 8px; background: #111827; }}
    summary {{ cursor: pointer; font-weight: 600; }}
    ul {{ margin: 8px 0 0; padding-left: 18px; }}
    a {{ color: #93c5fd; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}
    .muted {{ color: #94a3b8; }}
    .chat-item.hidden, .project-group.hidden {{ display: none; }}
    iframe {{ width:100%; height:calc(100vh - 54px); border:0; background:white; }}
    button {{ padding:8px 12px; border-radius:8px; border:1px solid #475569; background:#111827; color:#e5e7eb; cursor:pointer; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="sidebar" id="sidebar">
      <h2>Exports</h2>
      <input id="search" placeholder="Search projects or chats" />
      <div id="tree">
        {}
        <details open class="project-group">
          <summary>Standalone chats</summary>
          <ul>{}</ul>
        </details>
      </div>
    </div>
    <div class="main">
      <div class="topbar">
        <button id="toggleSidebar">Hide sidebar</button>
        <span class="muted">Open chats in the viewer below.</span>
      </div>
      <iframe id="viewer" src="about:blank"></iframe>
    </div>
  </div>
  <script>
    const search = document.getElementById('search');
    const sidebar = document.getElementById('sidebar');
    const viewer = document.getElementById('viewer');
    const toggleBtn = document.getElementById('toggleSidebar');

    search.addEventListener('input', () => {{
      const q = search.value.toLowerCase();
      document.querySelectorAll('.project-group').forEach(group => {{
        const text = group.textContent.toLowerCase();
        group.classList.toggle('hidden', q && !text.includes(q));
      }});
      document.querySelectorAll('.chat-item').forEach(item => {{
        const text = item.textContent.toLowerCase();
        item.classList.toggle('hidden', q && !text.includes(q));
      }});
    }});

    toggleBtn.addEventListener('click', () => {{
      sidebar.classList.toggle('collapsed');
      toggleBtn.textContent = sidebar.classList.contains('collapsed') ? 'Show sidebar' : 'Hide sidebar';
    }});

    document.querySelectorAll('#tree a').forEach(a => {{
      a.addEventListener('click', (e) => {{
        e.preventDefault();
        viewer.src = a.getAttribute('href');
        sidebar.classList.add('collapsed');
        toggleBtn.textContent = 'Show sidebar';
      }});
    }});
  </script>
</body>
</html>"#,
        project_sections,
        standalone_html
    );

    fs::write(export_root.join("index.html"), html).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn export_selected_archive(
    state: tauri::State<AppState>,
    root_dir: String,
    mode: String,
    project_ids: Vec<String>,
    chat_ids: Vec<String>,
) -> Result<String, String> {
    let conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let mut selected_chat_ids: Vec<String> = chat_ids.clone();

    for pid in &project_ids {
        let mut stmt = conn
            .prepare("SELECT id FROM chats WHERE project_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pid], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            if let Ok(cid) = row {
                selected_chat_ids.push(cid);
            }
        }
    }

    selected_chat_ids.sort();
    selected_chat_ids.dedup();

    if selected_chat_ids.is_empty() {
      return Err("No selected projects or chats to export".to_string());
    }

    let mut exported = 0usize;
    let mut skipped = 0usize;

    for cid in &selected_chat_ids {
        let (title, current_fp, exported_fp): (String, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT title, fingerprint, exported_fingerprint FROM chats WHERE id = ?1",
                params![cid],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|e| e.to_string())?;

        let live_fp = if let Some(fp) = current_fp {
            fp
        } else {
            chat_fingerprint(&conn, cid).map_err(|e| e.to_string())?
        };

        let should_skip = match mode.as_str() {
            "force" => false,
            "repair_assets" => exported_fp.is_some(),
            _ => exported_fp.as_deref() == Some(live_fp.as_str()),
        };

        if should_skip {
            skipped += 1;
            continue;
        }

        write_chat_export(&conn, &root_dir, cid, &title)?;
        conn.execute(
            "UPDATE chats SET exported_fingerprint = ?1 WHERE id = ?2",
            params![live_fp, cid],
        )
        .map_err(|e| e.to_string())?;
        exported += 1;
    }

    build_archive_index_html(&conn, &root_dir)?;
    Ok(format!("Exported {} chat(s), skipped {}, and regenerated index.html", exported, skipped))
}

fn visit_json_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| format!("failed to read watched folder: {}", e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            visit_json_files(&path, out)?;
        } else if path.is_file()
            && path
                .extension()
                .and_then(|v| v.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        {
            out.push(path);
        }
    }
    Ok(())
}

fn list_json_files(folder_path: &str) -> Result<Vec<PathBuf>, String> {
    let root = Path::new(folder_path);
    if !root.exists() {
        fs::create_dir_all(root).map_err(|e| format!("failed to create watched folder: {}", e))?;
        return Ok(vec![]);
    }

    let mut files = vec![];
    visit_json_files(root, &mut files)?;
    files.sort();
    Ok(files)
}

#[tauri::command]
fn auto_import_capture_folder(state: tauri::State<AppState>, folder_path: String) -> Result<String, String> {
    let files = list_json_files(&folder_path)?;
    let mut conn = state.conn.lock().map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    ensure_default_workspace(&conn).map_err(|e| e.to_string())?;

    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    for path in files {
        let canonical = path.canonicalize().unwrap_or(path.clone()).to_string_lossy().to_string();
        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        let file_hash = hash_bytes(&bytes);

        let already_seen_hash: Result<String, _> = conn.query_row(
            "SELECT file_hash FROM imported_capture_files WHERE file_hash = ?1 LIMIT 1",
            params![file_hash.clone()],
            |row| row.get(0),
        );

        if already_seen_hash.is_ok() {
            skipped += 1;
            continue;
        }

        let bundle: CaptureBundle = match serde_json::from_slice(&bytes) {
            Ok(bundle) => bundle,
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?1, ?2)",
            params![
                bundle.workspace.id,
                bundle.workspace.name.unwrap_or("Default Workspace".to_string())
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
                params![c.id, "default", c.project_id, c.title, c.fingerprint, c.updated_at],
            )
            .map_err(|e| e.to_string())?;
        }

        for m in bundle.messages {
            tx.execute(
                "INSERT OR REPLACE INTO messages (id, chat_id, role, body) VALUES (?1, ?2, ?3, ?4)",
                params![m.id, m.chat_id, m.role, m.raw_html.unwrap_or_default()],
            )
            .map_err(|e| e.to_string())?;
        }

        for a in bundle.assets {
            tx.execute(
                "INSERT OR REPLACE INTO assets (id, chat_id) VALUES (?1, ?2)",
                params![a.id, a.chat_id],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR REPLACE INTO imported_capture_files (path, file_hash) VALUES (?1, ?2)",
            params![canonical, file_hash],
        )
        .map_err(|e| e.to_string())?;
        imported += 1;
    }

    Ok(format!(
        "Imported {} new file(s), skipped {}, failed {} from {}",
        imported, skipped, failed, folder_path
    ))
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

        let _ = build_archive_index_html(&conn, root_dir);

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
            list_archive_tree,
            delete_archive_items,
            export_selected_archive,
            import_capture_bundle,
            import_official_export_zip,
            auto_import_capture_folder,
            queue_export_job,
            run_pending_export_jobs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
