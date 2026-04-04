use super::*;

pub(crate) fn namespace_scoped_id(chat_id: &str, local_id: &str) -> String {
    if local_id.contains("::") {
        local_id.to_string()
    } else {
        format!("{}::{}", chat_id, local_id)
    }
}

pub(crate) fn capture_bundle_needs_reimport(
    conn: &Connection,
    bundle: &CaptureBundle,
) -> Result<bool, String> {
    for chat in &bundle.chats {
        let chat_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chats WHERE id = ?1",
                params![chat.id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if chat_exists == 0 {
            return Ok(true);
        }

        let stored_messages: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM messages WHERE chat_id = ?1",
                params![chat.id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let stored_assets: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assets WHERE chat_id = ?1",
                params![chat.id],
                |row| row.get(0),
            )
            .unwrap_or(0);

        let expected_messages = bundle
            .messages
            .iter()
            .filter(|message| message.chat_id == chat.id)
            .count() as i64;

        let expected_assets = bundle
            .assets
            .iter()
            .filter(|asset| asset.chat_id == chat.id)
            .count() as i64;

        if expected_messages > stored_messages || expected_assets > stored_assets {
            return Ok(true);
        }
    }

    Ok(false)
}

pub(crate) fn persist_capture_bundle(
    conn: &mut Connection,
    bundle: CaptureBundle,
) -> Result<usize, String> {
    init_schema(conn).map_err(|e| e.to_string())?;

    let workspace_id = if bundle.workspace.id.trim().is_empty() {
        "default".to_string()
    } else {
        bundle.workspace.id.clone()
    };
    let workspace_name = bundle
        .workspace
        .name
        .clone()
        .unwrap_or_else(|| "Default Workspace".to_string());

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?1, ?2)",
        params![workspace_id, workspace_name],
    )
    .map_err(|e| e.to_string())?;

    for project in bundle.projects {
        tx.execute(
            "INSERT OR REPLACE INTO projects (id, workspace_id, name) VALUES (?1, ?2, ?3)",
            params![project.id, workspace_id, project.name],
        )
        .map_err(|e| e.to_string())?;
    }

    for chat in bundle.chats {
        tx.execute(
            "INSERT OR REPLACE INTO chats (id, workspace_id, project_id, title, fingerprint, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![chat.id, workspace_id, chat.project_id, chat.title, chat.fingerprint, chat.updated_at],
        )
        .map_err(|e| e.to_string())?;
    }

    let mut message_index_by_chat: HashMap<String, i64> = HashMap::new();
    for message in bundle.messages {
        let sort_index = message_index_by_chat
            .entry(message.chat_id.clone())
            .or_insert(0);
        let html_body = message
            .raw_html
            .clone()
            .filter(|value| !value.trim().is_empty());

        let blocks_json = if message.blocks.is_empty() {
            None
        } else {
            Some(serde_json::to_string(&message.blocks).map_err(|e| e.to_string())?)
        };

        let mut body = blocks_to_plain_text(&message.blocks);
        if body.trim().is_empty() {
            if let Some(html) = &html_body {
                body = strip_tags(html);
            }
        }

        tx.execute(
            "INSERT OR REPLACE INTO messages (id, chat_id, role, body, html_body, blocks_json, sort_index, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE(?8, CURRENT_TIMESTAMP))",
            params![namespace_scoped_id(&message.chat_id, &message.id), message.chat_id, message.role, body, html_body, blocks_json, *sort_index, message.created_at],
        )
        .map_err(|e| e.to_string())?;
        *sort_index += 1;
    }

    for asset in bundle.assets {
        tx.execute(
            "INSERT OR REPLACE INTO assets (id, chat_id) VALUES (?1, ?2)",
            params![
                namespace_scoped_id(&asset.chat_id, &asset.id),
                asset.chat_id
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(message_index_by_chat.len())
}

pub(crate) fn rand_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{}", now)
}

#[tauri::command]
pub(crate) fn import_capture_bundle(
    state: tauri::State<AppState>,
    bundle_json: String,
) -> Result<String, String> {
    let bundle: CaptureBundle =
        serde_json::from_str(&bundle_json).map_err(|e| format!("invalid bundle: {}", e))?;
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    persist_capture_bundle(&mut conn, bundle)?;
    Ok("Capture bundle imported successfully".to_string())
}

#[tauri::command]
pub(crate) fn import_official_export_zip(
    state: tauri::State<AppState>,
    zip_path: String,
) -> Result<String, String> {
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
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    ensure_default_workspace(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO projects (id, workspace_id, name) VALUES ('imported', 'default', 'Unassigned / Imported')",
        [],
    )
    .map_err(|e| e.to_string())?;

    let imported_count = parsed.len();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for conversation in parsed {
        let id = conversation.id.unwrap_or(format!("official-{}", rand_id()));
        tx.execute(
            "INSERT OR REPLACE INTO chats (id, workspace_id, project_id, title, updated_at) VALUES (?1, 'default', 'imported', ?2, ?3)",
            params![id, conversation.title.unwrap_or("Untitled Chat".to_string()), conversation.update_time.map(|v| v.to_string())],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(format!(
        "Imported {} official conversations (titles only)",
        imported_count
    ))
}

pub(crate) fn visit_json_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
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

pub(crate) fn list_json_files(folder_path: &str) -> Result<Vec<PathBuf>, String> {
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
pub(crate) fn auto_import_capture_folder(
    state: tauri::State<AppState>,
    folder_path: String,
    force_reimport: Option<bool>,
) -> Result<String, String> {
    if folder_path.trim().is_empty() {
        return Err("No watched folder configured".to_string());
    }

    let force_reimport = force_reimport.unwrap_or(false);
    let files = list_json_files(&folder_path)?;
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    ensure_default_workspace(&conn).map_err(|e| e.to_string())?;

    let mut imported = 0usize;
    let mut reimported = 0usize;
    let mut skipped = 0usize;
    let mut failed = 0usize;

    for path in files {
        let canonical = path
            .canonicalize()
            .unwrap_or(path.clone())
            .to_string_lossy()
            .to_string();

        let bytes = match fs::read(&path) {
            Ok(b) => b,
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        let bundle: CaptureBundle = match serde_json::from_slice(&bytes) {
            Ok(bundle) => bundle,
            Err(_) => {
                failed += 1;
                continue;
            }
        };

        let file_hash = hash_bytes(&bytes);
        let already_seen_hash = conn.query_row(
            "SELECT file_hash FROM imported_capture_files WHERE file_hash = ?1 LIMIT 1",
            params![file_hash.clone()],
            |row| row.get::<_, String>(0),
        );

        let needs_reimport = capture_bundle_needs_reimport(&conn, &bundle)?;
        let was_seen = already_seen_hash.is_ok();

        if was_seen && !force_reimport && !needs_reimport {
            skipped += 1;
            continue;
        }

        persist_capture_bundle(&mut conn, bundle)?;

        conn.execute(
            "INSERT OR REPLACE INTO imported_capture_files (path, file_hash) VALUES (?1, ?2)",
            params![canonical, file_hash],
        )
        .map_err(|e| e.to_string())?;

        if was_seen || needs_reimport {
            reimported += 1;
        } else {
            imported += 1;
        }
    }

    Ok(format!(
        "Imported {} new file(s), reimported {}, skipped {}, failed {} from {}",
        imported, reimported, skipped, failed, folder_path
    ))
}
