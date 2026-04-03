import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

const content = document.querySelector<HTMLDivElement>('#content');

const AUTO_IMPORT_FOLDER_KEY = 'project-archivist.autoImportFolder';
const AUTO_IMPORT_ENABLED_KEY = 'project-archivist.autoImportEnabled';
const EXPORT_ROOT_KEY = 'project-archivist.exportRoot';
const DEFAULT_EXPORT_ROOT = '/Users/n/Downloads/project-archivist-export/';

let autoImportTimer: number | null = null;
let autoImportInFlight = false;
let currentView = 'archive';

let archiveSearch = '';
let selectedProjectIds = new Set<string>();
let selectedChatIds = new Set<string>();
let collapsedProjects = new Set<string>();

type ArchiveChatNode = {
  id: string;
  title: string;
  project_id?: string | null;
  project_name?: string | null;
  message_count: number;
  image_count: number;
  changed: boolean;
};

type ArchiveProjectNode = {
  id: string;
  name: string;
  chats: ArchiveChatNode[];
  changed: boolean;
};

type ArchiveTree = {
  projects: ArchiveProjectNode[];
  standalone: ArchiveChatNode[];
};

function section(title: string, inner: string): string {
  return `<div class="card"><h2>${title}</h2>${inner}</div>`;
}

function getWatchedFolder(): string {
  return localStorage.getItem(AUTO_IMPORT_FOLDER_KEY) || '';
}

function isAutoImportEnabled(): boolean {
  return localStorage.getItem(AUTO_IMPORT_ENABLED_KEY) === 'true';
}

function setWatchedFolder(folder: string): void {
  localStorage.setItem(AUTO_IMPORT_FOLDER_KEY, folder);
}

function setAutoImportEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_IMPORT_ENABLED_KEY, enabled ? 'true' : 'false');
}

function getExportRoot(): string {
  return localStorage.getItem(EXPORT_ROOT_KEY) || DEFAULT_EXPORT_ROOT;
}

function setExportRoot(root: string): void {
  localStorage.setItem(EXPORT_ROOT_KEY, root);
}

function setStatusText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function maybeRefreshArchive(): Promise<void> {
  if (currentView === 'archive') {
    await renderArchive();
  }
}

async function autoImportOnce(showResult = false): Promise<void> {
  if (autoImportInFlight || !isAutoImportEnabled()) return;
  autoImportInFlight = true;
  try {
    const result = await invoke<string>('auto_import_capture_folder', {
      folderPath: getWatchedFolder(),
    });

    if (showResult || !result.startsWith('Imported 0 new file(s)')) {
      if (currentView === 'settings') {
        setStatusText('autoImportResult', result);
      }
    }

    if (!result.startsWith('Imported 0 new file(s)')) {
      await maybeRefreshArchive();
    }
  } catch (error) {
    const msg = `Auto-import failed: ${(error as Error).message}`;
    if (currentView === 'settings') {
      setStatusText('autoImportResult', msg);
    }
  } finally {
    autoImportInFlight = false;
  }
}

function ensureAutoImportPolling(): void {
  if (autoImportTimer !== null) {
    window.clearInterval(autoImportTimer);
    autoImportTimer = null;
  }
  if (!isAutoImportEnabled()) return;
  autoImportTimer = window.setInterval(() => {
    void autoImportOnce(false);
  }, 5000);
}

