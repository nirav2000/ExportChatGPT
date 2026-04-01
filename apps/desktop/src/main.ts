type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: { core?: { invoke?: TauriInvoke } };
  }
}

const content = document.querySelector<HTMLDivElement>('#content');
const invoke = window.__TAURI__?.core?.invoke;

function section(title: string, inner: string): string {
  return `<div class="card"><h2>${title}</h2>${inner}</div>`;
}

async function renderArchive(): Promise<void> {
  const fallback = section('Archive Browser', '<p class="muted">No data loaded yet.</p>');
  if (!content) return;
  if (!invoke) {
    content.innerHTML = `${fallback}${section('Runtime', '<p class="muted">Running in web preview mode (Tauri commands unavailable).</p>')}`;
    return;
  }
  const rows = (await invoke<{ project_name: string | null; chat_title: string | null; message_count: number }[]>('list_projects_chats')) ?? [];
  const list = rows.length
    ? `<table><tr><th>Project</th><th>Chat</th><th>Messages</th></tr>${rows
        .map((r) => `<tr><td>${r.project_name ?? 'Unassigned / Imported'}</td><td>${r.chat_title ?? '-'}</td><td>${r.message_count}</td></tr>`)
        .join('')}</table>`
    : '<p class="muted">No projects/chats found.</p>';
  content.innerHTML = section('Archive Browser', list);
}

function renderImport(): void {
  if (!content) return;
  content.innerHTML = section(
    'Import Wizard',
    `<p>Paste a capture bundle JSON to import.</p>
    <textarea id="bundleInput" rows="12" style="width:100%"></textarea>
    <div><button id="importBundleBtn">Import capture bundle</button></div>
    <pre id="importResult" class="muted"></pre>`,
  );

  document.getElementById('importBundleBtn')?.addEventListener('click', async () => {
    const bundle = (document.getElementById('bundleInput') as HTMLTextAreaElement).value;
    const out = document.getElementById('importResult');
    try {
      if (!invoke) throw new Error('Tauri unavailable');
      const result = await invoke<string>('import_capture_bundle', { bundleJson: bundle });
      if (out) out.textContent = result;
    } catch (error) {
      if (out) out.textContent = `Import failed: ${(error as Error).message}`;
    }
  });
}

function renderExport(): void {
  if (!content) return;
  content.innerHTML = section(
    'Export Jobs',
    `<label>Export root folder: <input id="exportRoot" value="/tmp" /></label>
    <button id="queueExportBtn">Queue workspace export</button>
    <pre id="exportResult" class="muted"></pre>`,
  );
  document.getElementById('queueExportBtn')?.addEventListener('click', async () => {
    const root = (document.getElementById('exportRoot') as HTMLInputElement).value;
    const out = document.getElementById('exportResult');
    try {
      if (!invoke) throw new Error('Tauri unavailable');
      const result = await invoke<string>('queue_export_job', { target: 'workspace', mode: 'incremental', rootDir: root });
      if (out) out.textContent = result;
    } catch (error) {
      if (out) out.textContent = `Export queue failed: ${(error as Error).message}`;
    }
  });
}

function renderSettings(): void {
  if (!content) return;
  content.innerHTML = section(
    'Settings',
    '<p>Privacy mode is always local-first.</p><ul><li>No telemetry</li><li>No cloud sync</li><li>Explicit export path only</li></ul>',
  );
}

async function renderDiagnostics(): Promise<void> {
  if (!content) return;
  if (!invoke) {
    content.innerHTML = section('Diagnostics', '<p class="muted">Tauri command unavailable in browser mode.</p>');
    return;
  }
  const health = await invoke<{ status: string }>('diagnostics_health');
  content.innerHTML = section('Diagnostics', `<p>SQLite status: <strong>${health.status}</strong></p>`);
}

const actions: Record<string, () => void | Promise<void>> = {
  archive: renderArchive,
  import: renderImport,
  export: renderExport,
  settings: renderSettings,
  diagnostics: renderDiagnostics,
};

for (const btn of document.querySelectorAll<HTMLButtonElement>('#sidebar button')) {
  btn.addEventListener('click', async () => {
    const view = btn.dataset.view || 'archive';
    await actions[view]?.();
  });
}

void renderArchive();
