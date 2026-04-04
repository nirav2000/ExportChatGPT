use super::*;

pub(crate) fn export_dir_for_chat(
    root: &str,
    chat_id: &str,
    title: &str,
    project_name: Option<&str>,
) -> PathBuf {
    let folder = sanitize_for_fs(&format!("{} - {}", chat_id, title));
    if let Some(project_name) = project_name {
        Path::new(root)
            .join("Project Archivist Export")
            .join("projects")
            .join(sanitize_for_fs(project_name))
            .join("chats")
            .join(folder)
    } else {
        Path::new(root)
            .join("Project Archivist Export")
            .join("standalone-chats")
            .join(folder)
    }
}

pub(crate) fn remove_empty_parent_dirs(mut current: PathBuf, stop_at: &Path) {
    while current.starts_with(stop_at) && current != stop_at {
        if current.exists() {
            match fs::remove_dir(&current) {
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::DirectoryNotEmpty => break,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => break,
            }
        }
        let Some(parent) = current.parent() else {
            break;
        };
        current = parent.to_path_buf();
    }
}

pub(crate) fn remove_chat_export(
    root: &str,
    chat_id: &str,
    title: &str,
    project_name: Option<&str>,
) -> Result<(), String> {
    let dir = export_dir_for_chat(root, chat_id, title, project_name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        let export_root = Path::new(root).join("Project Archivist Export");
        if let Some(parent) = dir.parent() {
            remove_empty_parent_dirs(parent.to_path_buf(), &export_root);
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn delete_archive_items(
    state: tauri::State<AppState>,
    project_ids: Vec<String>,
    chat_ids: Vec<String>,
    root_dir: String,
) -> Result<String, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
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

    let mut export_entries: Vec<(String, String, Option<String>)> = Vec::new();
    for cid in &all_chat_ids {
        let meta: Result<(String, Option<String>), _> = tx.query_row(
            "
            SELECT c.title, p.name
            FROM chats c
            LEFT JOIN projects p ON p.id = c.project_id
            WHERE c.id = ?1
            ",
            params![cid],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        if let Ok((title, project_name)) = meta {
            export_entries.push((cid.clone(), title, project_name));
        }
    }

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

    if !all_chat_ids.is_empty() || !project_ids.is_empty() {
        conn.execute("DELETE FROM imported_capture_files", [])
            .map_err(|e| e.to_string())?;
    }

    if !root_dir.trim().is_empty() {
        for (chat_id, title, project_name) in &export_entries {
            let _ = remove_chat_export(&root_dir, chat_id, title, project_name.as_deref());
        }
        let _ = build_archive_index_html(&conn, &root_dir);
    }

    Ok(format!(
        "Removed {} chat(s), {} project(s), and cleared import history so auto-import can rehydrate deleted items",
        all_chat_ids.len(),
        project_ids.len()
    ))
}

pub(crate) fn write_chat_export(
    conn: &Connection,
    root: &str,
    chat_id: &str,
    title: &str,
) -> Result<(), String> {
    let project_name: Option<String> = conn
        .query_row(
            "SELECT p.name FROM chats c LEFT JOIN projects p ON p.id = c.project_id WHERE c.id = ?1",
            params![chat_id],
            |row| row.get(0),
        )
        .ok();

    let dir = export_dir_for_chat(root, chat_id, title, project_name.as_deref());
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, role, body FROM messages WHERE chat_id = ?1 ORDER BY sort_index, id")
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
    let mut rendered_messages: Vec<String> = vec![];

    for row in rows {
        let (id, role, body) = row.map_err(|e| e.to_string())?;
        let plain_body = html_to_search_text(&body);
        md.push_str(&format!("### {}\n\n{}\n\n---\n\n", role, plain_body));
        json_lines.push(serde_json::json!({ "id": id, "role": role, "body": body }));

        let role_class = if role.eq_ignore_ascii_case("user") {
            "user"
        } else {
            "assistant"
        };
        let role_label = if role.eq_ignore_ascii_case("user") {
            "You"
        } else {
            "ChatGPT"
        };

        let rendered_body = if body.trim_start().starts_with('<') {
            body.clone()
        } else {
            format!("<p>{}</p>", escape_html(&body).replace("\n", "<br />"))
        };

        rendered_messages.push(format!(
            r#"<section class="message {}"><div class="message-meta">{}</div><div class="message-body">{}</div></section>"#,
            role_class,
            escape_html(role_label),
            rendered_body
        ));
    }

    fs::write(dir.join("chat.md"), &md).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("chat.json"),
        serde_json::to_string_pretty(
            &serde_json::json!({ "id": chat_id, "title": title, "project": project_name, "messages": json_lines }),
        )
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let project_label = project_name
        .clone()
        .unwrap_or_else(|| "Standalone chat".to_string());
    let html = format!(
        r#"<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{}</title>
  <style>
    :root {{
      color-scheme: dark;
      --bg: #212121;
      --panel: #171717;
      --panel-2: #262626;
      --border: #3f3f46;
      --text: #ececec;
      --muted: #a1a1aa;
      --assistant: #171717;
      --user: #2a2a2a;
    }}
    * {{ box-sizing: border-box; }}
    html, body {{ margin: 0; padding: 0; background: var(--bg); color: var(--text); }}
    body {{ font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; overflow-x: hidden; }}
    .page {{ max-width: 1100px; margin: 0 auto; padding: 24px; }}
    .hero {{ display: flex; justify-content: space-between; gap: 12px; align-items: center; padding-bottom: 18px; border-bottom: 1px solid rgba(255,255,255,.06); margin-bottom: 24px; }}
    .hero-text h1 {{ margin: 0 0 6px; font-size: 28px; line-height: 1.15; }}
    .hero-text .sub {{ color: var(--muted); font-size: 14px; }}
    .actions {{ display: flex; gap: 10px; flex-wrap: wrap; }}
    .actions button {{ border: 1px solid var(--border); background: transparent; color: var(--text); border-radius: 999px; padding: 10px 14px; cursor: pointer; }}
    .messages {{ display: flex; flex-direction: column; gap: 18px; }}
    .message {{ border: 1px solid rgba(255,255,255,.05); border-radius: 18px; overflow: hidden; }}
    .message.assistant {{ background: var(--assistant); }}
    .message.user {{ background: var(--user); }}
    .message-meta {{ padding: 12px 16px 0; color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }}
    .message-body {{ padding: 16px; min-width: 0; }}
    .message-body > :first-child {{ margin-top: 0; }}
    .message-body > :last-child {{ margin-bottom: 0; }}
    .message-body img, .message-body video, .message-body canvas, .message-body svg {{ max-width: 100% !important; height: auto !important; display: block; }}
    .message-body iframe {{ max-width: 100% !important; }}
    .message-body table {{ display: block; width: 100%; max-width: 100%; overflow-x: auto; border-collapse: collapse; }}
    .message-body pre {{ max-width: 100%; overflow: auto; background: #111827; border-radius: 14px; padding: 14px; }}
    .message-body code {{ white-space: pre-wrap; word-break: break-word; }}
    .message-body a {{ color: #8ab4ff; word-break: break-word; }}
    .message-body ul, .message-body ol {{ padding-left: 1.35rem; }}
    .message-body blockquote {{ margin: 1rem 0; padding: .25rem 1rem; border-left: 3px solid #52525b; color: #d4d4d8; }}
    .message-body .table-wrap {{ overflow-x: auto; }}
    @media (max-width: 900px) {{
      .page {{ padding: 14px; }}
      .hero {{ align-items: flex-start; flex-direction: column; }}
      .hero-text h1 {{ font-size: 22px; }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <div class="hero-text">
        <h1>{}</h1>
        <div class="sub">{}</div>
      </div>
      <div class="actions">
        <button id="shareWhatsApp" type="button">Share to WhatsApp</button>
        <button id="savePdf" type="button">Save to PDF</button>
        <button id="printPage" type="button">Print</button>
      </div>
    </header>

    <main class="messages">{}</main>
  </div>

  <script>
    const shareText = `${{document.title}}\n${{location.href}}`;
    document.getElementById('shareWhatsApp')?.addEventListener('click', () => {{
      const url = 'https://wa.me/?text=' + encodeURIComponent(shareText);
      window.open(url, '_blank', 'noopener,noreferrer');
    }});
    document.getElementById('savePdf')?.addEventListener('click', () => window.print());
    document.getElementById('printPage')?.addEventListener('click', () => window.print());
  </script>
</body>
</html>"#,
        escape_html(title),
        escape_html(title),
        escape_html(&project_label),
        rendered_messages.join("\n")
    );

    fs::write(dir.join("chat.html"), html).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn build_archive_index_html(conn: &Connection, root: &str) -> Result<(), String> {
    let export_root = Path::new(root).join("Project Archivist Export");
    fs::create_dir_all(&export_root).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "
            SELECT
              c.id,
              c.title,
              p.name,
              COALESCE(GROUP_CONCAT(m.body, ' '), '')
            FROM chats c
            LEFT JOIN projects p ON p.id = c.project_id
            LEFT JOIN messages m ON m.chat_id = c.id
            WHERE c.exported_fingerprint IS NOT NULL
            GROUP BY c.id, c.title, p.name
            ORDER BY COALESCE(p.name, ''), c.title
            ",
        )
        .map_err(|e| e.to_string())?;

    let rows: Vec<(String, String, Option<String>, String)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    let root_launcher = Path::new(root).join("index.html");
    if root_launcher.exists() {
        let _ = fs::remove_file(&root_launcher);
    }

    if rows.is_empty() {
        let nested_index = export_root.join("index.html");
        if nested_index.exists() {
            let _ = fs::remove_file(&nested_index);
        }
        return Ok(());
    }

    let mut projects: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
    let mut standalone: Vec<(String, String, String)> = vec![];

    for (chat_id, title, project_name, search_text) in rows {
        let folder = sanitize_for_fs(&format!("{} - {}", chat_id, title));
        let search_blob = format!("{} {}", title, search_text);
        if let Some(project_name) = project_name {
            let project_folder = sanitize_for_fs(&project_name);
            let rel = format!("projects/{}/chats/{}/chat.html", project_folder, folder);
            projects
                .entry(project_name)
                .or_default()
                .push((title, rel, search_blob));
        } else {
            let rel = format!("standalone-chats/{}/chat.html", folder);
            standalone.push((title, rel, search_blob));
        }
    }

    let mut project_sections = String::new();
    let mut project_names: Vec<String> = projects.keys().cloned().collect();
    project_names.sort();

    for pname in project_names {
        let mut chats = projects.remove(&pname).unwrap_or_default();
        let count = chats.len();
        chats.sort_by(|a, b| a.0.cmp(&b.0));

        let items = chats
            .into_iter()
            .map(|(title, rel, search_blob)| {
                format!(
                    r#"<button class="nav-chat" type="button" data-html="{}" data-title="{}" data-search="{}"><span class="nav-chat-title">{}</span></button>"#,
                    escape_html(&rel),
                    escape_html(&title),
                    escape_html(&search_blob),
                    escape_html(&title)
                )
            })
            .collect::<Vec<_>>()
            .join("");

        project_sections.push_str(&format!(
            r#"<details class="nav-group" open><summary class="nav-group-summary"><span class="nav-group-title">{}</span><span class="nav-group-count">{}</span></summary><div class="nav-group-items">{}</div></details>"#,
            escape_html(&pname),
            count,
            items
        ));
    }

    let standalone_section = if standalone.is_empty() {
        String::new()
    } else {
        let mut chats = standalone;
        chats.sort_by(|a, b| a.0.cmp(&b.0));
        let count = chats.len();
        let items = chats
            .into_iter()
            .map(|(title, rel, search_blob)| {
                format!(
                    r#"<button class="nav-chat" type="button" data-html="{}" data-title="{}" data-search="{}"><span class="nav-chat-title">{}</span></button>"#,
                    escape_html(&rel),
                    escape_html(&title),
                    escape_html(&search_blob),
                    escape_html(&title)
                )
            })
            .collect::<Vec<_>>()
            .join("");

        format!(
            r#"<details class="nav-group" open><summary class="nav-group-summary"><span class="nav-group-title">Standalone chats</span><span class="nav-group-count">{}</span></summary><div class="nav-group-items">{}</div></details>"#,
            count, items
        )
    };

    let html_template = r##"<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Project Archivist Export</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root {
      color-scheme: dark;
      --bg: #212121;
      --panel: #171717;
      --border: #3f3f46;
      --text: #ececec;
      --muted: #a1a1aa;
      --sidebar-w: 310px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; overflow: hidden; }
    body {
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .app {
      display: grid;
      grid-template-columns: var(--sidebar-w) 1fr;
      height: 100vh;
      min-height: 100vh;
    }
    body.sidebar-collapsed .app {
      grid-template-columns: 0 1fr;
    }
    .sidebar {
      background: var(--panel);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      overflow-x: hidden;
      padding: 14px;
      transition: transform .18s ease, opacity .18s ease;
    }
    body.sidebar-collapsed .sidebar {
      transform: translateX(-100%);
      opacity: 0;
      pointer-events: none;
      padding: 0;
      border-right: 0;
    }
    .sidebar h1 {
      margin: 0 0 12px;
      font-size: 16px;
      font-weight: 700;
    }
    .search {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--bg);
      color: var(--text);
      margin-bottom: 10px;
    }
    .sidebar-controls {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .sidebar-btn, .topbar-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: #242424;
      color: var(--text);
      padding: 8px 10px;
      border-radius: 10px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1;
    }
    .sidebar-btn:hover, .topbar-btn:hover {
      border-color: #5b5b67;
      background: #2a2a2a;
    }
    .nav-group {
      margin-bottom: 12px;
      border: 1px solid rgba(245, 158, 11, .75);
      border-radius: 14px;
      overflow: hidden;
      background: #0f1b3b;
    }
    .nav-group.hidden { display: none; }
    .nav-group-summary {
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      cursor: pointer;
      padding: 10px 12px;
      user-select: none;
    }
    .nav-group-summary::-webkit-details-marker { display: none; }
    .nav-group-title {
      color: var(--text);
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
    }
    .nav-group-count {
      color: var(--muted);
      font-size: 12px;
    }
    .nav-group-items {
      padding: 0 8px 8px;
    }
    .nav-chat {
      width: 100%;
      text-align: left;
      display: block;
      padding: 10px 12px;
      margin-bottom: 6px;
      border: 1px solid transparent;
      background: rgba(255,255,255,.04);
      color: var(--text);
      border-radius: 12px;
      cursor: pointer;
      transition: background .15s ease, border-color .15s ease;
    }
    .nav-chat:hover { background: rgba(255,255,255,.08); }
    .nav-chat.active {
      background: rgba(255,255,255,.12);
      border-color: #4b5563;
    }
    .nav-chat.hidden { display: none; }
    .nav-chat-title {
      display: block;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 14px;
      line-height: 1.3;
    }
    .main {
      min-width: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-height: 0;
      background: var(--bg);
    }
    .topbar {
      padding: 14px 20px 10px;
      border-bottom: 1px solid rgba(255,255,255,.05);
      background: rgba(33,33,33,.96);
      position: sticky;
      top: 0;
      z-index: 5;
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .topbar-meta {
      min-width: 0;
      flex: 1;
    }
    .topbar-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
    }
    .topbar-path {
      margin-top: 4px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .viewer-wrap {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      background: var(--bg);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--bg);
      display: block;
    }
    .empty {
      height: 100%;
      display: grid;
      place-items: center;
      color: var(--muted);
      padding: 24px;
      text-align: center;
    }
    @media (max-width: 900px) {
      :root { --sidebar-w: 260px; }
      .app { grid-template-columns: 1fr; }
      .sidebar {
        position: absolute;
        inset: 0 auto 0 0;
        width: min(85vw, var(--sidebar-w));
        z-index: 20;
        box-shadow: 10px 0 30px rgba(0,0,0,.35);
      }
      body.sidebar-collapsed .sidebar {
        transform: translateX(-110%);
        opacity: 0;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <h1>Project Archivist Export</h1>
      <input id="sidebarSearch" class="search" placeholder="Search chats and content" />
      <div class="sidebar-controls">
        <button id="expandAllBtn" class="sidebar-btn" type="button">Expand all</button>
        <button id="collapseAllBtn" class="sidebar-btn" type="button">Collapse all</button>
      </div>
      <div id="sidebarNav">
        __PROJECT_SECTIONS__
        __STANDALONE_SECTION__
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <button id="toggleSidebarBtn" class="topbar-btn" type="button">Sidebar</button>
        <div class="topbar-meta">
          <h2 class="topbar-title">Archive viewer</h2>
          <div id="conversationPath" class="topbar-path">Select a chat from the sidebar.</div>
        </div>
      </div>

      <div class="viewer-wrap">
        <iframe id="viewer" src="about:blank"></iframe>
        <div id="emptyState" class="empty">Select a chat from the sidebar to view it here.</div>
      </div>
    </main>
  </div>

  <script>
    const body = document.body;
    const sidebarSearch = document.getElementById('sidebarSearch');
    const navButtons = Array.from(document.querySelectorAll('.nav-chat'));
    const navGroups = Array.from(document.querySelectorAll('.nav-group'));
    const conversationPath = document.getElementById('conversationPath');
    const viewer = document.getElementById('viewer');
    const emptyState = document.getElementById('emptyState');
    const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
    const expandAllBtn = document.getElementById('expandAllBtn');
    const collapseAllBtn = document.getElementById('collapseAllBtn');

    function applyIframeFixes() {
      let doc = null;
      try {
        doc = viewer.contentDocument || viewer.contentWindow?.document || null;
      } catch (_err) {
        return;
      }
      if (!doc || !doc.head) return;
      if (doc.getElementById('pa-responsive-fixes')) return;

      const style = doc.createElement('style');
      style.id = 'pa-responsive-fixes';
      style.textContent = `
        html, body { max-width: 100%; overflow-x: hidden !important; }
        img, svg, canvas, video, iframe, embed, object {
          max-width: 100% !important;
          height: auto !important;
          object-fit: contain !important;
        }
        table {
          display: block !important;
          width: 100% !important;
          max-width: 100% !important;
          overflow-x: auto !important;
          border-collapse: collapse;
        }
        pre {
          max-width: 100% !important;
          overflow-x: auto !important;
          white-space: pre-wrap !important;
          overflow-wrap: anywhere !important;
        }
        code {
          white-space: pre-wrap !important;
          overflow-wrap: anywhere !important;
        }
        a { overflow-wrap: anywhere; }
      `;
      doc.head.appendChild(style);
    }

    function loadConversation(button) {
      const path = button.getAttribute('data-html');
      if (!path) return;

      navButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');

      conversationPath.textContent = path;
      viewer.src = path;
      viewer.style.display = 'block';
      emptyState.style.display = 'none';

      if (window.innerWidth <= 900) {
        body.classList.add('sidebar-collapsed');
      }
    }

    function updateSearch() {
      const q = sidebarSearch.value.trim().toLowerCase();

      navButtons.forEach((button) => {
        const haystack = (
          (button.getAttribute('data-title') || '') + ' ' +
          (button.getAttribute('data-search') || '')
        ).toLowerCase();
        button.classList.toggle('hidden', !!q && !haystack.includes(q));
      });

      navGroups.forEach((group) => {
        const visibleButtons = Array.from(group.querySelectorAll('.nav-chat')).some(
          (button) => !button.classList.contains('hidden'),
        );
        group.classList.toggle('hidden', !visibleButtons);
      });
    }

    toggleSidebarBtn.addEventListener('click', () => {
      body.classList.toggle('sidebar-collapsed');
    });

    expandAllBtn.addEventListener('click', () => {
      navGroups.forEach((group) => { group.open = true; });
    });

    collapseAllBtn.addEventListener('click', () => {
      navGroups.forEach((group) => { group.open = false; });
    });

    sidebarSearch.addEventListener('input', updateSearch);

    navButtons.forEach((button) => {
      button.addEventListener('click', () => loadConversation(button));
    });

    viewer.addEventListener('load', () => {
      applyIframeFixes();
    });

    if (navButtons.length) {
      loadConversation(navButtons[0]);
    } else {
      viewer.style.display = 'none';
      emptyState.style.display = 'grid';
    }
  </script>
</body>
</html>"##;

    let mut html = html_template.replace("__PROJECT_SECTIONS__", &project_sections);
    html = html.replace("__STANDALONE_SECTION__", &standalone_section);

    fs::write(export_root.join("index.html"), html).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn export_selected_archive(
    state: tauri::State<AppState>,
    root_dir: String,
    mode: String,
    project_ids: Vec<String>,
    chat_ids: Vec<String>,
) -> Result<String, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
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
            _ => exported_fp.as_deref() == Some(live_fp.as_str()),
        };

        if should_skip {
            skipped += 1;
            continue;
        }

        write_chat_export(&conn, &root_dir, cid, &title)?;
        conn.execute(
            "UPDATE chats SET exported_fingerprint = ?1, fingerprint = COALESCE(fingerprint, ?1) WHERE id = ?2",
            params![live_fp, cid],
        )
        .map_err(|e| e.to_string())?;
        exported += 1;
    }

    build_archive_index_html(&conn, &root_dir)?;
    Ok(format!(
        "Exported {} chat(s), skipped {}, and regenerated index.html",
        exported, skipped
    ))
}

#[tauri::command]
pub(crate) fn queue_export_job(
    state: tauri::State<AppState>,
    target: String,
    mode: String,
    root_dir: String,
) -> Result<String, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO export_jobs (target, mode, root_dir, status) VALUES (?1, ?2, ?3, 'queued')",
        params![target, mode, root_dir],
    )
    .map_err(|e| e.to_string())?;
    Ok("Export job queued".to_string())
}

#[tauri::command]
pub(crate) fn run_pending_export_jobs(state: tauri::State<AppState>) -> Result<String, String> {
    let conn = state
        .conn
        .lock()
        .map_err(|_| "db lock failed".to_string())?;
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
                "UPDATE chats SET exported_fingerprint = ?1, fingerprint = COALESCE(fingerprint, ?1) WHERE id = ?2",
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