function escapeHtml(s: string): string {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderChatRow(chat: ArchiveChatNode): string {
  const checked = selectedChatIds.has(chat.id) ? 'checked' : '';
  const changedBadge = chat.changed ? `<span class="badge changed">changed</span>` : '';
  return `<li class="chat-row ${chat.changed ? 'changed' : ''}">
    <label>
      <input type="checkbox" class="chat-check" data-chat-id="${escapeHtml(chat.id)}" ${checked} />
      <span>${escapeHtml(chat.title)} <span class="muted">[${chat.message_count} msgs, ${chat.image_count} imgs]</span> ${changedBadge}</span>
    </label>
  </li>`;
}

function renderProjectBlock(project: ArchiveProjectNode): string {
  const collapsed = collapsedProjects.has(project.id);
  const checked = selectedProjectIds.has(project.id) ? 'checked' : '';
  const changedBadge = project.changed ? `<span class="badge changed">changed</span>` : '';
  return `<div class="project-block ${project.changed ? 'changed' : ''}">
    <div class="project-head">
      <button class="collapse-btn" data-project-id="${escapeHtml(project.id)}">${collapsed ? '▸' : '▾'}</button>
      <label class="grow">
        <input type="checkbox" class="project-check" data-project-id="${escapeHtml(project.id)}" ${checked} />
        <strong>${escapeHtml(project.name)}</strong> <span class="muted">(${project.chats.length} chats)</span> ${changedBadge}
      </label>
    </div>
    <div class="project-body ${collapsed ? 'collapsed' : ''}">
      <ul>${project.chats.map(renderChatRow).join('')}</ul>
    </div>
  </div>`;
}

async function renderArchive(): Promise<void> {
  currentView = 'archive';
  if (!content) return;

  const tree = await invoke<ArchiveTree>('list_archive_tree');
  const projects = tree.projects.filter((p) => {
    const hay = `${p.name} ${p.chats.map((c) => c.title).join(' ')}`.toLowerCase();
    return !archiveSearch || hay.includes(archiveSearch.toLowerCase());
  });

  const standalone = tree.standalone.filter((c) => {
    const hay = `${c.title}`.toLowerCase();
    return !archiveSearch || hay.includes(archiveSearch.toLowerCase());
  });

  content.innerHTML = section(
    'Archive Browser',
    `
    <style>
      .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .toolbar input,.toolbar select{padding:8px}
      .toolbar .grow-input{flex:1;min-width:240px}
      .project-block{border:1px solid #334155;border-radius:10px;padding:8px;margin:10px 0;background:#0f172a}
      .project-block.changed{border-color:#f59e0b;box-shadow: inset 0 0 0 1px rgba(245,158,11,.25)}
      .project-head{display:flex;align-items:center;gap:8px}
      .project-body.collapsed{display:none}
      .collapse-btn{width:auto;padding:2px 8px}
      .grow{flex:1}
      .chat-row.changed{background:rgba(245,158,11,.08);border-radius:6px}
      .badge{display:inline-block;padding:1px 6px;border-radius:999px;border:1px solid #475569;font-size:11px}
      .badge.changed{border-color:#f59e0b;color:#fde68a}
      .muted{color:#94a3b8}
      ul{margin:8px 0 0;padding-left:20px}
      .actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    </style>
    <div class="toolbar">
      <input id="archiveSearchInput" class="grow-input" placeholder="Search projects or chats" value="${escapeHtml(archiveSearch)}" />
      <input id="archiveExportRootInput" class="grow-input" placeholder="Export root folder" value="${escapeHtml(getExportRoot())}" />
      <select id="archiveExportMode">
        <option value="incremental">incremental</option>
        <option value="force" selected>force</option>
      </select>
    </div>
    <div class="actions">
      <button id="selectAllBtn">Select all visible</button>
      <button id="clearSelectionBtn">Unselect all</button>
      <button id="runArchiveAutoImportBtn">Auto import now</button>
      <button id="exportSelectedBtn">Export selected</button>
      <button id="deleteSelectedBtn">Remove selected from archive</button>
      <button id="expandAllBtn">Expand all</button>
      <button id="collapseAllBtn">Collapse all</button>
    </div>
    <div id="archiveTree">
      ${projects.map(renderProjectBlock).join('')}
      <div class="project-block ${standalone.some((c) => c.changed) ? 'changed' : ''}">
        <div class="project-head">
          <button class="collapse-btn" data-project-id="__standalone__">${collapsedProjects.has('__standalone__') ? '▸' : '▾'}</button>
          <strong>Standalone chats</strong> <span class="muted">(${standalone.length} chats)</span>
        </div>
        <div class="project-body ${collapsedProjects.has('__standalone__') ? 'collapsed' : ''}">
          <ul>${standalone.map(renderChatRow).join('')}</ul>
        </div>
      </div>
    </div>
    <pre id="archiveActionResult" class="muted"></pre>
    <div class="muted">Exports generate <code>Project Archivist Export/index.html</code> and a launcher at <code>index.html</code> in the chosen root folder.</div>
    `,
  );

  document.getElementById('archiveSearchInput')?.addEventListener('input', async (e) => {
    archiveSearch = (e.target as HTMLInputElement).value;
    await renderArchive();
  });

  document.getElementById('archiveExportRootInput')?.addEventListener('change', (e) => {
    const root = (e.target as HTMLInputElement).value.trim();
    if (root) setExportRoot(root);
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.collapse-btn')) {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.projectId || '';
      if (collapsedProjects.has(id)) collapsedProjects.delete(id);
      else collapsedProjects.add(id);
      await renderArchive();
    });
  }

  for (const cb of document.querySelectorAll<HTMLInputElement>('.project-check')) {
    cb.addEventListener('change', () => {
      const pid = cb.dataset.projectId || '';
      const project = projects.find((p) => p.id === pid);
      if (!project) return;

      if (cb.checked) {
        selectedProjectIds.add(pid);
        for (const chat of project.chats) selectedChatIds.add(chat.id);
      } else {
        selectedProjectIds.delete(pid);
        for (const chat of project.chats) selectedChatIds.delete(chat.id);
      }
      void renderArchive();
    });
  }

  for (const cb of document.querySelectorAll<HTMLInputElement>('.chat-check')) {
    cb.addEventListener('change', () => {
      const cid = cb.dataset.chatId || '';
      if (cb.checked) selectedChatIds.add(cid);
      else selectedChatIds.delete(cid);
    });
  }

  document.getElementById('selectAllBtn')?.addEventListener('click', async () => {
    for (const project of projects) {
      selectedProjectIds.add(project.id);
      for (const chat of project.chats) selectedChatIds.add(chat.id);
    }
    for (const chat of standalone) {
      selectedChatIds.add(chat.id);
    }
    await renderArchive();
  });

  document.getElementById('clearSelectionBtn')?.addEventListener('click', async () => {
    selectedProjectIds.clear();
    selectedChatIds.clear();
    await renderArchive();
  });

  document.getElementById('runArchiveAutoImportBtn')?.addEventListener('click', async () => {
    const archiveResult = document.getElementById('archiveActionResult');
    const watchedFolder = getWatchedFolder().trim();

    if (!watchedFolder) {
      if (archiveResult) archiveResult.textContent = 'Set a watched folder in Settings first.';
      return;
    }

    try {
      if (archiveResult) archiveResult.textContent = `Importing JSON files from ${watchedFolder} ...`;
      const result = await invoke<string>('auto_import_capture_folder', {
        folderPath: watchedFolder,
      });
      await renderArchive();
      const refreshedResult = document.getElementById('archiveActionResult');
      if (refreshedResult) refreshedResult.textContent = result;
    } catch (error) {
      if (archiveResult) archiveResult.textContent = `Auto-import failed: ${(error as Error).message}`;
    }
  });

  document.getElementById('expandAllBtn')?.addEventListener('click', async () => {
    collapsedProjects.clear();
    await renderArchive();
  });

  document.getElementById('collapseAllBtn')?.addEventListener('click', async () => {
    collapsedProjects = new Set<string>(projects.map((p) => p.id).concat('__standalone__'));
    await renderArchive();
  });

  document.getElementById('deleteSelectedBtn')?.addEventListener('click', async () => {
    const archiveResult = document.getElementById('archiveActionResult');

    if (!selectedProjectIds.size && !selectedChatIds.size) {
      if (archiveResult) archiveResult.textContent = 'Select at least one project or chat first.';
      return;
    }

    const root = ((document.getElementById('archiveExportRootInput') as HTMLInputElement | null)?.value || getExportRoot()).trim();
    if (root) setExportRoot(root);

    const ok = window.confirm(
      'Remove the selected projects/chats from the archive and delete their exported files from disk?'
    );
    if (!ok) return;

    try {
      if (archiveResult) archiveResult.textContent = 'Removing selected items...';

      const result = await invoke<string>('delete_archive_items', {
        projectIds: Array.from(selectedProjectIds),
        chatIds: Array.from(selectedChatIds),
        rootDir: root,
      });

      selectedProjectIds.clear();
      selectedChatIds.clear();
      await renderArchive();

      const refreshedResult = document.getElementById('archiveActionResult');
      if (refreshedResult) refreshedResult.textContent = result;
    } catch (error) {
      if (archiveResult) archiveResult.textContent = `Delete failed: ${(error as Error).message}`;
      console.error(error);
    }
  });

  document.getElementById('exportSelectedBtn')?.addEventListener('click', async () => {
    const archiveResult = document.getElementById('archiveActionResult');

    if (!selectedProjectIds.size && !selectedChatIds.size) {
      if (archiveResult) archiveResult.textContent = 'Select at least one project or chat first.';
      return;
    }

    const root = ((document.getElementById('archiveExportRootInput') as HTMLInputElement | null)?.value || getExportRoot()).trim();
    if (!root) {
      if (archiveResult) archiveResult.textContent = 'Enter an export root folder first.';
      return;
    }
    setExportRoot(root);

    const mode = ((document.getElementById('archiveExportMode') as HTMLSelectElement | null)?.value || 'force').trim();

    try {
      if (archiveResult) archiveResult.textContent = 'Exporting selected items...';

      const result = await invoke<string>('export_selected_archive', {
        rootDir: root,
        mode,
        projectIds: Array.from(selectedProjectIds),
        chatIds: Array.from(selectedChatIds),
      });

      await renderArchive();

      const refreshedResult = document.getElementById('archiveActionResult');
      if (refreshedResult) refreshedResult.textContent = `${result} Check ${root}/index.html`;
    } catch (error) {
      if (archiveResult) archiveResult.textContent = `Export failed: ${(error as Error).message}`;
      console.error(error);
    }
  });
}

async function loadBundleFile(file: File): Promise<void> {
  const out = document.getElementById('importResult');
  const textarea = document.getElementById('bundleInput') as HTMLTextAreaElement | null;
  if (!textarea) return;

  try {
    const text = await file.text();
    textarea.value = text;
    if (out) out.textContent = `Loaded ${file.name}`;
  } catch (error) {
    if (out) out.textContent = `Failed to read file: ${(error as Error).message}`;
  }
}

async function readEntryFile(entry: any): Promise<File[]> {
  return new Promise((resolve, reject) => {
    entry.file(
      (file: File) => resolve([file]),
      (error: Error) => reject(error),
    );
  });
}

async function readAllDirectoryEntries(reader: any): Promise<any[]> {
  const entries: any[] = [];

  while (true) {
    const batch: any[] = await new Promise((resolve, reject) => {
      reader.readEntries(
        (items: any[]) => resolve(items),
        (error: Error) => reject(error),
      );
    });

    if (!batch.length) break;
    entries.push(...batch);
  }

  return entries;
}

async function entryToFiles(entry: any): Promise<File[]> {
  if (!entry) return [];

  if (entry.isFile) {
    return await readEntryFile(entry);
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await readAllDirectoryEntries(reader);
    const nested = await Promise.all(entries.map((child) => entryToFiles(child)));
    return nested.flat();
  }

  return [];
}

async function dataTransferToFiles(dataTransfer: DataTransfer | null): Promise<File[]> {
  if (!dataTransfer) return [];

  const items = Array.from(dataTransfer.items || []);
  const supportsEntries = items.some((item) => typeof (item as any).webkitGetAsEntry === 'function');

  if (supportsEntries) {
    const collected = await Promise.all(
      items.map(async (item) => {
        const entry = (item as any).webkitGetAsEntry?.();
        return await entryToFiles(entry);
      }),
    );
    return collected.flat();
  }

  return Array.from(dataTransfer.files || []);
}

function renderImport(): void {
  currentView = 'import';
  if (!content) return;

  content.innerHTML = section(
    'Import Wizard',
    `<h3>Import capture bundle JSON</h3>
    <div class="import-actions">
      <button id="pickBundleFileBtn">Select JSON file(s)</button>
      <button id="pickBundleFolderBtn">Select folder of JSON files</button>
      <button id="chooseImportFolderBtn">Open folder into app</button>
      <input id="bundleFileInput" type="file" accept=".json,application/json" multiple hidden />
      <input id="bundleFolderInput" type="file" webkitdirectory directory multiple hidden />
    </div>

    <div id="dropZone" class="drop-zone">
      <strong>Drop JSON file(s) or a folder here</strong>
      <p class="muted">Folders are searched recursively for <code>.json</code> files</p>
    </div>

    <textarea id="bundleInput" rows="12" style="width:100%"></textarea>
    <div class="import-actions">
      <button id="importBundleBtn">Import capture bundle</button>
      <button id="clearBundleBtn">Clear</button>
    </div>

    <h3>Import official ChatGPT export ZIP</h3>
    <input id="officialZipPath" placeholder="/path/to/chatgpt-export.zip" style="width:100%" />
    <div class="import-actions"><button id="importOfficialBtn">Import official ZIP</button></div>

    <pre id="importResult" class="muted"></pre>`,
  );

  const fileInput = document.getElementById('bundleFileInput') as HTMLInputElement | null;
  const folderInput = document.getElementById('bundleFolderInput') as HTMLInputElement | null;
  const dropZone = document.getElementById('dropZone');
  const textarea = document.getElementById('bundleInput') as HTMLTextAreaElement | null;
  const out = document.getElementById('importResult');

  let pendingBundleFiles: File[] = [];

  async function handleFiles(files: File[] | FileList | null | undefined) {
    const jsonFiles = Array.from(files || []).filter((file) => file.name.toLowerCase().endsWith('.json'));
    if (!jsonFiles.length) {
      pendingBundleFiles = [];
      if (textarea) textarea.value = '';
      if (out) out.textContent = 'No JSON files selected.';
      return;
    }

    pendingBundleFiles = jsonFiles;

    if (jsonFiles.length === 1) {
      await loadBundleFile(jsonFiles[0]);
      return;
    }

    if (textarea) textarea.value = '';
    if (out) out.textContent = `Loaded ${jsonFiles.length} JSON files. Click “Import capture bundle” to import them all.`;
  }

  document.getElementById('pickBundleFileBtn')?.addEventListener('click', () => fileInput?.click());
  document.getElementById('pickBundleFolderBtn')?.addEventListener('click', () => folderInput?.click());

  document.getElementById('chooseImportFolderBtn')?.addEventListener('click', async () => {
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        defaultPath: getWatchedFolder() || getExportRoot(),
      });

      if (typeof picked !== 'string' || !picked.trim()) return;

      if (out) out.textContent = `Importing JSON files from ${picked} ...`;
      setWatchedFolder(picked);

      const result = await invoke<string>('auto_import_capture_folder', {
        folderPath: picked,
      });

      if (out) out.textContent = result;
      await maybeRefreshArchive();
    } catch (error) {
      if (out) out.textContent = `Folder import failed: ${(error as Error).message}`;
    }
  });

  fileInput?.addEventListener('change', async () => {
    await handleFiles(fileInput.files);
  });

  folderInput?.addEventListener('change', async () => {
    await handleFiles(folderInput.files);
  });

  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.add('dragover');
  });

  dropZone?.addEventListener('dragleave', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove('dragover');
  });

  dropZone?.addEventListener('drop', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    dropZone.classList.remove('dragover');
    const files = await dataTransferToFiles(event.dataTransfer);
    await handleFiles(files);
  });

  document.getElementById('clearBundleBtn')?.addEventListener('click', () => {
    if (textarea) textarea.value = '';
    if (fileInput) fileInput.value = '';
    if (folderInput) folderInput.value = '';
    pendingBundleFiles = [];
    if (out) out.textContent = '';
  });

  document.getElementById('importBundleBtn')?.addEventListener('click', async () => {
    try {
      if (pendingBundleFiles.length > 1) {
        let imported = 0;
        let failed = 0;

        for (const file of pendingBundleFiles) {
          try {
            const bundleJson = await file.text();
            await invoke<string>('import_capture_bundle', { bundleJson });
            imported += 1;
          } catch {
            failed += 1;
          }
        }

        if (out) out.textContent = `Imported ${imported} bundle(s), failed ${failed}.`;
        pendingBundleFiles = [];
        await maybeRefreshArchive();
        return;
      }

      const bundle = textarea?.value || '';
      const result = await invoke<string>('import_capture_bundle', { bundleJson: bundle });
      if (out) out.textContent = result;
      pendingBundleFiles = [];
      await maybeRefreshArchive();
    } catch (error) {
      if (out) out.textContent = `Import failed: ${(error as Error).message}`;
    }
  });

  document.getElementById('importOfficialBtn')?.addEventListener('click', async () => {
    const zipPath = (document.getElementById('officialZipPath') as HTMLInputElement).value;
    try {
      const result = await invoke<string>('import_official_export_zip', { zipPath });
      if (out) out.textContent = result;
      await maybeRefreshArchive();
    } catch (error) {
      if (out) out.textContent = `Official import failed: ${(error as Error).message}`;
    }
  });
}

function renderExport(): void {
  currentView = 'export';
  if (!content) return;

  content.innerHTML = section(
    'Export Jobs',
    `<label>Export root folder: <input id="exportRoot" value="${escapeHtml(getExportRoot())}" placeholder="/path/to/export/folder" /></label>
    <label>Mode:
      <select id="exportMode">
        <option value="incremental">incremental</option>
        <option value="force" selected>force</option>
      </select>
    </label>
    <div class="import-actions">
      <button id="queueExportBtn">Queue workspace export</button>
      <button id="runNowExportBtn">Queue and run now</button>
      <button id="runExportsBtn">Run queued/failed exports</button>
    </div>
    <pre id="exportResult" class="muted"></pre>`,
  );

  document.getElementById('queueExportBtn')?.addEventListener('click', async () => {
    const root = (document.getElementById('exportRoot') as HTMLInputElement).value.trim();
    const mode = (document.getElementById('exportMode') as HTMLSelectElement).value;
    const out = document.getElementById('exportResult');

    if (!root) {
      if (out) out.textContent = 'Export root folder is required.';
      return;
    }

    setExportRoot(root);

    try {
      if (out) out.textContent = 'Queueing export job...';
      const result = await invoke<string>('queue_export_job', {
        target: 'workspace',
        mode,
        rootDir: root,
      });
      if (out) out.textContent = result;
    } catch (error) {
      if (out) out.textContent = `Export queue failed: ${(error as Error).message}`;
    }
  });

  document.getElementById('runNowExportBtn')?.addEventListener('click', async () => {
    const root = (document.getElementById('exportRoot') as HTMLInputElement).value.trim();
    const mode = (document.getElementById('exportMode') as HTMLSelectElement).value;
    const out = document.getElementById('exportResult');

    if (!root) {
      if (out) out.textContent = 'Export root folder is required.';
      return;
    }

    setExportRoot(root);

    try {
      if (out) out.textContent = 'Queueing export job...';
      const queued = await invoke<string>('queue_export_job', {
        target: 'workspace',
        mode,
        rootDir: root,
      });

      if (out) out.textContent = `${queued}\nRunning export jobs...`;
      const result = await invoke<string>('run_pending_export_jobs');
      if (out) out.textContent = `${queued}\n${result}`;
    } catch (error) {
      if (out) out.textContent = `Running exports failed: ${(error as Error).message}`;
    }
  });

  document.getElementById('runExportsBtn')?.addEventListener('click', async () => {
    const out = document.getElementById('exportResult');
    try {
      if (out) out.textContent = 'Running queued/failed exports...';
      const result = await invoke<string>('run_pending_export_jobs');
      if (out) out.textContent = result;
    } catch (error) {
      if (out) out.textContent = `Running exports failed: ${(error as Error).message}`;
    }
  });
}

function renderSettings(): void {
  currentView = 'settings';
  if (!content) return;

  content.innerHTML = section(
    'Settings',
    `<p>Privacy mode is always local-first.</p>
    <ul>
      <li>No telemetry</li>
      <li>No cloud sync</li>
      <li>Explicit export path only</li>
    </ul>

    <h3>Auto-import watched folder</h3>
    <label>Watched folder:
      <input id="watchedFolderInput" value="${escapeHtml(getWatchedFolder())}" placeholder="/path/to/capture/folder" style="width:100%" />
    </label>
    <label>
      <input id="autoImportEnabledInput" type="checkbox" ${isAutoImportEnabled() ? 'checked' : ''} />
      Enable auto-import polling every 5 seconds
    </label>
    <div class="import-actions">
      <button id="saveAutoImportSettingsBtn">Save settings</button>
      <button id="runAutoImportNowBtn">Run auto-import now</button>
    </div>
    <pre id="autoImportResult" class="muted"></pre>`,
  );

  document.getElementById('saveAutoImportSettingsBtn')?.addEventListener('click', () => {
    const folder = (document.getElementById('watchedFolderInput') as HTMLInputElement).value.trim();
    const enabled = (document.getElementById('autoImportEnabledInput') as HTMLInputElement).checked;
    setWatchedFolder(folder);
    setAutoImportEnabled(enabled);
    ensureAutoImportPolling();
    setStatusText('autoImportResult', `Saved. Watching: ${getWatchedFolder() || '(none)'} (${enabled ? 'enabled' : 'disabled'})`);
  });

  document.getElementById('runAutoImportNowBtn')?.addEventListener('click', async () => {
    await autoImportOnce(true);
  });
}

async function renderDiagnostics(): Promise<void> {
  currentView = 'diagnostics';
  if (!content) return;

  const health = await invoke<{ status: string }>('diagnostics_health');
  const report = await invoke<any>('diagnostics_report');

  content.innerHTML = section(
    'Diagnostics',
    `<p>SQLite status: <strong>${health.status}</strong></p>
      <ul>
        <li>Queued jobs: ${report.queued_jobs}</li>
        <li>Failed jobs: ${report.failed_jobs}</li>
        <li>Resumable jobs: ${report.resumable_jobs}</li>
        <li>Missing exports: ${report.missing_markdown_exports}</li>
      </ul>`,
  );
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
    currentView = view;
    await actions[view]?.();
  });
}

ensureAutoImportPolling();
void autoImportOnce(false);
void renderArchive();
